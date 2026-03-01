/**
 * Core LLM data types — provider-agnostic request/response models.
 *
 * These types form the contract between the agent runtime and LLM providers.
 * All providers convert to/from these types internally.
 */

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** A text content part within a message. */
export interface TextContent {
  type: "text";
  text: string;
}

/** An image content part within a message (URL or base64). */
export interface ImageContent {
  type: "image_url";
  imageUrl: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

/** A single content part — either text or image. */
export type ContentPart = TextContent | ImageContent;

/** A single message in a conversation. */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Tool call types
// ---------------------------------------------------------------------------

/** A tool invocation requested by the LLM. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The result of executing a tool. */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
  error?: string;
  duration?: number;
}

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

/** Token usage statistics for a single LLM call. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Create an empty TokenUsage. */
export function emptyTokenUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/** Add two TokenUsage objects together. */
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) || undefined,
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) || undefined,
  };
}

// ---------------------------------------------------------------------------
// LLM Request / Response
// ---------------------------------------------------------------------------

/** The reason the LLM stopped generating. */
export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "error";

/** Format for structured/JSON responses. */
export interface ResponseFormat {
  type: "json_object" | "json_schema";
  jsonSchema?: Record<string, unknown>;
}

/** A provider-agnostic LLM request. */
export interface LLMRequest {
  messages: Message[];
  model: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  responseFormat?: ResponseFormat;
  metadata?: Record<string, unknown>;
}

/** A provider-agnostic LLM response. */
export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  model: string;
  finishReason: FinishReason;
  thinking?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

/** A single chunk in a streaming LLM response. */
export type LLMStreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; toolCall: Partial<ToolCall> & { id: string } }
  | { type: "thinking_delta"; text: string }
  | { type: "usage"; usage: Partial<TokenUsage> }
  | { type: "done"; finishReason: FinishReason };

// ---------------------------------------------------------------------------
// Tool schema (LLM-facing)
// ---------------------------------------------------------------------------

/** JSON Schema representation of a tool's parameters, sent to the LLM. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

/** Configuration for connecting to an LLM provider. */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
  organization?: string;
}

// ---------------------------------------------------------------------------
// Model info
// ---------------------------------------------------------------------------

/** Metadata about a specific model. */
export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
}

// ---------------------------------------------------------------------------
// Utility: extract text content from a message
// ---------------------------------------------------------------------------

/** Extract the text content from a message, regardless of content format. */
export function getMessageText(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** Create a simple text message. */
export function createMessage(
  role: Message["role"],
  content: string,
  options?: { toolCalls?: ToolCall[]; toolCallId?: string; name?: string },
): Message {
  return {
    role,
    content,
    ...(options?.toolCalls && { toolCalls: options.toolCalls }),
    ...(options?.toolCallId && { toolCallId: options.toolCallId }),
    ...(options?.name && { name: options.name }),
  };
}
