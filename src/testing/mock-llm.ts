import { generateShortId } from "../utils/hash.js";
import type { ILLMClient } from "../core/llm/client.js";
import type { LLMProvider } from "../core/llm/providers/base.js";
import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
} from "../models/llm.js";
import { emptyTokenUsage } from "../models/llm.js";

type QueuedResponse =
  | { kind: "response"; response: LLMResponse }
  | { kind: "stream"; chunks: string[]; model: string };

export class MockLLM implements ILLMClient, LLMProvider {
  readonly name = "mock";
  readonly supportedModels: string[];

  private readonly queue: QueuedResponse[] = [];
  private readonly callHistory: LLMRequest[] = [];
  private _callCount = 0;

  constructor(models: string[] = ["mock-model"]) {
    this.supportedModels = [...models];
  }

  get callCount(): number {
    return this._callCount;
  }

  addResponse(response: LLMResponse): void {
    this.queue.push({ kind: "response", response });
  }

  addTextResponse(text: string, model = "mock-model"): void {
    this.queue.push({
      kind: "response",
      response: {
        content: text,
        toolCalls: [],
        usage: {
          promptTokens: Math.max(1, Math.floor(text.length / 4)),
          completionTokens: Math.max(1, Math.floor(text.length / 4)),
          totalTokens: Math.max(2, Math.floor(text.length / 2)),
        },
        model,
        finishReason: "stop",
      },
    });
  }

  addToolCallResponse(
    toolName: string,
    args: Record<string, unknown>,
    options: { text?: string; model?: string } = {},
  ): void {
    this.queue.push({
      kind: "response",
      response: {
        content: options.text ?? "",
        toolCalls: [{ id: `call_${generateShortId()}`, name: toolName, arguments: { ...args } }],
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        model: options.model ?? "mock-model",
        finishReason: "tool_calls",
      },
    });
  }

  addStreamResponse(chunks: string[], model = "mock-model"): void {
    this.queue.push({ kind: "stream", chunks: [...chunks], model });
  }

  getCallHistory(): LLMRequest[] {
    return [...this.callHistory];
  }

  supportsModel(model: string): boolean {
    return this.supportedModels.includes(model);
  }

  async call(request: LLMRequest, _config?: ProviderConfig): Promise<LLMResponse> {
    this.callHistory.push(request);
    this._callCount += 1;

    const next = this.queue.shift();
    if (!next) {
      return {
        content: "I'm done.",
        toolCalls: [],
        usage: emptyTokenUsage(),
        model: request.model,
        finishReason: "stop",
      };
    }

    if (next.kind === "response") {
      return next.response;
    }

    const content = next.chunks.join("");
    return {
      content,
      toolCalls: [],
      usage: {
        promptTokens: Math.max(1, Math.floor(content.length / 4)),
        completionTokens: Math.max(1, Math.floor(content.length / 4)),
        totalTokens: Math.max(2, Math.floor(content.length / 2)),
      },
      model: next.model,
      finishReason: "stop",
    };
  }

  async *stream(request: LLMRequest, config?: ProviderConfig): AsyncIterableIterator<LLMStreamChunk> {
    const next = this.queue[0];

    if (next?.kind !== "stream") {
      const response = await this.call(request, config);
      if (response.content) {
        yield { type: "text_delta", text: response.content };
      }
      for (const tc of response.toolCalls) {
        yield { type: "tool_call_delta", toolCall: tc };
      }
      yield { type: "done", finishReason: response.finishReason };
      return;
    }

    this.queue.shift();
    this.callHistory.push(request);
    this._callCount += 1;

    for (const chunk of next.chunks) {
      if (chunk) {
        yield { type: "text_delta", text: chunk };
      }
    }
    yield { type: "done", finishReason: "stop" };
  }
}

