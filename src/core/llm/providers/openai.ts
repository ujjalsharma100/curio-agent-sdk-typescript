/**
 * OpenAI provider — supports GPT-4o, GPT-4o-mini, GPT-4-turbo, o1, o3.
 *
 * Uses the official `openai` npm package. The package is an optional dependency;
 * this provider throws a clear error if it's not installed.
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
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4-turbo-preview",
  "gpt-4",
  "gpt-3.5-turbo",
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
];

/** Convert SDK Message to OpenAI message format. */
function toOpenAIMessages(messages: Message[]): unknown[] {
  return messages.map((msg) => {
    const base: Record<string, unknown> = { role: msg.role };

    // Content
    if (typeof msg.content === "string") {
      base["content"] = msg.content;
    } else {
      base["content"] = msg.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        return { type: "image_url", image_url: { url: part.imageUrl.url, detail: part.imageUrl.detail ?? "auto" } };
      });
    }

    // Tool calls (assistant messages)
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      base["tool_calls"] = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }

    // Tool result
    if (msg.role === "tool" && msg.toolCallId) {
      base["tool_call_id"] = msg.toolCallId;
    }

    if (msg.name) base["name"] = msg.name;

    return base;
  });
}

/** Convert SDK ToolSchema to OpenAI tool format. */
function toOpenAITools(tools: ToolSchema[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Parse OpenAI tool calls from response. */
function parseToolCalls(rawCalls: Array<{ id: string; function: { name: string; arguments: string } }>): ToolCall[] {
  return rawCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));
}

/** Map OpenAI error to SDK error. */
function mapError(err: unknown): never {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: number }).status;
    const message = (err as { message?: string }).message ?? "OpenAI API error";

    if (status === 401) throw new LLMAuthenticationError(message, { provider: "openai" });
    if (status === 429) {
      const retryAfter = (err as { headers?: { "retry-after"?: string } }).headers?.["retry-after"];
      throw new LLMRateLimitError(message, {
        provider: "openai",
        retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
      });
    }
    if (status === 408 || status === 504) throw new LLMTimeoutError(message, { provider: "openai" });
    if (status >= 500) throw new LLMProviderError(message, { provider: "openai", statusCode: status });
  }

  const message = err instanceof Error ? err.message : String(err);
  throw new LLMError(message, { provider: "openai" });
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly supportedModels = SUPPORTED_MODELS;

  supportsModel(model: string): boolean {
    return SUPPORTED_MODELS.some((m) => model.startsWith(m));
  }

  async call(request: LLMRequest, config: ProviderConfig): Promise<LLMResponse> {
    const OpenAI = await this.loadSDK();
    const client = new OpenAI({
      apiKey: config.apiKey ?? process.env["OPENAI_API_KEY"],
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 60_000,
      defaultHeaders: config.headers,
      organization: config.organization,
    });

    try {
      const params: Record<string, unknown> = {
        model: request.model,
        messages: toOpenAIMessages(request.messages),
      };

      if (request.tools && request.tools.length > 0) {
        params["tools"] = toOpenAITools(request.tools);
      }
      if (request.temperature !== undefined) params["temperature"] = request.temperature;
      if (request.maxTokens !== undefined) params["max_tokens"] = request.maxTokens;
      if (request.topP !== undefined) params["top_p"] = request.topP;
      if (request.stop) params["stop"] = request.stop;
      if (request.responseFormat) {
        params["response_format"] = { type: request.responseFormat.type };
      }

      const completion = await client.chat.completions.create(params as unknown as Parameters<typeof client.chat.completions.create>[0]);

      const choice = (completion as { choices: Array<{ message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason: string }> }).choices[0]!;
      const usage = (completion as { usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }).usage;

      const toolCalls = choice.message.tool_calls ? parseToolCalls(choice.message.tool_calls) : [];

      return {
        content: choice.message.content ?? "",
        toolCalls,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
        model: request.model,
        finishReason: choice.finish_reason === "tool_calls" ? "tool_calls" : choice.finish_reason === "length" ? "length" : "stop",
      };
    } catch (err) {
      mapError(err);
    }
  }

  async *stream(request: LLMRequest, config: ProviderConfig): AsyncIterableIterator<LLMStreamChunk> {
    const OpenAI = await this.loadSDK();
    const client = new OpenAI({
      apiKey: config.apiKey ?? process.env["OPENAI_API_KEY"],
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 60_000,
      defaultHeaders: config.headers,
      organization: config.organization,
    });

    try {
      const params: Record<string, unknown> = {
        model: request.model,
        messages: toOpenAIMessages(request.messages),
        stream: true,
      };

      if (request.tools && request.tools.length > 0) {
        params["tools"] = toOpenAITools(request.tools);
      }
      if (request.temperature !== undefined) params["temperature"] = request.temperature;
      if (request.maxTokens !== undefined) params["max_tokens"] = request.maxTokens;
      if (request.topP !== undefined) params["top_p"] = request.topP;
      if (request.stop) params["stop"] = request.stop;
      if (request.responseFormat) {
        params["response_format"] = { type: request.responseFormat.type };
      }

      const stream = await client.chat.completions.create(params as unknown as Parameters<typeof client.chat.completions.create>[0]);

      // Track tool call assembly across chunks
      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream as AsyncIterable<{
        choices: Array<{
          delta: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
          finish_reason?: string;
        }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      }>) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        // Text delta
        if (choice.delta.content) {
          yield { type: "text_delta", text: choice.delta.content };
        }

        // Tool call deltas
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            let buf = toolCallBuffers.get(tc.index);
            if (!buf) {
              buf = { id: tc.id ?? "", name: "", args: "" };
              toolCallBuffers.set(tc.index, buf);
            }
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) buf.args += tc.function.arguments;

            yield {
              type: "tool_call_delta",
              toolCall: {
                id: buf.id,
                name: buf.name || undefined,
                arguments: undefined,
              },
            };
          }
        }

        // Usage
        if (chunk.usage) {
          yield {
            type: "usage",
            usage: {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            },
          };
        }

        // Done
        if (choice.finish_reason) {
          yield {
            type: "done",
            finishReason: choice.finish_reason === "tool_calls" ? "tool_calls" : choice.finish_reason === "length" ? "length" : "stop",
          };
        }
      }
    } catch (err) {
      mapError(err);
    }
  }

  private async loadSDK(): Promise<typeof import("openai").default> {
    try {
      const mod = await import("openai");
      return mod.default;
    } catch {
      throw new LLMError(
        'OpenAI provider requires the "openai" package. Install it: npm install openai',
        { provider: "openai" },
      );
    }
  }
}
