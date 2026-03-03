import { readFile, writeFile } from "node:fs/promises";
import type { ILLMClient } from "../core/llm/client.js";
import type { Middleware } from "../middleware/base.js";
import type { LLMRequest, LLMResponse, LLMStreamChunk } from "../models/llm.js";

export interface LLMCallRecord {
  request: LLMRequest;
  response: LLMResponse;
}

export interface RecordedToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface RecordingData {
  llmCalls: LLMCallRecord[];
  toolCalls: RecordedToolCall[];
}

export class RecordingMiddleware implements Middleware {
  readonly name = "recording";
  readonly recording: RecordingData = { llmCalls: [], toolCalls: [] };

  async afterLLMCall(request: LLMRequest, response: LLMResponse): Promise<LLMResponse> {
    this.recording.llmCalls.push({
      request: deepClone(request),
      response: deepClone(response),
    });
    return response;
  }

  async afterToolCall(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
  ): Promise<string> {
    this.recording.toolCalls.push({
      name: toolName,
      args: deepClone(args),
      result,
    });
    return result;
  }

  async save(filePath: string): Promise<void> {
    await writeFile(filePath, JSON.stringify(this.recording, null, 2), "utf8");
  }
}

export class ReplayLLMClient implements ILLMClient {
  private readonly responses: LLMResponse[];
  private index = 0;

  constructor(responses: LLMResponse[]) {
    this.responses = responses.map((response) => deepClone(response));
  }

  static fromRecording(recording: RecordingData): ReplayLLMClient {
    return new ReplayLLMClient(recording.llmCalls.map((call) => call.response));
  }

  static async fromFile(filePath: string): Promise<ReplayLLMClient> {
    const raw = await readFile(filePath, "utf8");
    return ReplayLLMClient.fromRecording(JSON.parse(raw) as RecordingData);
  }

  reset(): void {
    this.index = 0;
  }

  async call(_request: LLMRequest): Promise<LLMResponse> {
    const response = this.responses[this.index];
    if (!response) {
      throw new Error("ReplayLLMClient exhausted: no more recorded responses.");
    }
    this.index += 1;
    return deepClone(response);
  }

  async *stream(request: LLMRequest): AsyncIterableIterator<LLMStreamChunk> {
    const response = await this.call(request);
    if (response.content) {
      for (let i = 0; i < response.content.length; i += 16) {
        yield { type: "text_delta", text: response.content.slice(i, i + 16) };
      }
    }
    for (const toolCall of response.toolCalls) {
      yield { type: "tool_call_delta", toolCall };
    }
    yield { type: "done", finishReason: response.finishReason };
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

