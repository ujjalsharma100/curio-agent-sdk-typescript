/**
 * Curio Agent SDK — TypeScript Edition
 *
 * Production-grade agent harness for building autonomous AI agents.
 *
 * @example
 * ```typescript
 * import { Agent, createTool, HookEvent } from "curio-agent-sdk";
 * import { z } from "zod";
 *
 * const greet = createTool({
 *   name: "greet",
 *   description: "Greet someone by name",
 *   parameters: z.object({ name: z.string() }),
 *   execute: async ({ name }) => `Hello, ${name}!`,
 * });
 *
 * const agent = Agent.builder()
 *   .model("anthropic:claude-sonnet-4-6")
 *   .systemPrompt("You are a friendly assistant.")
 *   .tools([greet])
 *   .build();
 *
 * const result = await agent.run("Say hi to Alice");
 * console.log(result.output);
 * ```
 *
 * @packageDocumentation
 */

// ── Base ─────────────────────────────────────────────────────────────────────
export { Component } from "./base/index.js";

// ── Models ───────────────────────────────────────────────────────────────────
// LLM types
export type {
  TextContent,
  ImageContent,
  ContentPart,
  Message,
  ToolCall,
  ToolResult,
  TokenUsage,
  FinishReason,
  ResponseFormat,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ToolSchema,
  ProviderConfig,
  ModelInfo,
} from "./models/index.js";

export {
  emptyTokenUsage,
  addTokenUsage,
  getMessageText,
  createMessage,
} from "./models/index.js";

// Agent types
export type {
  ToolCallRecord,
  AgentRunResult,
  AgentMetrics,
  RunOptions,
  AgentIdentity,
  SubagentConfig,
} from "./models/index.js";

export { emptyMetrics } from "./models/index.js";

// Event types
export {
  HookEvent,
  HookContext,
  EventType,
  createAgentEvent,
} from "./models/index.js";

export type {
  HookEventName,
  HookHandler,
  AgentEvent,
  StreamEvent,
  EventBusHandler,
  Unsubscribe,
} from "./models/index.js";

// Errors
export {
  CurioError,
  LLMError,
  LLMRateLimitError,
  LLMAuthenticationError,
  LLMProviderError,
  LLMTimeoutError,
  NoAvailableModelError,
  CostBudgetExceeded,
  ToolError,
  ToolNotFoundError,
  ToolExecutionError,
  ToolTimeoutError,
  ToolValidationError,
  StateError,
  SessionNotFoundError,
  ConfigurationError,
  CredentialError,
} from "./models/index.js";

// ── Utilities ────────────────────────────────────────────────────────────────
export {
  sleep,
  withTimeout,
  withRetry,
  deferred,
  DedupCache,
  generateId,
  generateShortId,
  createLogger,
} from "./utils/index.js";
