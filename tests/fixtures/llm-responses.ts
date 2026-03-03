/**
 * Deterministic LLM response factories for integration and E2E tests.
 */
import type { LLMResponse, TokenUsage, ToolCall } from "../../src/models/llm.js";

/** Create a simple text LLM response. */
export function textResponse(text: string, model = "mock-model"): LLMResponse {
  return {
    content: text,
    toolCalls: [],
    usage: syntheticUsage(text.length),
    model,
    finishReason: "stop",
  };
}

/** Create an LLM response that requests a tool call. */
export function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  options: { text?: string; model?: string; callId?: string } = {},
): LLMResponse {
  const callId = options.callId ?? `call_${toolName}_001`;
  return {
    content: options.text ?? "",
    toolCalls: [{ id: callId, name: toolName, arguments: args }],
    usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    model: options.model ?? "mock-model",
    finishReason: "tool_calls",
  };
}

/** Create an LLM response with multiple tool calls. */
export function multiToolCallResponse(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
  model = "mock-model",
): LLMResponse {
  return {
    content: "",
    toolCalls: calls.map((c, i) => ({
      id: `call_${c.name}_${String(i).padStart(3, "0")}`,
      name: c.name,
      arguments: c.args,
    })),
    usage: { promptTokens: 80, completionTokens: 60, totalTokens: 140 },
    model,
    finishReason: "tool_calls",
  };
}

/** Create a structured JSON response. */
export function structuredResponse(data: unknown, model = "mock-model"): LLMResponse {
  const json = JSON.stringify(data);
  return {
    content: json,
    toolCalls: [],
    usage: syntheticUsage(json.length),
    model,
    finishReason: "stop",
  };
}

/** Create an error/content-filter response. */
export function errorResponse(reason: string, model = "mock-model"): LLMResponse {
  return {
    content: "",
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
    model,
    finishReason: "error",
    metadata: { error: reason },
  };
}

/** Synthetic token usage from approximate content length. */
function syntheticUsage(contentLength: number): TokenUsage {
  const prompt = Math.max(1, Math.floor(contentLength / 4));
  const completion = Math.max(1, Math.floor(contentLength / 4));
  return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
}
