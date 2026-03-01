/**
 * Anthropic provider — supports Claude Opus, Sonnet, Haiku.
 *
 * Uses the official `@anthropic-ai/sdk` npm package. Optional dependency.
 */

import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
  Message,
  ToolCall,
  ToolSchema,
} from "../../../models/llm.js";
import {
  LLMError,
  LLMRateLimitError,
  LLMAuthenticationError,
  LLMProviderError,
  LLMTimeoutError,
} from "../../../models/errors.js";
import type { LLMProvider } from "./base.js";

const SUPPORTED_MODELS = [
  "claude-opus-4-6",
  "claude-opus-4-20250901",
  "claude-sonnet-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
];

/** Convert SDK messages to Anthropic format (separate system from messages). */
function toAnthropicParams(messages: Message[]): { system?: string; messages: unknown[] } {
  let system: string | undefined;
  const anthropicMsgs: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : msg.content.map((p) => (p.type === "text" ? p.text : "")).join("");
      continue;
    }

    if (msg.role === "assistant") {
      const content: unknown[] = [];
      if (typeof msg.content === "string" && msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
      }
      anthropicMsgs.push({ role: "assistant", content: content.length > 0 ? content : [{ type: "text", text: "" }] });
      continue;
    }

    if (msg.role === "tool") {
      anthropicMsgs.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.toolCallId, content: msg.content }],
      });
      continue;
    }

    // User message
    if (typeof msg.content === "string") {
      anthropicMsgs.push({ role: "user", content: msg.content });
    } else {
      const content = msg.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        return { type: "image", source: { type: "url", url: part.imageUrl.url } };
      });
      anthropicMsgs.push({ role: "user", content });
    }
  }

  return { system, messages: anthropicMsgs };
}

/** Convert SDK ToolSchema to Anthropic tool format. */
function toAnthropicTools(tools: ToolSchema[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/** Map Anthropic error to SDK error. */
function mapError(err: unknown): never {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: number }).status;
    const message = (err as { message?: string }).message ?? "Anthropic API error";

    if (status === 401) throw new LLMAuthenticationError(message, { provider: "anthropic" });
    if (status === 429) {
      throw new LLMRateLimitError(message, { provider: "anthropic" });
    }
    if (status === 408 || status === 504 || status === 529) throw new LLMTimeoutError(message, { provider: "anthropic" });
    if (status >= 500) throw new LLMProviderError(message, { provider: "anthropic", statusCode: status });
  }

  const message = err instanceof Error ? err.message : String(err);
  throw new LLMError(message, { provider: "anthropic" });
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly supportedModels = SUPPORTED_MODELS;

  supportsModel(model: string): boolean {
    return SUPPORTED_MODELS.some((m) => model.startsWith(m)) || model.startsWith("claude-");
  }

  async call(request: LLMRequest, config: ProviderConfig): Promise<LLMResponse> {
    const Anthropic = await this.loadSDK();
    const client = new Anthropic({
      apiKey: config.apiKey ?? process.env["ANTHROPIC_API_KEY"],
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 60_000,
      defaultHeaders: config.headers,
    });

    const { system, messages } = toAnthropicParams(request.messages);

    try {
      const params: Record<string, unknown> = {
        model: request.model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
      };

      if (system) params["system"] = system;
      if (request.tools && request.tools.length > 0) {
        params["tools"] = toAnthropicTools(request.tools);
      }
      if (request.temperature !== undefined) params["temperature"] = request.temperature;
      if (request.topP !== undefined) params["top_p"] = request.topP;
      if (request.stop) params["stop_sequences"] = request.stop;

      const response = await client.messages.create(params as unknown as Parameters<typeof client.messages.create>[0]);

      // Parse response content
      let textContent = "";
      const toolCalls: ToolCall[] = [];
      let thinking = "";

      const contentBlocks = (response as { content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; thinking?: string }> }).content;

      for (const block of contentBlocks) {
        if (block.type === "text") {
          textContent += block.text ?? "";
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id!,
            name: block.name!,
            arguments: (block.input ?? {}) as Record<string, unknown>,
          });
        } else if (block.type === "thinking") {
          thinking += block.thinking ?? "";
        }
      }

      const usage = (response as { usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
      const stopReason = (response as { stop_reason: string }).stop_reason;

      return {
        content: textContent,
        toolCalls,
        usage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheWriteTokens: usage.cache_creation_input_tokens,
        },
        model: request.model,
        finishReason: stopReason === "tool_use" ? "tool_calls" : stopReason === "max_tokens" ? "length" : "stop",
        thinking: thinking || undefined,
      };
    } catch (err) {
      mapError(err);
    }
  }

  async *stream(request: LLMRequest, config: ProviderConfig): AsyncIterableIterator<LLMStreamChunk> {
    const Anthropic = await this.loadSDK();
    const client = new Anthropic({
      apiKey: config.apiKey ?? process.env["ANTHROPIC_API_KEY"],
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 60_000,
      defaultHeaders: config.headers,
    });

    const { system, messages } = toAnthropicParams(request.messages);

    try {
      const params: Record<string, unknown> = {
        model: request.model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
      };

      if (system) params["system"] = system;
      if (request.tools && request.tools.length > 0) {
        params["tools"] = toAnthropicTools(request.tools);
      }
      if (request.temperature !== undefined) params["temperature"] = request.temperature;
      if (request.topP !== undefined) params["top_p"] = request.topP;
      if (request.stop) params["stop_sequences"] = request.stop;

      const stream = await client.messages.create(params as unknown as Parameters<typeof client.messages.create>[0]);

      // Anthropic streaming uses SSE events
      let currentToolId = "";
      let currentToolName = "";
      let toolArgsBuffer = "";

      for await (const event of stream as AsyncIterable<{
        type: string;
        delta?: { type: string; text?: string; partial_json?: string; thinking?: string; stop_reason?: string };
        content_block?: { type: string; id?: string; name?: string };
        message?: { usage?: { input_tokens: number; output_tokens: number } };
        usage?: { output_tokens: number };
      }>) {
        if (event.type === "content_block_start" && event.content_block) {
          if (event.content_block.type === "tool_use") {
            currentToolId = event.content_block.id ?? "";
            currentToolName = event.content_block.name ?? "";
            toolArgsBuffer = "";
          }
        } else if (event.type === "content_block_delta" && event.delta) {
          if (event.delta.type === "text_delta" && event.delta.text) {
            yield { type: "text_delta", text: event.delta.text };
          } else if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
            toolArgsBuffer += event.delta.partial_json;
            yield {
              type: "tool_call_delta",
              toolCall: { id: currentToolId, name: currentToolName },
            };
          } else if (event.delta.type === "thinking_delta" && event.delta.thinking) {
            yield { type: "thinking_delta", text: event.delta.thinking };
          }
        } else if (event.type === "message_delta" && event.delta?.stop_reason) {
          const sr = event.delta.stop_reason;
          yield {
            type: "done",
            finishReason: sr === "tool_use" ? "tool_calls" : sr === "max_tokens" ? "length" : "stop",
          };
        } else if (event.type === "message_start" && event.message?.usage) {
          yield {
            type: "usage",
            usage: {
              promptTokens: event.message.usage.input_tokens,
            },
          };
        } else if (event.type === "message_delta" && event.usage) {
          yield {
            type: "usage",
            usage: {
              completionTokens: event.usage.output_tokens,
            },
          };
        }
      }
    } catch (err) {
      mapError(err);
    }
  }

  private async loadSDK(): Promise<typeof import("@anthropic-ai/sdk").default> {
    try {
      const mod = await import("@anthropic-ai/sdk");
      return mod.default;
    } catch {
      throw new LLMError(
        'Anthropic provider requires the "@anthropic-ai/sdk" package. Install it: npm install @anthropic-ai/sdk',
        { provider: "anthropic" },
      );
    }
  }
}
