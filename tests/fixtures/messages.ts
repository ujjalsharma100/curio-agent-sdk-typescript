/**
 * Deterministic message factories for integration and E2E tests.
 */
import type { Message, ToolCall } from "../../src/models/llm.js";

/** Create a system message. */
export function systemMessage(content: string): Message {
  return { role: "system", content };
}

/** Create a user message. */
export function userMessage(content: string): Message {
  return { role: "user", content };
}

/** Create an assistant message. */
export function assistantMessage(content: string, toolCalls?: ToolCall[]): Message {
  const msg: Message = { role: "assistant", content };
  if (toolCalls) msg.toolCalls = toolCalls;
  return msg;
}

/** Create a tool result message. */
export function toolResultMessage(toolCallId: string, result: string, toolName?: string): Message {
  return {
    role: "tool",
    content: result,
    toolCallId,
    ...(toolName ? { name: toolName } : {}),
  };
}

/** Build a simple multi-turn conversation. */
export function multiTurnConversation(turns: Array<{ user: string; assistant: string }>): Message[] {
  const messages: Message[] = [];
  for (const turn of turns) {
    messages.push(userMessage(turn.user));
    messages.push(assistantMessage(turn.assistant));
  }
  return messages;
}

/** Build a conversation with tool usage. */
export function toolConversation(params: {
  userInput: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: string;
  finalResponse: string;
}): Message[] {
  const callId = "call_test_001";
  return [
    userMessage(params.userInput),
    assistantMessage("", [{ id: callId, name: params.toolName, arguments: params.toolArgs }]),
    toolResultMessage(callId, params.toolResult, params.toolName),
    assistantMessage(params.finalResponse),
  ];
}
