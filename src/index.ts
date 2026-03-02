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

// ── Core: Agent ──────────────────────────────────────────────────────────────
export { Agent } from "./core/agent/index.js";
export { AgentBuilder } from "./core/agent/index.js";
export { Runtime } from "./core/agent/index.js";
export type { AgentParams, AgentConfig, RuntimeConfig } from "./core/agent/index.js";

// ── Core: Tools ──────────────────────────────────────────────────────────────
export {
  Tool,
  ToolRegistry,
  ToolExecutor,
  createTool,
  tool,
  createToolsFromInstance,
  getToolMeta,
  ToolSchemaDefinition,
  fromZod,
} from "./core/tools/index.js";
export type {
  ToolConfig,
  ToolExecuteFn,
  ToolValidateFn,
  CreateToolOptions,
  ToolMethodMeta,
  ToolExecutorOptions,
  ToolExecutorContext,
  PermissionPolicy,
  ToolPermissionContext,
  ToolPermissionResult,
  FromZodOptions,
} from "./core/tools/index.js";

// ── Core: LLM ────────────────────────────────────────────────────────────────
export { LLMClient } from "./core/llm/index.js";
export type { ILLMClient, LLMClientConfig } from "./core/llm/index.js";
export type { LLMProvider } from "./core/llm/index.js";
export { parseModelString, OpenAIProvider, AnthropicProvider, GroqProvider, OllamaProvider } from "./core/llm/index.js";
export { TieredRouter } from "./core/llm/index.js";
export type { RouterConfig, TierConfig, DegradationStrategy } from "./core/llm/index.js";
export { countStringTokens, countMessageTokens, clearTokenCache } from "./core/llm/index.js";

// ── Core: Loops ──────────────────────────────────────────────────────────────
export type { AgentLoop, ToolCallingLoopOptions } from "./core/loops/index.js";
export { ToolCallingLoop } from "./core/loops/index.js";

// ── Core: State ──────────────────────────────────────────────────────────────
export { AgentState } from "./core/state/index.js";
export type { StateExtension, StateExtensionFactory } from "./core/state/index.js";
export {
  CHECKPOINT_VERSION,
  checkpointFromState,
  stateFromCheckpoint,
  serializeCheckpoint,
  deserializeCheckpoint,
  serializeMessage,
  deserializeMessage,
} from "./core/state/index.js";
export type { CheckpointData, SerializedMessage } from "./core/state/index.js";
export type { StateStore, StateStoreLoadOptions } from "./core/state/index.js";
export { InMemoryStateStore, FileStateStore } from "./core/state/index.js";
export type { Session, SessionStore } from "./core/state/index.js";
export { touchSession, InMemorySessionStore, FileSessionStore, SessionManager } from "./core/state/index.js";

// ── Core: Events ─────────────────────────────────────────────────────────────
export { HookRegistry, EventFilter, InMemoryEventBus } from "./core/events/index.js";
export type { EventBus, DeadLetterEntry, InMemoryEventBusOptions } from "./core/events/index.js";

// ── Core: Context & Instructions ─────────────────────────────────────────────
export { ContextManager, SUMMARIZE_PLACEHOLDER } from "./core/context/index.js";
export type { ContextManagerOptions, ContextStrategy } from "./core/context/index.js";
export {
  InstructionLoader,
  loadInstructionsFromFile,
  findProjectRoot,
  defaultSearchPaths,
  DEFAULT_INSTRUCTION_FILES,
  PROJECT_ROOT_MARKERS,
} from "./core/context/index.js";
export type { InstructionLoaderOptions } from "./core/context/index.js";

// ── Core: Security & Permissions ────────────────────────────────────────────
export type {
  PermissionResult,
  PermissionContext,
  HumanInputHandler,
} from "./core/security/index.js";
export {
  AllowAll,
  AskAlways,
  AllowReadsAskWrites,
  CompoundPolicy,
  FileSandboxPolicy,
  NetworkSandboxPolicy,
  collectPathsFromArgs,
  collectUrlsFromArgs,
  CLIHumanInput,
} from "./core/security/index.js";

// ── Middleware (also available as curio-agent-sdk/middleware) ──────────────────
export type { Middleware } from "./middleware/base.js";
export { MiddlewarePipeline } from "./middleware/base.js";
export { LoggingMiddleware, CostTracker, RateLimitMiddleware, TracingMiddleware } from "./middleware/index.js";
export { GuardrailsMiddleware, GuardrailsError } from "./middleware/index.js";
export { PrometheusExporter, TracingConsumer, LoggingConsumer, PersistenceConsumer, getTraceContext } from "./middleware/index.js";
export type { LoggingMiddlewareOptions, CostTrackerOptions, RateLimitMiddlewareOptions } from "./middleware/index.js";
export type { TracingMiddlewareOptions, GuardrailsMiddlewareOptions, PrometheusExporterOptions } from "./middleware/index.js";
export type { TracingConsumerOptions, LoggingConsumerOptions } from "./middleware/index.js";
export { DEFAULT_PRICING } from "./middleware/index.js";

// ── Memory (also available as curio-agent-sdk/memory) ───────────────────────
export { MemoryEntry } from "./memory/index.js";
export type { Memory } from "./memory/index.js";
export {
  ConversationMemory,
  VectorMemory,
  KeyValueMemory,
  CompositeMemory,
  WorkingMemory,
  EpisodicMemory,
  Episode,
  GraphMemory,
  Triple,
  SelfEditingMemory,
  FileMemory,
} from "./memory/index.js";
export type { EmbeddingFn } from "./memory/index.js";
export { MemoryManager } from "./memory/index.js";
export type {
  MemoryInjectionStrategy,
  MemorySaveStrategy,
  MemoryQueryStrategy,
} from "./memory/index.js";
export {
  DefaultInjection,
  UserMessageInjection,
  NoInjection,
  DefaultSave,
  SaveEverythingStrategy,
  SaveSummaryStrategy,
  NoSave,
  PerIterationSave,
  DefaultQuery,
  KeywordQuery,
  AdaptiveTokenQuery,
} from "./memory/index.js";
export {
  importanceScore,
  decayScore,
  combinedRelevance,
  summarizeOldMemories,
} from "./memory/index.js";

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
