/**
 * Groq provider — uses OpenAI-compatible API for fast inference.
 *
 * Supports Llama, Mixtral, and other models hosted on Groq's LPU infrastructure.
 * Reuses the OpenAI SDK with a custom base URL.
 */

import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
} from "../../../models/llm.js";
import type { LLMProvider } from "./base.js";
import { OpenAIProvider } from "./openai.js";

const SUPPORTED_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "llama-3.3-70b-versatile",
  "llama-3.2-1b-preview",
  "llama-3.2-3b-preview",
  "llama-3.2-11b-vision-preview",
  "llama-3.2-90b-vision-preview",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
];

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export class GroqProvider implements LLMProvider {
  readonly name = "groq";
  readonly supportedModels = SUPPORTED_MODELS;
  private readonly openaiProvider = new OpenAIProvider();

  supportsModel(model: string): boolean {
    return SUPPORTED_MODELS.some((m) => model.startsWith(m));
  }

  async call(request: LLMRequest, config: ProviderConfig): Promise<LLMResponse> {
    const groqConfig: ProviderConfig = {
      ...config,
      apiKey: config.apiKey ?? process.env["GROQ_API_KEY"],
      baseUrl: config.baseUrl ?? GROQ_BASE_URL,
    };

    return this.openaiProvider.call(request, groqConfig);
  }

  async *stream(request: LLMRequest, config: ProviderConfig): AsyncIterableIterator<LLMStreamChunk> {
    const groqConfig: ProviderConfig = {
      ...config,
      apiKey: config.apiKey ?? process.env["GROQ_API_KEY"],
      baseUrl: config.baseUrl ?? GROQ_BASE_URL,
    };

    yield* this.openaiProvider.stream(request, groqConfig);
  }
}
