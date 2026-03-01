/**
 * Ollama provider — local model inference via Ollama's HTTP API.
 *
 * No API key required. Communicates directly via fetch (no external SDK needed).
 * Default endpoint: http://localhost:11434
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
import { LLMError, LLMProviderError, LLMTimeoutError } from "../../../models/errors.js";
import type { LLMProvider } from "./base.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

const SUPPORTED_MODELS = [
  "llama3.1",
  "llama3.2",
  "llama3.3",
  "mistral",
  "mixtral",
  "codellama",
  "deepseek-coder",
  "qwen2.5-coder",
  "phi3",
  "gemma2",
];

/** Convert SDK messages to Ollama chat format. */
function toOllamaMessages(messages: Message[]): unknown[] {
  return messages.map((msg) => {
    const m: Record<string, unknown> = {
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : msg.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
    };

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      m["tool_calls"] = msg.toolCalls.map((tc) => ({
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }

    return m;
  });
}

/** Convert SDK ToolSchema to Ollama tool format. */
function toOllamaTools(tools: ToolSchema[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly supportedModels = SUPPORTED_MODELS;

  supportsModel(model: string): boolean {
    // Ollama supports any model that's been pulled locally
    // We can't know ahead of time, so accept anything that looks like an Ollama model
    return SUPPORTED_MODELS.some((m) => model.startsWith(m)) || !model.includes("/");
  }

  async call(request: LLMRequest, config: ProviderConfig): Promise<LLMResponse> {
    const baseUrl = config.baseUrl ?? process.env["OLLAMA_HOST"] ?? DEFAULT_BASE_URL;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOllamaMessages(request.messages),
      stream: false,
    };

    if (request.tools && request.tools.length > 0) {
      body["tools"] = toOllamaTools(request.tools);
    }
    if (request.temperature !== undefined) {
      body["options"] = { ...(body["options"] as Record<string, unknown> ?? {}), temperature: request.temperature };
    }

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LLMProviderError(`Ollama error ${response.status}: ${text}`, {
          provider: "ollama",
          statusCode: response.status,
        });
      }

      const data = (await response.json()) as {
        message: {
          content: string;
          tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
        };
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const toolCalls: ToolCall[] = (data.message.tool_calls ?? []).map((tc, i) => ({
        id: `ollama_tc_${i}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

      const promptTokens = data.prompt_eval_count ?? 0;
      const completionTokens = data.eval_count ?? 0;

      return {
        content: data.message.content ?? "",
        toolCalls,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        model: request.model,
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      };
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new LLMTimeoutError("Ollama request timed out", { provider: "ollama" });
      }
      if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("ECONNREFUSED"))) {
        throw new LLMProviderError(
          `Cannot connect to Ollama at ${baseUrl}. Is Ollama running?`,
          { provider: "ollama" },
        );
      }
      throw new LLMError(err instanceof Error ? err.message : String(err), { provider: "ollama" });
    }
  }

  async *stream(request: LLMRequest, config: ProviderConfig): AsyncIterableIterator<LLMStreamChunk> {
    const baseUrl = config.baseUrl ?? process.env["OLLAMA_HOST"] ?? DEFAULT_BASE_URL;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOllamaMessages(request.messages),
      stream: true,
    };

    if (request.tools && request.tools.length > 0) {
      body["tools"] = toOllamaTools(request.tools);
    }
    if (request.temperature !== undefined) {
      body["options"] = { ...(body["options"] as Record<string, unknown> ?? {}), temperature: request.temperature };
    }

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LLMProviderError(`Ollama error ${response.status}: ${text}`, {
          provider: "ollama",
          statusCode: response.status,
        });
      }

      const reader = response.body?.getReader();
      if (!reader) throw new LLMError("No response body from Ollama", { provider: "ollama" });

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line) as {
            message?: { content?: string };
            done: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };

          if (chunk.message?.content) {
            yield { type: "text_delta", text: chunk.message.content };
          }

          if (chunk.done) {
            if (chunk.prompt_eval_count !== undefined || chunk.eval_count !== undefined) {
              yield {
                type: "usage",
                usage: {
                  promptTokens: chunk.prompt_eval_count,
                  completionTokens: chunk.eval_count,
                },
              };
            }
            yield { type: "done", finishReason: "stop" };
          }
        }
      }
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(err instanceof Error ? err.message : String(err), { provider: "ollama" });
    }
  }
}
