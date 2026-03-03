/**
 * LLM Client — manages providers, routing, deduplication, and retry.
 *
 * The LLMClient is the main entry point for making LLM calls. It:
 * - Manages registered providers (OpenAI, Anthropic, Groq, Ollama)
 * - Routes requests to the correct provider based on model string
 * - Retries on transient failures with exponential backoff
 * - Deduplicates identical in-flight requests
 * - Tracks usage statistics
 */

import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
  TokenUsage,
} from "../../models/llm.js";
import { emptyTokenUsage, addTokenUsage } from "../../models/llm.js";
import {
  LLMRateLimitError,
  LLMProviderError,
  NoAvailableModelError,
} from "../../models/errors.js";
import type { LLMProvider } from "./providers/base.js";
import { parseModelString } from "./providers/base.js";
import { OpenAIProvider } from "./providers/openai.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GroqProvider } from "./providers/groq.js";
import { OllamaProvider } from "./providers/ollama.js";
import { TieredRouter } from "./router.js";
import type { RouterConfig } from "./router.js";
import { withRetry, DedupCache } from "../../utils/async.js";
import { hashObject } from "../../utils/hash.js";
import { CircuitBreaker } from "../../resilience/circuit-breaker.js";

// ---------------------------------------------------------------------------
// Interface (consumed by agent loop/runtime)
// ---------------------------------------------------------------------------

/** The interface that the agent loop uses to call LLMs. */
export interface ILLMClient {
  /** Make a non-streaming LLM call. */
  call(request: LLMRequest): Promise<LLMResponse>;

  /** Make a streaming LLM call, yielding chunks. */
  stream(request: LLMRequest): AsyncIterableIterator<LLMStreamChunk>;
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface LLMClientConfig {
  /** Provider-specific configurations (API keys, base URLs). */
  providers?: Record<string, ProviderConfig>;
  /** Tiered router configuration. */
  router?: RouterConfig;
  /** Max retries on transient failures. Default: 2. */
  maxRetries?: number;
  /** Base delay for retry backoff in ms. Default: 1000. */
  retryBaseDelay?: number;
  /** Enable request deduplication. Default: true. */
  dedup?: boolean;
  /** Dedup cache TTL in ms. Default: 30000. */
  dedupTtl?: number;
  /** Auto-discover providers from environment variables. Default: true. */
  autoDiscover?: boolean;
  /** Circuit breaker options for provider/model calls. Disabled when false. */
  circuitBreaker?:
    | false
    | {
        failureThreshold?: number;
        recoveryTimeoutMs?: number;
        halfOpenMaxCalls?: number;
        successThreshold?: number;
      };
}

// ---------------------------------------------------------------------------
// LLM Client implementation
// ---------------------------------------------------------------------------

export class LLMClient implements ILLMClient {
  private readonly providers = new Map<string, LLMProvider>();
  private readonly providerConfigs = new Map<string, ProviderConfig>();
  private readonly router: TieredRouter;
  private readonly maxRetries: number;
  private readonly retryBaseDelay: number;
  private readonly dedupCache: DedupCache<Promise<LLMResponse>> | null;
  private readonly circuitBreakerConfig:
    | {
        failureThreshold?: number;
        recoveryTimeoutMs?: number;
        halfOpenMaxCalls?: number;
        successThreshold?: number;
      }
    | null;
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();

  /** Cumulative usage across all calls. */
  private _totalUsage: TokenUsage = emptyTokenUsage();
  /** Total number of calls made. */
  private _callCount = 0;

  constructor(config: LLMClientConfig = {}) {
    this.maxRetries = config.maxRetries ?? 2;
    this.retryBaseDelay = config.retryBaseDelay ?? 1000;
    this.dedupCache = config.dedup !== false ? new DedupCache(config.dedupTtl ?? 30_000) : null;
    this.circuitBreakerConfig = config.circuitBreaker === false ? null : config.circuitBreaker ?? {};
    this.router = new TieredRouter(config.router);

    // Store provider configs
    if (config.providers) {
      for (const [name, provConfig] of Object.entries(config.providers)) {
        this.providerConfigs.set(name, provConfig);
      }
    }

    // Auto-discover providers from environment
    if (config.autoDiscover !== false) {
      this.autoDiscoverProviders();
    }
  }

  // ── Provider management ──────────────────────────────────────────────────

  /** Register a provider. */
  registerProvider(provider: LLMProvider, config?: ProviderConfig): void {
    this.providers.set(provider.name, provider);
    if (config) {
      this.providerConfigs.set(provider.name, config);
    }
  }

  /** Get a registered provider by name. */
  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /** Get all registered provider names. */
  getProviderNames(): string[] {
    return [...this.providers.keys()];
  }

  // ── Execution ────────────────────────────────────────────────────────────

  async call(request: LLMRequest): Promise<LLMResponse> {
    // Dedup check
    if (this.dedupCache) {
      const key = hashObject({ model: request.model, messages: request.messages, tools: request.tools });
      const cached = this.dedupCache.get(key);
      if (cached) return cached;

      const promise = this.callWithFailover(request);
      this.dedupCache.set(key, promise);

      try {
        return await promise;
      } catch (err) {
        // Remove failed entry from dedup cache
        this.dedupCache.set(key, undefined!);
        throw err;
      }
    }

    return this.callWithFailover(request);
  }

  async *stream(request: LLMRequest): AsyncIterableIterator<LLMStreamChunk> {
    const { provider: providerName, modelId } = this.resolveModel(request.model);
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new NoAvailableModelError(`Provider "${providerName}" not registered`, {
        provider: providerName,
        model: modelId,
      });
    }

    const provConfig = this.providerConfigs.get(providerName) ?? {};
    const resolvedRequest = { ...request, model: modelId };

    yield* provider.stream(resolvedRequest, provConfig);
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  /** Get cumulative token usage. */
  get totalUsage(): TokenUsage {
    return { ...this._totalUsage };
  }

  /** Get total number of LLM calls made. */
  get callCount(): number {
    return this._callCount;
  }

  /** Reset usage statistics. */
  resetStats(): void {
    this._totalUsage = emptyTokenUsage();
    this._callCount = 0;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async callWithRetry(
    provider: LLMProvider,
    request: LLMRequest,
    config: ProviderConfig,
  ): Promise<LLMResponse> {
    const response = await withRetry(
      () => provider.call(request, config),
      {
        maxRetries: this.maxRetries,
        baseDelayMs: this.retryBaseDelay,
        shouldRetry: (err, _attempt) => {
          // Retry on rate limits and transient provider errors
          if (err instanceof LLMRateLimitError) return true;
          if (err instanceof LLMProviderError && (err.statusCode ?? 0) >= 500) return true;
          return false;
        },
      },
    );

    this._callCount++;
    this._totalUsage = addTokenUsage(this._totalUsage, response.usage);

    return response;
  }

  private async callWithFailover(request: LLMRequest): Promise<LLMResponse> {
    const attempted = new Set<string>();
    let resolved = this.resolveModel(request.model);
    let lastError: unknown;

    while (true) {
      const providerName = resolved.provider;
      const provider = this.providers.get(providerName);
      if (!provider) {
        throw new NoAvailableModelError(`Provider "${providerName}" not registered`, {
          provider: providerName,
          model: resolved.modelId,
        });
      }

      const modelKey = `${providerName}:${resolved.modelId}`;
      if (attempted.has(modelKey)) {
        throw new NoAvailableModelError(`No unused fallback models remain for "${request.model}"`);
      }
      attempted.add(modelKey);

      const provConfig = this.providerConfigs.get(providerName) ?? {};
      const resolvedRequest = { ...request, model: resolved.modelId };
      const breaker = this.getCircuitBreaker(modelKey);

      try {
        return await breaker.execute(() => this.callWithRetry(provider, resolvedRequest, provConfig));
      } catch (error) {
        lastError = error;
      }

      if (!this.router.hasTiers) {
        throw (lastError ?? new NoAvailableModelError(`No available model for "${request.model}"`));
      }

      const fallback = this.router.getFallback(modelKey, resolved.tier, this.providers);
      if (!fallback) {
        throw (lastError ?? new NoAvailableModelError(`No fallback available for "${request.model}"`));
      }
      resolved = fallback;
    }
  }

  private resolveModel(model: string): { provider: string; modelId: string; tier: number } {
    // If router has tiers, use it
    if (this.router.hasTiers) {
      const resolved = this.router.resolve(model, this.providers);
      return { provider: resolved.provider, modelId: resolved.modelId, tier: resolved.tier };
    }

    // Direct resolution
    const { provider, modelId } = parseModelString(model);

    if (provider) {
      return { provider, modelId, tier: 2 };
    }

    // Try to find a provider for this model
    for (const [name, prov] of this.providers) {
      if (prov.supportsModel(modelId)) {
        return { provider: name, modelId, tier: 2 };
      }
    }

    throw new NoAvailableModelError(`No provider found for model "${model}"`, { model });
  }

  private autoDiscoverProviders(): void {
    // OpenAI
    if (process.env["OPENAI_API_KEY"] || this.providerConfigs.has("openai")) {
      if (!this.providers.has("openai")) {
        this.providers.set("openai", new OpenAIProvider());
      }
    }

    // Anthropic
    if (process.env["ANTHROPIC_API_KEY"] || this.providerConfigs.has("anthropic")) {
      if (!this.providers.has("anthropic")) {
        this.providers.set("anthropic", new AnthropicProvider());
      }
    }

    // Groq
    if (process.env["GROQ_API_KEY"] || this.providerConfigs.has("groq")) {
      if (!this.providers.has("groq")) {
        this.providers.set("groq", new GroqProvider());
      }
    }

    // Ollama (always available as fallback — no API key needed)
    if (process.env["OLLAMA_HOST"] || this.providerConfigs.has("ollama")) {
      if (!this.providers.has("ollama")) {
        this.providers.set("ollama", new OllamaProvider());
      }
    }
  }

  private getCircuitBreaker(key: string): CircuitBreaker {
    const existing = this.circuitBreakers.get(key);
    if (existing) {
      return existing;
    }

    const circuitBreaker = new CircuitBreaker({
      failureThreshold: this.circuitBreakerConfig?.failureThreshold,
      recoveryTimeoutMs: this.circuitBreakerConfig?.recoveryTimeoutMs,
      halfOpenMaxCalls: this.circuitBreakerConfig?.halfOpenMaxCalls,
      successThreshold: this.circuitBreakerConfig?.successThreshold,
      shouldCountFailure: (error) => {
        if (error instanceof LLMRateLimitError) return true;
        if (error instanceof LLMProviderError) return true;
        return true;
      },
    });
    this.circuitBreakers.set(key, circuitBreaker);
    return circuitBreaker;
  }
}
