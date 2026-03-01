/**
 * Phase 3 tests — LLM Client, Router, Token Counter, Providers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseModelString } from "../../src/core/llm/providers/base.js";
import { TieredRouter } from "../../src/core/llm/router.js";
import { countStringTokens, countMessageTokens, clearTokenCache } from "../../src/core/llm/token-counter.js";
import { LLMClient } from "../../src/core/llm/client.js";
import { NoAvailableModelError, LLMRateLimitError, LLMProviderError } from "../../src/models/errors.js";
import type { LLMProvider } from "../../src/core/llm/providers/base.js";
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderConfig, Message } from "../../src/models/llm.js";

// ---------------------------------------------------------------------------
// Helpers — mock provider
// ---------------------------------------------------------------------------

function createMockProvider(name: string, models: string[]): LLMProvider & { callMock: ReturnType<typeof vi.fn> } {
  const callMock = vi.fn<[LLMRequest, ProviderConfig], Promise<LLMResponse>>().mockResolvedValue({
    content: "Hello from " + name,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: models[0]!,
    finishReason: "stop",
  });

  return {
    name,
    supportedModels: models,
    supportsModel: (model: string) => models.some((m) => model.startsWith(m)),
    call: callMock,
    async *stream(_req: LLMRequest, _config: ProviderConfig): AsyncIterableIterator<LLMStreamChunk> {
      yield { type: "text_delta", text: "Hello" };
      yield { type: "done", finishReason: "stop" };
    },
    callMock,
  };
}

// ---------------------------------------------------------------------------
// parseModelString
// ---------------------------------------------------------------------------

describe("parseModelString", () => {
  it("parses provider:model format", () => {
    const result = parseModelString("openai:gpt-4o");
    expect(result).toEqual({ provider: "openai", modelId: "gpt-4o" });
  });

  it("returns undefined provider when no prefix", () => {
    const result = parseModelString("gpt-4o");
    expect(result).toEqual({ modelId: "gpt-4o" });
  });

  it("handles multiple colons (first colon is delimiter)", () => {
    const result = parseModelString("anthropic:claude-3:latest");
    expect(result).toEqual({ provider: "anthropic", modelId: "claude-3:latest" });
  });

  it("handles empty provider prefix", () => {
    const result = parseModelString(":model");
    expect(result).toEqual({ provider: "", modelId: "model" });
  });
});

// ---------------------------------------------------------------------------
// TieredRouter
// ---------------------------------------------------------------------------

describe("TieredRouter", () => {
  let mockOpenAI: LLMProvider;
  let mockAnthropic: LLMProvider;
  let providers: Map<string, LLMProvider>;

  beforeEach(() => {
    mockOpenAI = createMockProvider("openai", ["gpt-4o", "gpt-4o-mini"]);
    mockAnthropic = createMockProvider("anthropic", ["claude-sonnet-4-6", "claude-opus-4-6"]);
    providers = new Map([
      ["openai", mockOpenAI],
      ["anthropic", mockAnthropic],
    ]);
  });

  it("reports hasTiers=false when no tiers configured", () => {
    const router = new TieredRouter();
    expect(router.hasTiers).toBe(false);
  });

  it("reports hasTiers=true when tiers are configured", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
    });
    expect(router.hasTiers).toBe(true);
  });

  it("resolves direct model string with provider prefix", () => {
    const router = new TieredRouter({
      tier2: { models: ["openai:gpt-4o"] },
    });
    const result = router.resolve("openai:gpt-4o", providers);
    expect(result.provider).toBe("openai");
    expect(result.modelId).toBe("gpt-4o");
  });

  it("resolves tier reference to first available model", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
      tier2: { models: ["anthropic:claude-sonnet-4-6", "openai:gpt-4o"] },
    });

    const result = router.resolve("tier2", providers);
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toBe("claude-sonnet-4-6");
    expect(result.tier).toBe(2);
  });

  it("resolves model without provider prefix by scanning providers", () => {
    const router = new TieredRouter({
      tier2: { models: ["gpt-4o"] },
    });

    const result = router.resolve("gpt-4o", providers);
    expect(result.provider).toBe("openai");
    expect(result.modelId).toBe("gpt-4o");
  });

  it("throws when no provider found for model", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
    });

    expect(() => router.resolve("unknown-model-xyz", providers)).toThrow(NoAvailableModelError);
  });

  it("throws when tier has no models configured", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
    });

    expect(() => router.resolve("tier3", providers)).toThrow(NoAvailableModelError);
  });

  describe("getFallback", () => {
    it("returns fallback from lower tier", () => {
      const router = new TieredRouter({
        tier1: { models: ["openai:gpt-4o-mini"] },
        tier2: { models: ["openai:gpt-4o"] },
        degradationStrategy: "fallback_to_lower_tier",
      });

      const fallback = router.getFallback("openai:gpt-4o", 2, providers);
      expect(fallback).toBeDefined();
      expect(fallback!.provider).toBe("openai");
      expect(fallback!.modelId).toBe("gpt-4o-mini");
      expect(fallback!.tier).toBe(1);
    });

    it("returns undefined when strategy is raise_error", () => {
      const router = new TieredRouter({
        tier1: { models: ["openai:gpt-4o-mini"] },
        tier2: { models: ["openai:gpt-4o"] },
        degradationStrategy: "raise_error",
      });

      const fallback = router.getFallback("openai:gpt-4o", 2, providers);
      expect(fallback).toBeUndefined();
    });

    it("tries other models in same tier before falling back", () => {
      const router = new TieredRouter({
        tier1: { models: ["openai:gpt-4o-mini"] },
        tier2: { models: ["anthropic:claude-sonnet-4-6", "openai:gpt-4o"] },
        degradationStrategy: "fallback_to_lower_tier",
      });

      const fallback = router.getFallback("anthropic:claude-sonnet-4-6", 2, providers);
      expect(fallback).toBeDefined();
      expect(fallback!.modelId).toBe("gpt-4o");
      expect(fallback!.tier).toBe(2);
    });
  });

  it("returns tiers from getTiers", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
      tier3: { models: ["anthropic:claude-opus-4-6"] },
    });

    const tiers = router.getTiers();
    expect(tiers.size).toBe(2);
    expect(tiers.get(1)).toEqual(["openai:gpt-4o-mini"]);
    expect(tiers.get(3)).toEqual(["anthropic:claude-opus-4-6"]);
  });
});

// ---------------------------------------------------------------------------
// Token Counter
// ---------------------------------------------------------------------------

describe("TokenCounter", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  it("estimates tokens from string using char ratio", async () => {
    // 100 chars / 4 chars per token = 25 tokens
    const text = "a".repeat(100);
    const count = await countStringTokens(text, "anthropic:claude-sonnet-4-6");
    expect(count).toBe(25);
  });

  it("returns cached result on second call", async () => {
    const text = "hello world test string";
    const count1 = await countStringTokens(text, "some-model");
    const count2 = await countStringTokens(text, "some-model");
    expect(count1).toBe(count2);
  });

  it("counts message tokens with overhead", async () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const count = await countMessageTokens(messages, "anthropic:claude-sonnet-4-6");
    // "Hello" = 5/4 = 2 tokens + 4 overhead = 6
    // "Hi there" = 8/4 = 2 tokens + 4 overhead = 6
    // + 3 base overhead = 15
    expect(count).toBe(15);
  });

  it("counts tool schema tokens", async () => {
    const messages: Message[] = [{ role: "user", content: "test" }];
    const tools = [{ name: "greet", description: "Greet someone", parameters: { type: "object" } }];

    const withTools = await countMessageTokens(messages, "anthropic:claude-sonnet-4-6", tools);
    const withoutTools = await countMessageTokens(messages, "anthropic:claude-sonnet-4-6");

    expect(withTools).toBeGreaterThan(withoutTools);
  });
});

// ---------------------------------------------------------------------------
// LLMClient
// ---------------------------------------------------------------------------

describe("LLMClient", () => {
  let mockProvider: LLMProvider & { callMock: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockProvider = createMockProvider("test-provider", ["test-model"]);
  });

  it("registers and retrieves providers", () => {
    const client = new LLMClient({ autoDiscover: false });
    client.registerProvider(mockProvider);

    expect(client.getProvider("test-provider")).toBe(mockProvider);
    expect(client.getProviderNames()).toContain("test-provider");
  });

  it("calls provider with resolved model", async () => {
    const client = new LLMClient({ autoDiscover: false, dedup: false });
    client.registerProvider(mockProvider);

    const response = await client.call({
      model: "test-provider:test-model",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.content).toBe("Hello from test-provider");
    expect(mockProvider.callMock).toHaveBeenCalledOnce();
  });

  it("resolves model without provider prefix", async () => {
    const client = new LLMClient({ autoDiscover: false, dedup: false });
    client.registerProvider(mockProvider);

    const response = await client.call({
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.content).toBe("Hello from test-provider");
  });

  it("throws when provider not found", async () => {
    const client = new LLMClient({ autoDiscover: false });

    await expect(
      client.call({ model: "unknown:model", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow(NoAvailableModelError);
  });

  it("throws when no provider supports model", async () => {
    const client = new LLMClient({ autoDiscover: false });
    client.registerProvider(mockProvider);

    await expect(
      client.call({ model: "unsupported-model-xyz", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow(NoAvailableModelError);
  });

  it("tracks usage statistics", async () => {
    const client = new LLMClient({ autoDiscover: false, dedup: false });
    client.registerProvider(mockProvider);

    await client.call({ model: "test-model", messages: [{ role: "user", content: "Hi" }] });
    await client.call({ model: "test-model", messages: [{ role: "user", content: "Hey" }] });

    expect(client.callCount).toBe(2);
    expect(client.totalUsage.promptTokens).toBe(20);
    expect(client.totalUsage.completionTokens).toBe(10);
    expect(client.totalUsage.totalTokens).toBe(30);
  });

  it("resets stats", async () => {
    const client = new LLMClient({ autoDiscover: false, dedup: false });
    client.registerProvider(mockProvider);

    await client.call({ model: "test-model", messages: [{ role: "user", content: "Hi" }] });
    client.resetStats();

    expect(client.callCount).toBe(0);
    expect(client.totalUsage.totalTokens).toBe(0);
  });

  it("deduplicates identical in-flight requests", async () => {
    const client = new LLMClient({ autoDiscover: false, dedup: true });
    client.registerProvider(mockProvider);

    const request: LLMRequest = {
      model: "test-model",
      messages: [{ role: "user", content: "deduplicate me" }],
    };

    // Fire two identical calls simultaneously
    const [r1, r2] = await Promise.all([client.call(request), client.call(request)]);

    expect(r1.content).toBe(r2.content);
    // The provider should only be called once due to dedup
    expect(mockProvider.callMock).toHaveBeenCalledOnce();
  });

  it("retries on rate limit errors", async () => {
    const client = new LLMClient({ autoDiscover: false, dedup: false, maxRetries: 2, retryBaseDelay: 10 });
    client.registerProvider(mockProvider);

    let attempts = 0;
    mockProvider.callMock.mockImplementation(async () => {
      attempts++;
      if (attempts <= 2) throw new LLMRateLimitError("Rate limited", { provider: "test" });
      return {
        content: "Success after retry",
        toolCalls: [],
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        model: "test-model",
        finishReason: "stop" as const,
      };
    });

    const response = await client.call({
      model: "test-model",
      messages: [{ role: "user", content: "retry test" }],
    });

    expect(response.content).toBe("Success after retry");
    expect(attempts).toBe(3);
  });

  it("retries on 5xx provider errors", async () => {
    const client = new LLMClient({ autoDiscover: false, dedup: false, maxRetries: 1, retryBaseDelay: 10 });
    client.registerProvider(mockProvider);

    let attempts = 0;
    mockProvider.callMock.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) throw new LLMProviderError("Server error", { provider: "test", statusCode: 500 });
      return {
        content: "Recovered",
        toolCalls: [],
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        model: "test-model",
        finishReason: "stop" as const,
      };
    });

    const response = await client.call({
      model: "test-model",
      messages: [{ role: "user", content: "retry test" }],
    });

    expect(response.content).toBe("Recovered");
    expect(attempts).toBe(2);
  });

  it("streams from provider", async () => {
    const client = new LLMClient({ autoDiscover: false });
    client.registerProvider(mockProvider);

    const chunks: LLMStreamChunk[] = [];
    for await (const chunk of client.stream({
      model: "test-model",
      messages: [{ role: "user", content: "stream test" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: "text_delta", text: "Hello" });
    expect(chunks[1]).toEqual({ type: "done", finishReason: "stop" });
  });

  it("uses router when tiers are configured", async () => {
    const client = new LLMClient({
      autoDiscover: false,
      dedup: false,
      router: {
        tier1: { models: ["test-provider:test-model"] },
      },
    });
    client.registerProvider(mockProvider);

    const response = await client.call({
      model: "tier1",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.content).toBe("Hello from test-provider");
  });
});

// ---------------------------------------------------------------------------
// Provider: Ollama (unit tests — no actual Ollama server needed)
// ---------------------------------------------------------------------------

describe("OllamaProvider", () => {
  it("supports known Ollama models", async () => {
    const { OllamaProvider } = await import("../../src/core/llm/providers/ollama.js");
    const provider = new OllamaProvider();

    expect(provider.supportsModel("llama3.1")).toBe(true);
    expect(provider.supportsModel("llama3.3")).toBe(true);
    expect(provider.supportsModel("mistral")).toBe(true);
    expect(provider.supportsModel("codellama")).toBe(true);
    expect(provider.supportsModel("qwen2.5-coder")).toBe(true);
  });

  it("supports models without slashes (local models)", async () => {
    const { OllamaProvider } = await import("../../src/core/llm/providers/ollama.js");
    const provider = new OllamaProvider();

    expect(provider.supportsModel("my-custom-model")).toBe(true);
  });

  it("has correct name", async () => {
    const { OllamaProvider } = await import("../../src/core/llm/providers/ollama.js");
    const provider = new OllamaProvider();
    expect(provider.name).toBe("ollama");
  });
});

// ---------------------------------------------------------------------------
// Provider: Groq (unit tests — delegation check)
// ---------------------------------------------------------------------------

describe("GroqProvider", () => {
  it("supports known Groq models", async () => {
    const { GroqProvider } = await import("../../src/core/llm/providers/groq.js");
    const provider = new GroqProvider();

    expect(provider.supportsModel("llama-3.1-8b-instant")).toBe(true);
    expect(provider.supportsModel("mixtral-8x7b-32768")).toBe(true);
    expect(provider.supportsModel("gemma2-9b-it")).toBe(true);
  });

  it("has correct name", async () => {
    const { GroqProvider } = await import("../../src/core/llm/providers/groq.js");
    const provider = new GroqProvider();
    expect(provider.name).toBe("groq");
  });
});
