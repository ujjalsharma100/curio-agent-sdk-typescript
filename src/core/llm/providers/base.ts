/**
 * LLM Provider interface — the abstraction all providers implement.
 *
 * Providers handle the transport-level details of calling a specific LLM API
 * (OpenAI, Anthropic, Groq, Ollama, etc.) and convert between the provider's
 * native format and the SDK's provider-agnostic LLMRequest/LLMResponse types.
 */

import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
} from "../../../models/llm.js";

/** The interface every LLM provider must implement. */
export interface LLMProvider {
  /** Provider identifier (e.g., "openai", "anthropic", "groq", "ollama"). */
  readonly name: string;

  /** List of model IDs this provider supports. */
  readonly supportedModels: string[];

  /** Make a non-streaming call. */
  call(request: LLMRequest, config: ProviderConfig): Promise<LLMResponse>;

  /** Make a streaming call, yielding chunks. */
  stream(request: LLMRequest, config: ProviderConfig): AsyncIterableIterator<LLMStreamChunk>;

  /** Check if this provider supports a given model ID. */
  supportsModel(model: string): boolean;
}

/**
 * Parse a model string like "openai:gpt-4o" into provider and model parts.
 * If no provider prefix, returns undefined for provider.
 */
export function parseModelString(model: string): { provider?: string; modelId: string } {
  const colonIdx = model.indexOf(":");
  if (colonIdx === -1) {
    return { modelId: model };
  }
  return {
    provider: model.slice(0, colonIdx),
    modelId: model.slice(colonIdx + 1),
  };
}
