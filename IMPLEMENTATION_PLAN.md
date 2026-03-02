# Curio Agent SDK — TypeScript Port Implementation Plan

> A 1:1 TypeScript port of the Python Curio Agent SDK with identical functionality,
> architecture, and public API surface — adapted to TypeScript idioms.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Mapping: Python → TypeScript](#architecture-mapping)
3. [Phase 1: Project Scaffolding & Core Types](#phase-1)
4. [Phase 2: Core Agent & Runtime](#phase-2)
5. [Phase 3: LLM Client & Providers](#phase-3)
6. [Phase 4: Tool System](#phase-4)
7. [Phase 5: Agent Loop](#phase-5)
8. [Phase 6: State Management](#phase-6)
9. [Phase 7: Hooks & Events](#phase-7)
10. [Phase 8: Middleware Pipeline](#phase-8)
11. [Phase 9: Memory System](#phase-9)
12. [Phase 10: Context & Instructions](#phase-10)
13. [Phase 11: Security & Permissions](#phase-11)
14. [Phase 12: Extensions (Skills, Plugins, Subagents)](#phase-12)
15. [Phase 13: MCP Integration](#phase-13)
16. [Phase 14: CLI Harness](#phase-14)
17. [Phase 15: Built-in Tools](#phase-15)
18. [Phase 16: Persistence & Audit](#phase-16)
19. [Phase 17: Testing Utilities](#phase-17)
20. [Phase 18: Connectors, Credentials, Resilience](#phase-18)
21. [Phase 19: Documentation & Publishing](#phase-19)
22. [TypeScript-Specific Design Decisions](#typescript-decisions)
23. [Dependency Mapping](#dependency-mapping)

---

<a id="overview"></a>
## 1. Overview

### Goal
Create `curio-agent-sdk` — an npm package that is the TypeScript equivalent of the Python `curio_agent_sdk`. Every feature, every extension point, every abstraction should have a TypeScript counterpart.

### Principles
1. **Feature parity**: Every Python class/function has a TypeScript equivalent
2. **TypeScript idioms**: Use TypeScript-native patterns (interfaces, generics, discriminated unions, decorators)
3. **Async-first**: Use `async/await`, `AsyncIterableIterator`, `Promise` throughout
4. **Runtime compatibility**: Works with Node.js 20+ and Bun 1.0+
5. **Tree-shakeable**: ESM modules, no side effects, proper `exports` field
6. **Zero-config defaults**: Works out of the box with sensible defaults
7. **Type safety**: Strict TypeScript, no `any`, exported types for all public APIs

### Package Info
- **Name**: `curio-agent-sdk` (npm)
- **Entry**: `src/index.ts`
- **Module**: ESM (with CJS fallback)
- **TypeScript**: 5.3+ strict mode
- **Node.js**: 20+
- **Bun**: 1.0+

---

<a id="architecture-mapping"></a>
## 2. Architecture Mapping: Python → TypeScript

| Python SDK Module | TypeScript Equivalent | Key Adaptations |
|---|---|---|
| `base/component.py` (ABC) | `base/component.ts` (abstract class) | Same pattern |
| `core/agent/agent.py` | `core/agent/agent.ts` | Fluent builder with generics |
| `core/agent/builder.py` | `core/agent/builder.ts` | Method chaining with type inference |
| `core/agent/runtime.py` | `core/agent/runtime.ts` | AsyncIterableIterator for streaming |
| `core/loops/base.py` | `core/loops/base.ts` | Interface + abstract class |
| `core/loops/tool_calling.py` | `core/loops/tool-calling.ts` | Same algorithm |
| `core/llm/client.py` | `core/llm/client.ts` | Generic request/response types |
| `core/llm/providers/*.py` | `core/llm/providers/*.ts` | Fetch-based (not httpx) |
| `core/llm/router.py` | `core/llm/router.ts` | Same tiered system |
| `core/llm/token_counter.py` | `core/llm/token-counter.ts` | tiktoken-js or gpt-tokenizer |
| `core/tools/tool.py` | `core/tools/tool.ts` | Decorator via `createTool()` + `@Tool()` |
| `core/tools/schema.py` | `core/tools/schema.ts` | Zod → JSON Schema |
| `core/tools/registry.py` | `core/tools/registry.ts` | Map-based |
| `core/tools/executor.py` | `core/tools/executor.ts` | Promise.all for parallel |
| `core/state/state.py` | `core/state/state.ts` | Generic extensions via type params |
| `core/state/checkpoint.py` | `core/state/checkpoint.ts` | JSON serialization |
| `core/state/session.py` | `core/state/session.ts` | Same interface |
| `core/state/state_store.py` | `core/state/state-store.ts` | Same interface |
| `core/context/context.py` | `core/context/context.ts` | Same strategies |
| `core/context/instructions.py` | `core/context/instructions.ts` | Same hierarchical loading |
| `core/events/hooks.py` | `core/events/hooks.ts` | TypedEventEmitter pattern |
| `core/events/event_bus.py` | `core/events/event-bus.ts` | Same pub/sub |
| `core/security/permissions.py` | `core/security/permissions.ts` | Same policy pattern |
| `core/security/human_input.py` | `core/security/human-input.ts` | readline interface |
| `core/extensions/skills.py` | `core/extensions/skills.ts` | Same manifest format |
| `core/extensions/plugins.py` | `core/extensions/plugins.ts` | npm package discovery |
| `core/extensions/subagent.py` | `core/extensions/subagent.ts` | Same pattern |
| `core/workflow/plan_mode.py` | `core/workflow/plan-mode.ts` | Same state machine |
| `core/workflow/structured_output.py` | `core/workflow/structured-output.ts` | Zod instead of Pydantic |
| `memory/*.py` (9 backends) | `memory/*.ts` (9 backends) | Same abstractions |
| `middleware/*.py` (7 types) | `middleware/*.ts` (7 types) | Same pipeline |
| `models/*.py` | `models/*.ts` | TypeScript interfaces/types |
| `mcp/*.py` | `mcp/*.ts` | Use @modelcontextprotocol/sdk |
| `cli/cli.py` | `cli/cli.ts` | readline + ink |
| `persistence/*.py` | `persistence/*.ts` | better-sqlite3, pg |
| `credentials/*.py` | `credentials/*.ts` | Same resolvers |
| `resilience/*.py` | `resilience/*.ts` | Same circuit breaker |
| `testing/*.py` | `testing/*.ts` | Vitest-compatible |
| `tools/*.py` | `tools/*.ts` | Same built-in tools |
| `connectors/*.py` | `connectors/*.ts` | Same interface |

---

<a id="phase-1"></a>
## Phase 1: Project Scaffolding & Core Types ✅ COMPLETED

> **Completed on**: 2026-03-01
>
> **What was implemented**:
> - `package.json` — Full config with dual ESM/CJS exports, subpath exports (`/testing`, `/memory`, `/middleware`), `sideEffects: false`, all scripts (build, test, lint, format, typecheck)
> - `tsconfig.json` — Strict mode, ES2022 target, bundler module resolution, `@curio/*` path aliases, `noUnusedLocals`, `noUncheckedIndexedAccess`
> - `tsup.config.ts` — Multi-entry build (index + 3 subpath exports), ESM+CJS+DTS output, tree-shaking, source maps, external optional deps
> - `vitest.config.ts` — Node environment, v8 coverage, `@curio` alias, 10s test timeout
> - `eslint.config.js` — Flat config (ESLint 9), TypeScript parser, recommended rules, unused var ignore pattern
> - `.prettierrc` — Consistent formatting (double quotes, trailing commas, 100 print width)
> - `.gitignore` — node_modules, dist, coverage, env files
> - **Full directory structure** — All 20+ directories mirroring Python SDK layout created
> - `src/base/component.ts` — Abstract `Component` class with `startup()`, `shutdown()`, `healthCheck()`, `markInitialized()`/`markShutdown()` lifecycle
> - `src/models/llm.ts` — Complete LLM types: `Message`, `ContentPart` (text + image), `ToolCall`, `ToolResult`, `TokenUsage` (with cache tokens), `LLMRequest`, `LLMResponse`, `LLMStreamChunk` (discriminated union), `ToolSchema`, `ProviderConfig`, `ModelInfo`, `ResponseFormat`. Helpers: `emptyTokenUsage()`, `addTokenUsage()`, `getMessageText()`, `createMessage()`
> - `src/models/agent.ts` — Agent types: `AgentRunResult`, `ToolCallRecord`, `AgentMetrics`, `RunOptions` (with AbortSignal), `AgentIdentity`, `SubagentConfig`. Helper: `emptyMetrics()`
> - `src/models/events.ts` — 16 `HookEvent` constants matching Python SDK, mutable `HookContext` class (cancel/modify), `EventType` enum, `AgentEvent`, `StreamEvent` (8-variant discriminated union), `EventBusHandler`, `Unsubscribe`
> - `src/models/errors.ts` — Full error hierarchy: `CurioError` → `LLMError` (with provider/model) → `LLMRateLimitError` (retryAfter), `LLMAuthenticationError`, `LLMProviderError` (statusCode), `LLMTimeoutError` (timeoutMs), `NoAvailableModelError`, `CostBudgetExceeded` (budget/actual). `ToolError` (toolName) → `ToolNotFoundError`, `ToolExecutionError` (toolArgs), `ToolTimeoutError` (timeoutMs), `ToolValidationError` (validationErrors). Also: `StateError`, `SessionNotFoundError`, `ConfigurationError`, `CredentialError`. All use `Object.setPrototypeOf` for correct `instanceof` chain and support `ErrorOptions.cause`
> - `src/models/index.ts` — Barrel exports for all model types
> - `src/utils/async.ts` — `sleep()`, `withTimeout()`, `withRetry()` (exponential backoff + jitter + shouldRetry), `deferred()`, `DedupCache<T>` (TTL-based), `runAsync()`
> - `src/utils/hash.ts` — `sha256()`, `hashObject()` (deterministic), `generateId()` (UUID v4), `generateShortId()` (12-char hex)
> - `src/utils/logger.ts` — pino-based structured logger, `CURIO_LOG_LEVEL` env var, `createLogger(component)` factory
> - `src/index.ts` — Main entry point re-exporting all public API surface with TSDoc example
> - Placeholder subpath entry files (`testing/index.ts`, `memory/index.ts`, `middleware/index.ts`)
>
> **Tests**: 48 tests across 3 test files — all passing
> - `tests/unit/models.test.ts` — 26 tests covering TokenUsage, Message helpers, AgentMetrics, HookEvent constants, HookContext mutability, createAgentEvent, full error hierarchy (instanceof chains, properties, cause chaining)
> - `tests/unit/component.test.ts` — 4 tests covering lifecycle (uninitialized → startup → healthCheck → shutdown)
> - `tests/unit/utils.test.ts` — 18 tests covering sleep, withTimeout, withRetry (success, retry, shouldRetry), deferred (resolve/reject), DedupCache (set/get/expire/clear), sha256, hashObject determinism, generateId, generateShortId uniqueness
>
> **Build**: Produces ESM + CJS + DTS output, all type-checking passes with `tsc --noEmit`

### 1.1 Project Initialization
- [x] Initialize npm project (`package.json`)
- [x] Configure TypeScript (`tsconfig.json`):
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "strict": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "outDir": "dist",
      "rootDir": "src",
      "experimentalDecorators": true,
      "emitDecoratorMetadata": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "paths": {
        "@curio/*": ["./src/*"]
      }
    }
  }
  ```
- [x] Set up project structure (mirror Python SDK):
  ```
  curio_agent_sdk_typescript/
  ├── src/
  │   ├── index.ts                    # Public re-exports
  │   ├── base/
  │   │   └── component.ts            # Component abstract class
  │   ├── core/
  │   │   ├── agent/
  │   │   │   ├── agent.ts
  │   │   │   ├── builder.ts
  │   │   │   └── runtime.ts
  │   │   ├── loops/
  │   │   │   ├── base.ts
  │   │   │   └── tool-calling.ts
  │   │   ├── llm/
  │   │   │   ├── client.ts
  │   │   │   ├── router.ts
  │   │   │   ├── token-counter.ts
  │   │   │   └── providers/
  │   │   │       ├── base.ts
  │   │   │       ├── openai.ts
  │   │   │       ├── anthropic.ts
  │   │   │       ├── groq.ts
  │   │   │       └── ollama.ts
  │   │   ├── tools/
  │   │   │   ├── tool.ts
  │   │   │   ├── schema.ts
  │   │   │   ├── registry.ts
  │   │   │   └── executor.ts
  │   │   ├── state/
  │   │   │   ├── state.ts
  │   │   │   ├── state-store.ts
  │   │   │   ├── checkpoint.ts
  │   │   │   └── session.ts
  │   │   ├── context/
  │   │   │   ├── context.ts
  │   │   │   └── instructions.ts
  │   │   ├── events/
  │   │   │   ├── hooks.ts
  │   │   │   └── event-bus.ts
  │   │   ├── security/
  │   │   │   ├── permissions.ts
  │   │   │   └── human-input.ts
  │   │   ├── extensions/
  │   │   │   ├── skills.ts
  │   │   │   ├── plugins.ts
  │   │   │   └── subagent.ts
  │   │   └── workflow/
  │   │       ├── plan-mode.ts
  │   │       ├── todo.ts
  │   │       └── structured-output.ts
  │   ├── memory/
  │   │   ├── base.ts
  │   │   ├── manager.ts
  │   │   ├── strategies.ts
  │   │   ├── conversation.ts
  │   │   ├── vector.ts
  │   │   ├── key-value.ts
  │   │   ├── composite.ts
  │   │   ├── working.ts
  │   │   ├── episodic.ts
  │   │   ├── graph.ts
  │   │   ├── self-editing.ts
  │   │   └── file.ts
  │   ├── middleware/
  │   │   ├── base.ts
  │   │   ├── logging.ts
  │   │   ├── cost-tracker.ts
  │   │   ├── rate-limit.ts
  │   │   ├── tracing.ts
  │   │   ├── guardrails.ts
  │   │   ├── prometheus.ts
  │   │   └── consumers.ts
  │   ├── models/
  │   │   ├── llm.ts
  │   │   ├── agent.ts
  │   │   ├── events.ts
  │   │   └── errors.ts
  │   ├── mcp/
  │   │   ├── client.ts
  │   │   ├── config.ts
  │   │   ├── transport.ts
  │   │   ├── adapter.ts
  │   │   └── bridge.ts
  │   ├── cli/
  │   │   └── cli.ts
  │   ├── persistence/
  │   │   ├── base.ts
  │   │   ├── sqlite.ts
  │   │   ├── postgres.ts
  │   │   ├── memory.ts
  │   │   └── audit-hooks.ts
  │   ├── credentials/
  │   │   └── credentials.ts
  │   ├── resilience/
  │   │   └── circuit-breaker.ts
  │   ├── connectors/
  │   │   ├── base.ts
  │   │   └── bridge.ts
  │   ├── testing/
  │   │   ├── mock-llm.ts
  │   │   ├── harness.ts
  │   │   ├── replay.ts
  │   │   ├── toolkit.ts
  │   │   ├── eval.ts
  │   │   ├── coverage.ts
  │   │   ├── regression.ts
  │   │   └── snapshot.ts
  │   ├── tools/
  │   │   ├── web-fetch.ts
  │   │   ├── code-execute.ts
  │   │   ├── shell-execute.ts
  │   │   ├── file-read.ts
  │   │   ├── file-write.ts
  │   │   ├── http-request.ts
  │   │   ├── computer-use.ts
  │   │   └── browser.ts
  │   └── utils/
  │       ├── async.ts
  │       ├── hash.ts
  │       └── logger.ts
  ├── tests/
  │   ├── unit/
  │   ├── integration/
  │   └── fixtures/
  ├── package.json
  ├── tsconfig.json
  ├── vitest.config.ts
  ├── .eslintrc.cjs
  ├── .prettierrc
  └── IMPLEMENTATION_PLAN.md
  ```
- [x] Set up ESLint + Prettier
- [x] Set up Vitest
- [x] Set up tsup for building (dual ESM/CJS output)
- [x] Configure `package.json` exports:
  ```json
  {
    "name": "curio-agent-sdk",
    "type": "module",
    "main": "dist/index.cjs",
    "module": "dist/index.js",
    "types": "dist/index.d.ts",
    "exports": {
      ".": {
        "import": "./dist/index.js",
        "require": "./dist/index.cjs",
        "types": "./dist/index.d.ts"
      },
      "./testing": {
        "import": "./dist/testing/index.js",
        "types": "./dist/testing/index.d.ts"
      },
      "./memory/*": {
        "import": "./dist/memory/*.js",
        "types": "./dist/memory/*.d.ts"
      },
      "./middleware/*": {
        "import": "./dist/middleware/*.js",
        "types": "./dist/middleware/*.d.ts"
      }
    },
    "sideEffects": false
  }
  ```

### 1.2 Core Type Definitions (models/)
- [x] `models/llm.ts` — LLM data types:
  ```typescript
  interface LLMRequest {
    messages: Message[];
    model: string;
    tools?: ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    responseFormat?: ResponseFormat;
    stop?: string[];
    metadata?: Record<string, unknown>;
  }

  interface LLMResponse {
    content: string;
    toolCalls: ToolCall[];
    usage: TokenUsage;
    model: string;
    finishReason: FinishReason;
    thinking?: string;
    metadata?: Record<string, unknown>;
  }

  interface LLMStreamChunk {
    type: 'text_delta' | 'tool_call_delta' | 'thinking_delta' | 'usage' | 'done';
    text?: string;
    toolCall?: Partial<ToolCall>;
    thinking?: string;
    usage?: Partial<TokenUsage>;
  }

  interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | ContentPart[];
    toolCalls?: ToolCall[];
    toolCallId?: string;
    name?: string;
  }

  type ContentPart = TextContent | ImageContent;
  interface TextContent { type: 'text'; text: string; }
  interface ImageContent { type: 'image_url'; imageUrl: { url: string }; }

  interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }

  interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }

  type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter';
  ```

- [x] `models/agent.ts` — Agent result types:
  ```typescript
  interface AgentRunResult {
    output: string;
    messages: Message[];
    toolCalls: ToolCallRecord[];
    usage: TokenUsage;
    iterations: number;
    runId: string;
    duration: number;
    metadata?: Record<string, unknown>;
  }

  interface ToolCallRecord {
    toolName: string;
    arguments: Record<string, unknown>;
    result: string;
    error?: string;
    duration: number;
  }
  ```

- [x] `models/events.ts` — Event types:
  ```typescript
  enum EventType {
    RUN_STARTED = 'run.started',
    RUN_COMPLETED = 'run.completed',
    RUN_ERROR = 'run.error',
    ITERATION_STARTED = 'iteration.started',
    ITERATION_COMPLETED = 'iteration.completed',
    LLM_CALL_STARTED = 'llm.call.started',
    LLM_CALL_COMPLETED = 'llm.call.completed',
    TOOL_CALL_STARTED = 'tool.call.started',
    TOOL_CALL_COMPLETED = 'tool.call.completed',
  }

  interface AgentEvent {
    type: EventType;
    timestamp: Date;
    data: Record<string, unknown>;
    runId: string;
    agentId: string;
    iteration: number;
  }

  // Discriminated union for stream events
  type StreamEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'tool_call_start'; toolName: string; arguments: Record<string, unknown> }
    | { type: 'tool_call_end'; toolName: string; result: string; error?: string }
    | { type: 'thinking'; text: string }
    | { type: 'iteration_start'; iteration: number }
    | { type: 'iteration_end'; iteration: number }
    | { type: 'error'; error: Error }
    | { type: 'done'; result: AgentRunResult };
  ```

- [x] `models/errors.ts` — Error hierarchy:
  ```typescript
  class CurioError extends Error { }
  class LLMError extends CurioError { }
  class LLMRateLimitError extends LLMError { retryAfter?: number; }
  class LLMAuthenticationError extends LLMError { }
  class LLMProviderError extends LLMError { statusCode?: number; }
  class LLMTimeoutError extends LLMError { }
  class NoAvailableModelError extends LLMError { }
  class CostBudgetExceeded extends LLMError { }
  class ToolError extends CurioError { }
  class ToolNotFoundError extends ToolError { }
  class ToolExecutionError extends ToolError { }
  class ToolTimeoutError extends ToolError { }
  class ToolValidationError extends ToolError { }
  ```

### 1.3 Base Component
- [x] `base/component.ts`:
  ```typescript
  abstract class Component {
    abstract startup(): Promise<void>;
    abstract shutdown(): Promise<void>;
    healthCheck(): Promise<boolean> { return Promise.resolve(true); }
  }
  ```

---

<a id="phase-2"></a>
## Phase 2: Core Agent & Runtime ✅ COMPLETED

> **Completed on**: 2026-03-01
>
> **What was implemented**:
>
> **Core Agent (`core/agent/agent.ts`)**:
> - `Agent` class — top-level user-facing API
> - Static `Agent.builder()` → `AgentBuilder` (fluent construction)
> - `run(input, options?)` / `arun(input, options?)` → `Promise<AgentRunResult>`
> - `astream(input, options?)` → `AsyncIterableIterator<StreamEvent>` (streaming)
> - `close()` → graceful shutdown + `Symbol.asyncDispose` support
> - Properties: `agentId`, `agentName`, `model`, `tools`, `toolRegistry`, `hookRegistry`, `metadata`, `closed`
> - Guards: throws if agent is closed
>
> **Agent Builder (`core/agent/builder.ts`)**:
> - Fluent API with full method chaining: `.model()`, `.systemPrompt()` (string or `() => string`), `.tools()`, `.tool()`, `.llmClient()`, `.loop()`, `.hook()`, `.maxIterations()`, `.timeout()`, `.agentId()`, `.agentName()`, `.onEvent()`, `.metadata()`
> - Wires all components: ToolRegistry, HookRegistry, ToolExecutor, ToolCallingLoop, Runtime
> - Validates required deps (LLM client)
> - Builder methods for middleware, memory, permissions, skills, subagents, MCP will be added in their respective phases
>
> **Runtime (`core/agent/runtime.ts`)**:
> - `createState(input, options?)` — builds AgentState with system prompt + user message + tool schemas
> - `runWithState(state)` — executes agent loop to completion, returns `AgentRunResult`
> - `streamWithState(state)` — async generator yielding `StreamEvent`s (iteration_start/end, text_delta, tool_call_start/end, done, error)
> - Hook emission: `agent.run.before`, `agent.run.after`, `agent.run.error`
> - Timeout management (marks state as completed on deadline)
> - Max iteration enforcement
> - Supports dynamic system prompts (lazy function evaluation)
>
> **Also implemented as prerequisites (early pull-forward from later phases)**:
>
> - **Tool System (`core/tools/`)**: `Tool` class, `ToolConfig`, `ToolRegistry` (register/get/has/getAll/getSchemas/iterator), `ToolExecutor` (execute with timeout+retry, parallel execution)
> - **Agent Loop (`core/loops/`)**: `AgentLoop` interface, `ToolCallingLoop` (standard think→act→observe pattern with parallel tool execution, hook emission for iteration/LLM/tool lifecycle, cancellation via hooks)
> - **State (`core/state/state.ts`)**: `AgentState` with messages, toolSchemas, iteration tracking, TokenUsage accumulation, metrics, toolCallRecords, extensions (typed), metadata (Map), checkpoint serialization/deserialization, AbortSignal support
> - **Hooks (`core/events/hooks.ts`)**: `HookRegistry` with priority-ordered handlers, async emit, cancel/modify via `HookContext`, on/off/clear
> - **LLM Interface (`core/llm/client.ts`)**: `ILLMClient` interface (call + stream)
>
> **Tests**: 45 new tests (93 total across 4 files — all passing)
> - Tool: execute, schema, registry (register, get, duplicate, getOrThrow, schemas, iterable)
> - ToolExecutor: execute, missing tool, error handling, parallel execution
> - HookRegistry: register, emit, priority order, cancel, remove, hasHandlers
> - AgentState: defaults, messages, usage accumulation, extensions, checkpoint round-trip, abort signal
> - ToolCallingLoop: text-only response, tool call + continue, shouldContinue, hook firing (10 hooks in correct order), hook cancellation of tool calls
> - Runtime: createState (system prompt + user msg), dynamic system prompt, run to completion, run with tools, lifecycle hooks, error hook, streaming, max iterations
> - Agent (builder integration): construction, simple conversation, tool-using conversation, streaming, hooks via builder, close guard, tools exposure, builder validation, metadata
>
> **Build**: ESM + CJS + DTS output. Index grew to ~28KB ESM, ~34KB types.

### 2.1 Agent Class
- [x] `core/agent/agent.ts`:
  - Constructor accepting all components
  - Static `builder()` method returning `AgentBuilder`
  - `run(input: string): Promise<AgentRunResult>` (sync wrapper)
  - `arun(input: string, options?: RunOptions): Promise<AgentRunResult>`
  - `astream(input: string, options?: RunOptions): AsyncIterableIterator<StreamEvent>`
  - `close(): Promise<void>`
  - Implements `AsyncDisposable` (`await using agent = ...`)
  - Properties: `agentId`, `agentName`, `runtime`, `tools`, `model`

### 2.2 Agent Builder
- [x] `core/agent/builder.ts`:
  - Fluent API with method chaining
  - Type-safe builder (generic accumulation pattern)
  - Methods:
    - `.model(model: string)`
    - `.systemPrompt(prompt: string | (() => string))`
    - `.tools(tools: Tool[])`
    - `.tool(tool: Tool)`
    - `.middleware(middleware: Middleware[])` — placeholder, wired in Phase 8
    - `.memoryManager(manager: MemoryManager)` — placeholder, wired in Phase 9
    - `.stateStore(store: StateStore)` — placeholder, wired in Phase 6
    - `.sessionManager(manager: SessionManager)` — placeholder, wired in Phase 6
    - `.permissions(policy: PermissionPolicy)` — placeholder, wired in Phase 11
    - `.humanInput(handler: HumanInputHandler)` — placeholder, wired in Phase 11
    - `.hook(event: string, handler: HookHandler, priority?: number)`
    - `.skill(skill: Skill)` — placeholder, wired in Phase 12
    - `.subagent(name: string, config: SubagentConfig)` — placeholder, wired in Phase 12
    - `.mcpServer(name: string, config: MCPServerConfig)` — placeholder, wired in Phase 13
    - `.plugin(plugin: Plugin)` — placeholder, wired in Phase 12
    - `.contextManager(manager: ContextManager)` — placeholder, wired in Phase 10
    - `.onEvent(handler: (event: AgentEvent) => void)`
    - `.maxIterations(n: number)`
    - `.timeout(ms: number)`
    - `.build(): Agent`

### 2.3 Runtime
- [x] `core/agent/runtime.ts`:
  - `createState(input: string): AgentState`
  - `runWithState(state: AgentState): Promise<AgentRunResult>`
  - `streamWithState(state: AgentState): AsyncIterableIterator<StreamEvent>`
  - Hook emission (agent.run.before/after/error)
  - Memory injection/saving — wired in Phase 9
  - State persistence — wired in Phase 6
  - Timeout management via `AbortController`

---

<a id="phase-3"></a>
## Phase 3: LLM Client & Providers ✅ COMPLETED

> **Completed**: Phase 3 implemented all LLM provider abstractions, 4 provider implementations,
> tiered routing, token counting, and the full LLMClient with retry/dedup/usage tracking.
>
> **Files created/updated**:
> - `src/core/llm/providers/base.ts` — `LLMProvider` interface + `parseModelString()` utility
> - `src/core/llm/providers/openai.ts` — OpenAI provider (GPT-4o, o1, o3) with lazy SDK loading, streaming with tool call assembly across chunks
> - `src/core/llm/providers/anthropic.ts` — Anthropic provider (Claude Opus/Sonnet/Haiku) with extended thinking, prompt caching usage tracking
> - `src/core/llm/providers/groq.ts` — Groq provider delegating to OpenAI-compatible API
> - `src/core/llm/providers/ollama.ts` — Ollama provider via native `fetch()`, NDJSON streaming, no SDK dependency
> - `src/core/llm/providers/index.ts` — Barrel exports
> - `src/core/llm/router.ts` — `TieredRouter` with 3-tier model selection, env var auto-discovery, degradation strategies
> - `src/core/llm/token-counter.ts` — `countStringTokens()`, `countMessageTokens()` with gpt-tokenizer for OpenAI, char-based fallback, LRU cache
> - `src/core/llm/client.ts` — Full `LLMClient` with provider management, auto-discovery from env vars, dedup cache, retry on rate limit/5xx, usage tracking
> - `src/core/llm/index.ts` — Full exports for all Phase 3 types
> - `src/index.ts` — Updated with Phase 3 exports
> - `tests/unit/llm.test.ts` — 36 tests (parseModelString, TieredRouter, TokenCounter, LLMClient, OllamaProvider, GroqProvider)
>
> **Test results**: 129 tests passing (36 new), build successful (ESM+CJS+DTS).
>
> **Key design decisions**:
> - Providers are lazy-loaded (SDK `import()` only when first used) to avoid requiring all provider SDKs
> - `Record<string, unknown>` params cast via `unknown` for SDK compatibility without coupling to SDK internals
> - Groq reuses OpenAI provider with custom baseUrl (100% OpenAI-compatible API)
> - Ollama uses raw `fetch()` — no SDK needed, works with any locally-pulled model
> - Auto-discovery checks env vars (OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, OLLAMA_HOST)

### 3.1 Provider Interface
- [x] `core/llm/providers/base.ts` — `LLMProvider` interface + `parseModelString()`

### 3.2 Provider Implementations
- [x] `providers/openai.ts` — OpenAI provider (gpt-4o, gpt-4o-mini, gpt-4-turbo, o1, o3)
- [x] `providers/anthropic.ts` — Anthropic provider (claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5)
- [x] `providers/groq.ts` — Groq provider (OpenAI-compatible)
- [x] `providers/ollama.ts` — Ollama provider (HTTP API, native fetch)

### 3.3 LLM Client
- [x] `core/llm/client.ts` — Full implementation with provider management, dedup, retry, usage tracking

### 3.4 Tiered Router
- [x] `core/llm/router.ts` — 3-tier routing with degradation strategies

### 3.5 Token Counter
- [x] `core/llm/token-counter.ts` — gpt-tokenizer + char estimation + cache

---

<a id="phase-4"></a>
## Phase 4: Tool System ✅ COMPLETED

> **Completed**: Phase 4 implementation adds ToolSchemaDefinition/fromZod, createTool/tool decorator,
> ToolExecutor with caching (TTL), idempotency, hooks (tool.call.before/after/error), and optional
> PermissionPolicy. Tests in `tests/unit/tools.test.ts`.

### 4.1 Tool Class
- [x] `core/tools/tool.ts`:
  ```typescript
  interface ToolConfig {
    timeout?: number;
    maxRetries?: number;
    requireConfirmation?: boolean;
    cacheTtl?: number;
    idempotent?: boolean;
  }

  class Tool {
    name: string;
    description: string;
    schema: ToolSchema;
    config: ToolConfig;
    execute(args: Record<string, unknown>): Promise<string>;
  }

  // Factory function (replaces Python @tool decorator)
  function createTool(options: {
    name: string;
    description: string;
    parameters: ZodSchema;
    config?: ToolConfig;
    execute: (args: any) => string | Promise<string>;
  }): Tool;

  // Decorator (alternative)
  function tool(options?: Partial<ToolConfig>): MethodDecorator;
  ```

### 4.2 Schema System
- [x] `core/tools/schema.ts`:
  - Zod → JSON Schema conversion (using `zod-to-json-schema`)
  - `ToolSchema` class with `validate()`, `toJsonSchema()`, `toLLMSchema()`
  - `fromZod(schema: ZodSchema): ToolSchema`
  - Support for all JSON Schema types

### 4.3 Tool Registry
- [x] `core/tools/registry.ts`:
  - `register(tool: Tool): void`
  - `get(name: string): Tool | undefined`
  - `has(name: string): boolean`
  - `getAll(): Tool[]`
  - `getSchemas(): ToolSchema[]`
  - Iterable interface

### 4.4 Tool Executor
- [x] `core/tools/executor.ts`:
  - `executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult>`
  - `executeParallel(calls: ToolCall[]): Promise<ToolResult[]>`
  - Timeout enforcement
  - Retry with backoff
  - Caching (TTL-based)
  - Permission checking (delegate to PermissionPolicy)
  - Hook emission (tool.call.before/after/error)

---

<a id="phase-5"></a>
## Phase 5: Agent Loop ✅ COMPLETED

> **Completed on**: 2026-03-02
>
> **What was implemented**:
> - **Loop interface** (`core/loops/base.ts`): `AgentLoop` with `step()`, `shouldContinue()`, and optional `streamStep()` for streaming.
> - **Tool calling loop** (`core/loops/tool-calling.ts`): Standard pattern (Call LLM → parse tool calls → execute → loop), **parallel tool execution** via `ToolCallingLoopOptions.parallelToolCalls` and `ToolExecutor.executeParallel()`, **max iterations** enforced in `shouldContinue()`, **structured output** via `responseFormat` when no tools are registered, **stream delegation** via `streamStep()` (yields `text_delta`, `tool_call_start`/`tool_call_end`, `thinking`, `iteration_end` as the LLM streams and tools run), hook emission (iteration.before/after, llm.call.before/after/error, tool lifecycle in executor). Runtime uses `streamStep()` when available for real-time events during streaming.

### 5.1 Loop Interface
- [x] `core/loops/base.ts`:
  ```typescript
  interface AgentLoop {
    step(state: AgentState): Promise<AgentState>;
    shouldContinue(state: AgentState): boolean;
    streamStep?(state: AgentState): AsyncIterableIterator<StreamEvent>;
  }
  ```

### 5.2 Tool Calling Loop
- [x] `core/loops/tool-calling.ts`:
  - Standard pattern: Call LLM → parse tool calls → execute → loop
  - Parallel tool execution
  - Max iterations enforcement
  - Structured output support (responseFormat when no tools)
  - Stream delegation (yield events during execution via streamStep)
  - Hook emission (iteration.before/after)

---

<a id="phase-6"></a>
## Phase 6: State Management ✅ COMPLETED

> **Completed**: Phase 6 implements AgentState extensions (transition history, getExtensionsForCheckpoint/setExtensionsFromCheckpoint), checkpoint serialization (version-tagged CheckpointData, serializeMessage/deserializeMessage, checkpointFromState/stateFromCheckpoint, serializeCheckpoint/deserializeCheckpoint), StateStore (InMemoryStateStore, FileStateStore), Session (Session, SessionStore, InMemorySessionStore, FileSessionStore, SessionManager), and wires stateStore/sessionManager in the builder and runtime (state persistence after run, session history load/save in Agent.arun).
>
> **Files created/updated**:
> - `src/core/state/state.ts` — Added transition history (recordTransition, getTransitionHistory, setTransitionHistory), getExtensionsForCheckpoint(), setExtensionsFromCheckpoint(); existing AgentState, StateExtension, toCheckpoint/fromCheckpoint retained.
> - `src/core/state/checkpoint.ts` — CHECKPOINT_VERSION, CheckpointData, SerializedMessage, serializeMessage/deserializeMessage, checkpointFromState/stateFromCheckpoint, serializeCheckpoint/deserializeCheckpoint.
> - `src/core/state/state-store.ts` — StateStore interface (save, load with optional StateStoreLoadOptions, list(agentId?), delete), InMemoryStateStore, FileStateStore.
> - `src/core/state/session.ts` — Session, touchSession, SessionStore (create, get, list, delete, addMessage, getMessages), InMemorySessionStore, FileSessionStore, SessionManager.
> - `src/core/state/index.ts` — Exports for checkpoint, state-store, session.
> - `src/core/agent/builder.ts` — .stateStore(store), .sessionManager(manager); stateStore passed to Runtime, sessionManager passed to Agent.
> - `src/core/agent/runtime.ts` — stateStore in RuntimeConfig; createState uses options.initialMessages; after run, stateStore.save(state).
> - `src/core/agent/agent.ts` — sessionManager in AgentParams; arun loads session history when sessionId + sessionManager, passes initialMessages to createState; after run, appends new messages to session.
> - `src/models/agent.ts` — RunOptions.initialMessages added.
> - `src/index.ts` — Public exports for checkpoint, state-store, session.
> - `tests/unit/state.test.ts` — 23 tests for checkpoint (message roundtrip, checkpointFromState/stateFromCheckpoint, serialize/deserialize JSON), AgentState transition history, InMemoryStateStore, FileStateStore, InMemorySessionStore, SessionManager, FileSessionStore, touchSession.
>
> **Test results**: 163 tests passing (23 new in state.test.ts). Build successful.

### 6.1 Agent State
- [x] `core/state/state.ts`:
  - AgentState with messages, toolSchemas, iteration, maxIterations, metadata, metrics, extensions, runId, usage, toolCallRecords, completed, output, model, signal; addMessage, getExtension, setExtension, toCheckpoint, fromCheckpoint (existing).
  - StateExtension (toDict); StateExtensionFactory for fromDict-style restoration via setExtensionsFromCheckpoint.
  - Transition history: recordTransition(phase), getTransitionHistory(), setTransitionHistory(); getExtensionsForCheckpoint(), setExtensionsFromCheckpoint(data, factories).

### 6.2 State Store
- [x] `core/state/state-store.ts`:
  - StateStore: save(state), load(runId, options?), list(agentId?), delete(runId).
  - InMemoryStateStore, FileStateStore (directory, one JSON file per run).

### 6.3 Checkpoint
- [x] `core/state/checkpoint.ts`:
  - Serialize/deserialize AgentState to JSON; CHECKPOINT_VERSION; CheckpointData (version, runId, agentId, iteration, timestamp, messages, toolSchemas, metadata, usage, metrics, toolCallRecords, extensions, completed, output, model, maxIterations, transitionHistory).
  - serializeMessage/deserializeMessage; checkpointFromState(state), stateFromCheckpoint(data, extensionFactories); serializeCheckpoint/deserializeCheckpoint.

### 6.4 Session Management
- [x] `core/state/session.ts`:
  - Session (id, agentId, metadata, createdAt, updatedAt), touchSession.
  - SessionStore: create(agentId, metadata?), get(sessionId), list(agentId?, limit?), delete(sessionId), addMessage(sessionId, message), getMessages(sessionId, limit?).
  - InMemorySessionStore, FileSessionStore (directory per session, meta.json + messages.json).
  - SessionManager(store): create, get, listSessions, delete, addMessage, getMessages.

---

<a id="phase-7"></a>
## Phase 7: Hooks & Events ✅ COMPLETED

> **Completed**: Phase 7 implements the hook system and event bus. HookContext (in `models/events.ts`) now supports optional `state`, and `isCancelled()` in addition to the `cancelled` getter. HookRegistry (`core/events/hooks.ts`) provides `on`, `off`, `emit`, `listHandlers`, priority-based execution, and async handler support. Event bus (`core/events/event-bus.ts`) provides EventBus interface, EventFilter (glob pattern matching), InMemoryEventBus (Component lifecycle, publish, subscribe returning Unsubscribe, replay from Date, dead letter queue), and DeadLetterEntry type. All exported from `core/events/index.ts` and main `index.ts`. Tests in `tests/unit/events.test.ts` (22 tests).

### 7.1 Hook System
- [x] `core/events/hooks.ts`:
  - HookHandler type and HookRegistry with `on`, `off`, `emit`, `listHandlers`, `hasHandlers`, `handlerCount`, `getRegisteredEvents`, `clear`
  - Priority-based execution order (lower number = earlier)
  - Async handler support; emit stops after cancel
- [x] HookContext in `models/events.ts`: `event`, `data`, optional `state`, `runId`, `agentId`, `iteration`, `cancel()`, `modify()`, `isCancelled()`, `cancelled` getter
- [x] 16 built-in events via `HookEvent` constant object

### 7.2 Event Bus
- [x] `core/events/event-bus.ts`:
  - `EventBus` interface: `subscribe(pattern, handler) => Unsubscribe`, `publish(event)`, `replay(startTime, pattern?) => AsyncIterableIterator<AgentEvent>`, `deadLetters`
  - `EventFilter`: glob pattern matching (`*`, `?`, dotted names)
  - `InMemoryEventBus` extends Component: startup/shutdown, bounded history, dead letter queue, `clearDeadLetters()`, `clearHistory()`
  - EventType → hook-style name mapping for pattern matching

---

<a id="phase-8"></a>
## Phase 8: Middleware Pipeline ✅ COMPLETED

> **Completed**: Middleware interface, pipeline with hook emission, wrapLLMClient, built-in middleware (logging, cost-tracker, rate-limit, tracing, guardrails, prometheus, consumers). Builder `.middleware()` / `.addMiddleware()`, executor runs pipeline for tool before/after. Loop request metadata includes runId/agentId for pipeline. Tests in `tests/unit/middleware.test.ts`.

### 8.1 Middleware Interface
- [x] `middleware/base.ts`:
  ```typescript
  interface Middleware {
    name: string;
    beforeLLMCall?(request: LLMRequest): Promise<LLMRequest | void>;
    afterLLMCall?(request: LLMRequest, response: LLMResponse): Promise<LLMResponse | void>;
    onLLMStreamChunk?(request: LLMRequest, chunk: LLMStreamChunk): Promise<LLMStreamChunk | void>;
    beforeToolCall?(toolName: string, args: Record<string, unknown>): Promise<{ toolName: string; args: Record<string, unknown> } | void>;
    afterToolCall?(toolName: string, args: Record<string, unknown>, result: string): Promise<string | void>;
    onError?(error: Error, context: Record<string, unknown>): Promise<Error | null>;
  }

  class MiddlewarePipeline {
    add(middleware: Middleware): void;
    runBeforeLLMCall(request: LLMRequest, runId?, agentId?): Promise<LLMRequest>;
    runAfterLLMCall(request: LLMRequest, response: LLMResponse, runId?, agentId?): Promise<LLMResponse>;
    runOnLLMStreamChunk(...): Promise<LLMStreamChunk | undefined>;
    runBeforeToolCall(toolName, args): Promise<{ toolName; args }>;
    runAfterToolCall(toolName, args, result): Promise<string>;
    runOnError(error, context, runId?, agentId?): Promise<Error | null>;
    wrapLLMClient(inner): T;
  }
  ```

### 8.2 Built-in Middleware
- [x] `middleware/logging.ts` — Structured logging (pino-compatible)
- [x] `middleware/cost-tracker.ts` — Budget enforcement, per-model breakdown
- [x] `middleware/rate-limit.ts` — Token bucket rate limiting
- [x] `middleware/tracing.ts` — OpenTelemetry spans (no-op if @opentelemetry/api not installed)
- [x] `middleware/guardrails.ts` — Content safety, regex blocking, prompt-injection heuristic
- [x] `middleware/prometheus.ts` — Prometheus metrics export (no-op if prom-client not installed)
- [x] `middleware/consumers.ts` — TracingConsumer, LoggingConsumer, PersistenceConsumer, getTraceContext

---

<a id="phase-9"></a>
## Phase 9: Memory System ✅ COMPLETED

> **Completed on**: 2026-03-02
>
> **What was implemented**:
>
> **Base types (`memory/base.ts`)**:
> - `MemoryEntry` class (id, content, metadata, relevance, createdAt, updatedAt) with `toDict()`/`fromDict()` serialization
> - `Memory` interface (add, search, getContext, optional get/delete/clear/count)
>
> **Strategies (`memory/strategies.ts`)**:
> - `MemoryInjectionStrategy` interface with 3 implementations: `DefaultInjection` (system message at position 1), `UserMessageInjection` (append to last user msg), `NoInjection`
> - `MemorySaveStrategy` interface with 5 implementations: `DefaultSave`, `SaveEverythingStrategy` (+ tool results), `SaveSummaryStrategy` (custom summarizer fn), `NoSave`, `PerIterationSave`
> - `MemoryQueryStrategy` interface with 3 implementations: `DefaultQuery`, `KeywordQuery` (stop word removal), `AdaptiveTokenQuery` (budget decays with conversation length)
>
> **MemoryManager (`memory/manager.ts`)**:
> - Component lifecycle (delegates to memory if Component)
> - Lifecycle hooks: `inject()`, `onRunStart()`, `onRunEnd()`, `onRunError()`, `onIteration()`, `onToolResult()`
> - Direct memory access: `add()`, `search()`, `getContext()`, `clear()`, `count()`
> - Agent tools: `save_to_memory`, `search_memory`, `forget_memory` (auto-registered in builder)
>
> **9 Memory backends**:
> - `ConversationMemory` — Sliding window (recency + keyword scoring)
> - `VectorMemory` — Cosine similarity with embeddings (Component lifecycle, optional disk persistence, OpenAI fallback + simple hash embedding)
> - `KeyValueMemory` — Named facts with key/content matching
> - `WorkingMemory` — Ephemeral scratchpad (key-value, returns all in context)
> - `EpisodicMemory` — Temporal episodes with importance scoring and time-range filtering
> - `GraphMemory` — Entity-relationship triples with indexed querying
> - `CompositeMemory` — Multi-backend routing with dedup and per-memory token budgets
> - `SelfEditingMemory` — MemGPT-style core + archival memory with 5 agent tools (core_memory_read/write/replace, archival_memory_search/insert)
> - `FileMemory` — Disk-persisted per-entry JSON files with Component lifecycle and namespace scoping
>
> **Policies (`memory/policies.ts`)**:
> - `importanceScore()`, `decayScore()` (exponential half-life), `combinedRelevance()` (weighted blend), `summarizeOldMemories()` (compress old entries)
>
> **Wiring**:
> - Builder: `.memoryManager(manager)` method, auto-registers memory tools into ToolRegistry
> - Runtime: Memory injection before loop, `onRunStart`/`onRunEnd`/`onRunError` hooks
> - Barrel exports in `src/memory/index.ts` and `src/index.ts`
>
> **Tests**: 73 new tests (273 total across 10 files — all passing)
> - MemoryEntry: creation, toDict/fromDict roundtrip
> - ConversationMemory: add/get, eviction, search, context, delete, clear
> - KeyValueMemory: set/get, update, search with key boost, context
> - WorkingMemory: write/read, context (all entries), clear
> - EpisodicMemory: record/recall, importance ranking, time filtering, eviction, Episode roundtrip
> - GraphMemory: entities/relations, triple query, content parsing, metadata, Triple roundtrip, context
> - CompositeMemory: route to all, memory_targets, merged search, dedup, sub-memory access, count
> - SelfEditingMemory: tools list, core write/read/replace, char limit, archival insert/search, context
> - VectorMemory: add/search, batch add, delete/clear, context with relevance
> - FileMemory: add/retrieve, survive restart, keyword search, delete, clear, namespace scoping
> - Strategies: DefaultInjection, UserMessageInjection, NoInjection, DefaultSave, SaveEverything, PerIteration, NoSave, DefaultQuery, KeywordQuery, AdaptiveTokenQuery
> - MemoryManager: tools, inject, Component delegation, tool execution, onRunEnd
> - Policies: importanceScore, decayScore, combinedRelevance
>
> **Build**: ESM + CJS + DTS output. Type-checking passes.
>
> **Post-completion fixes (strategy signatures & tests)**:
> - `memory/strategies.ts`: `NoInjection.inject()` updated to implement `MemoryInjectionStrategy` with full signature `inject(_state, _memory, _query)` (was previously no-arg).
> - `tests/unit/memory.test.ts`: NoSave test casts to `MemorySaveStrategy` when asserting `onRunEnd` is undefined (NoSave does not declare the optional property). DefaultQuery test calls `buildQuery("hello world")` and `maxTokens()` with no extra args to match implementations. KeywordQuery test calls `buildQuery("...")` with one argument only. All 73 memory tests pass; linter clean.

### 9.1 Memory Interface
- [x] `memory/base.ts`:
  ```typescript
  interface MemoryEntry {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    timestamp: Date;
    source?: string;
  }

  interface Memory {
    add(entry: MemoryEntry): Promise<void>;
    search(query: string, limit?: number): Promise<MemoryEntry[]>;
    getContext(): Promise<string>;
    clear(): Promise<void>;
  }
  ```

### 9.2 Memory Manager
- [x] `memory/manager.ts`:
  - Pluggable strategies (injection, save, query)
  - Lifecycle management (inject on run start, save on run end)
  ```typescript
  interface MemoryInjectionStrategy {
    inject(memory: Memory, state: AgentState, query: string): Promise<AgentState>;
  }

  interface MemorySaveStrategy {
    onRunStart?(memory: Memory, state: AgentState): Promise<void>;
    onRunEnd?(memory: Memory, state: AgentState, result: AgentRunResult): Promise<void>;
    onIteration?(memory: Memory, state: AgentState): Promise<void>;
    onToolResult?(memory: Memory, toolName: string, result: string): Promise<void>;
  }

  interface MemoryQueryStrategy {
    buildQuery(input: string, state: AgentState): Promise<string>;
  }
  ```

### 9.3 Memory Implementations (9 backends)
- [x] `memory/conversation.ts` — Sliding window (last N messages)
- [x] `memory/vector.ts` — Semantic search via embeddings (cosine similarity)
- [x] `memory/key-value.ts` — Key-value store
- [x] `memory/composite.ts` — Combine multiple backends with namespace support
- [x] `memory/working.ts` — Ephemeral scratchpad (per-run)
- [x] `memory/episodic.ts` — Temporal episodes with decay
- [x] `memory/graph.ts` — Entity-relationship knowledge graph (triples)
- [x] `memory/self-editing.ts` — MemGPT/Letta-style (core + archival)
- [x] `memory/file.ts` — File-based persistent memory (MEMORY.md style)

---

<a id="phase-10"></a>
## Phase 10: Context & Instructions ✅ COMPLETED

> **Completed**: Phase 10 implemented ContextManager (token budget, truncate_oldest/summarize)
> and InstructionLoader (hierarchical file loading, optional file watch). ContextManager is
> wired into the agent builder and ToolCallingLoop so messages are fitted before each LLM call.
>
> **Files created/updated**:
> - `src/core/context/context.ts` — ContextManager with fitMessages(), countTokens(), groupMessages(), truncate_oldest and summarize strategies, optional summarizer callback
> - `src/core/context/instructions.ts` — InstructionLoader with load(), findProjectRoot(), defaultSearchPaths(), loadInstructionsFromFile(), watch() for live reload
> - `src/core/context/index.ts` — Barrel exports
> - `src/core/agent/builder.ts` — contextManager in AgentConfig, .contextManager(), pass to ToolCallingLoop
> - `src/core/loops/tool-calling.ts` — contextManager option, fit messages before LLM request in step() and streamStep()
> - `src/index.ts` — Phase 10 exports
>
> **Test results**: See tests/unit/context.test.ts

### 10.1 Context Manager
- [x] `core/context/context.ts`:
  ```typescript
  class ContextManager {
    constructor(options: { maxTokens: number; reserveTokens?: number; strategy?: 'truncate_oldest' | 'summarize'; summarizer?: (msgs, model, tools) => Message | Promise<Message> });
    countTokens(messages, model, tools?): Promise<number>;
    fitMessages(messages: Message[], tools?: ToolSchema[], model?: string): Promise<Message[]>;
  }
  ```
  - Token budget enforcement
  - Preserve system message
  - Truncation or summarization strategy

### 10.2 Instruction Loader
- [x] `core/context/instructions.ts`:
  - Load from configurable file names (DEFAULT_INSTRUCTION_FILES: AGENT.md, .agent/rules.md)
  - Hierarchical: global (~/.agent) → project root → cwd (findProjectRoot, defaultSearchPaths)
  - loadInstructionsFromFile(path) for single-file load
  - watch(onReload) for live reload; returns unsubscribe

---

<a id="phase-11"></a>
## Phase 11: Security & Permissions ✅ COMPLETED

> **Completed on**: 2026-03-02
>
> **What was implemented**:
> - A fully pluggable **permission system** modeled after the Python `curio_agent_sdk.core.security.permissions` module.
> - File-system and network **sandbox policies** for constraining what tools can access.
> - A **human-in-the-loop confirmation handler** for interactive approval of sensitive tool calls.
> - Wiring of `PermissionPolicy` and `HumanInputHandler` into the `ToolExecutor` and `AgentBuilder`, and public exports from the root `index.ts`.
>
> **Files created/updated**:
> - `src/core/security/permissions.ts` — Core permission types and policies:
>   - `PermissionContext` — open-ended context for checks (`runId`, `agentId`, `toolCallId`, `toolConfig`, plus arbitrary metadata).
>   - `PermissionResult` — result of a check with `{ allowed: boolean; reason?: string; requireConfirmation?: boolean }`.
>   - `PermissionPolicy` — interface with:
>     - `checkToolCall(toolName, args, context): Promise<PermissionResult>`
>     - `checkFileAccess?(path, mode, context): Promise<PermissionResult>`
>     - `checkNetworkAccess?(url, context): Promise<PermissionResult>`
>   - Utility helpers:
>     - `collectPathsFromArgs(args)` — extract `(key, value)` pairs that look like file paths (mirrors `_collect_paths_from_args` in Python).
>     - `collectUrlsFromArgs(args)` — extract `(key, value)` pairs that look like URLs (mirrors `_collect_urls_from_args`).
>   - Concrete policies (1:1 with Python semantics, adapted to TS idioms):
>     - `AllowAll` — allows all tool/file/network actions with no confirmation.
>     - `AskAlways` — allows all tool calls but always sets `requireConfirmation: true` with a human-readable reason.
>     - `AllowReadsAskWrites` — heuristically treats read-like operations as safe and write/execute operations as requiring confirmation:
>       - `checkToolCall` uses a write-like regex over the tool name (matches `write`, `edit`, `delete`, `run`, `execute`, `execute_code`, `shell`, `command`, `remove`, `rm`, `add`, `append`, `modify`, `update`, `install`).
>       - `checkFileAccess` allows `"r"`/`"read"` without confirmation, otherwise sets `requireConfirmation: true`.
>       - `checkNetworkAccess` currently allows all requests (HTTP method–specific checks can be layered on via context).
>     - `CompoundPolicy` — combines multiple policies; evaluates them in order and returns the first deny or confirmation requirement, otherwise allows.
>     - `FileSandboxPolicy` — restricts file access to a list of allowed path prefixes:
>       - Normalizes paths via `node:path.resolve`, uses `path.relative` with fallback string prefix checks to guard against traversal.
>       - `checkToolCall` inspects args via `collectPathsFromArgs()` and forwards to `checkFileAccess`.
>       - `checkFileAccess` allows only when the resolved path is equal to or under one of the allowed prefixes; otherwise denies with a reason.
>     - `NetworkSandboxPolicy` — restricts network access to allowed URL patterns:
>       - Accepts a list of string patterns, each compiled either as a `RegExp` or treated as a literal substring.
>       - Validates URLs via the WHATWG `URL` API, denying invalid hosts or non-HTTP(S) schemes.
>       - `checkToolCall` inspects args via `collectUrlsFromArgs()` and forwards to `checkNetworkAccess`.
> - `src/core/security/human-input.ts` — Human input abstraction:
>   - `HumanInputHandler` interface with:
>     - `getUserConfirmation(prompt: string, context?: Record<string, unknown>): Promise<boolean>;`
>   - `CLIHumanInput` implementation:
>     - Uses Node’s `readline` over `process.stdin` / `process.stdout`.
>     - Prompts with `"<prompt> [y/N]:"` and treats `"y"`/`"yes"` (case-insensitive) as approval; everything else denies.
> - `src/core/security/index.ts` — Barrel exports for security:
>   - Types: `PermissionResult`, `PermissionContext`, `PermissionPolicy`, `HumanInputHandler`.
>   - Implementations: `AllowAll`, `AskAlways`, `AllowReadsAskWrites`, `CompoundPolicy`, `FileSandboxPolicy`, `NetworkSandboxPolicy`, `CLIHumanInput`.
>   - Utilities: `collectPathsFromArgs`, `collectUrlsFromArgs`.
> - `src/core/tools/executor.ts` — Permission + human-input wiring:
>   - Imports `PermissionPolicy`, `PermissionContext`, `PermissionResult` and `HumanInputHandler` from `core/security`.
>   - Defines executor-facing aliases:
>     - `ToolPermissionContext extends PermissionContext` with `toolCallId: string`.
>     - `ToolPermissionResult` as a type alias for `PermissionResult`.
>   - Extends `ToolExecutorOptions` with:
>     - `permissionPolicy?: PermissionPolicy;`
>     - `humanInput?: HumanInputHandler;`
>   - Enhances `executeTool`:
>     - Builds a `ToolPermissionContext` from `runId`, `agentId`, `toolCallId`, and `toolConfig`.
>     - Calls `permissionPolicy.checkToolCall(toolName, args, context)`.
>     - If `allowed === false` and `requireConfirmation !== true`, returns a `ToolResult` error (`"Permission denied: <reason>"`) and emits `tool.call.error`.
>     - If `requireConfirmation === true`:
>       - When `humanInput` is configured, constructs a multi-line prompt (header, tool name, JSON-formatted args, optional reason) and calls `humanInput.getUserConfirmation(...)` with context; denies with `"Permission denied by human operator"` if the user declines.
>       - When `humanInput` is missing, denies with `"Permission denied: <reason or default message>"` and emits `tool.call.error`, ensuring safe default behavior.
> - `src/core/agent/builder.ts` — Builder integration:
>   - `AgentConfig` extended with:
>     - `permissionPolicy?: PermissionPolicy;`
>     - `humanInput?: HumanInputHandler;`
>   - New fluent methods:
>     - `.permissions(policy: PermissionPolicy)` — set the permission policy for the agent.
>     - `.humanInput(handler: HumanInputHandler)` — set the human input handler used for confirmations.
>   - `build()` passes configuration into `ToolExecutor`:
>     - `new ToolExecutor(toolRegistry, { hookRegistry, middlewarePipeline, permissionPolicy, humanInput })`.
> - `src/core/tools/index.ts` — Updated type exports:
>   - Continues to export `PermissionPolicy`, `ToolPermissionContext`, and `ToolPermissionResult` (now backed by the `core/security` definitions).
> - `src/core/security/index.ts` and `src/index.ts` — Public exports:
>   - Root `index.ts` now exports:
>     - Types: `PermissionResult`, `PermissionContext`, `HumanInputHandler`.
>     - Implementations: `AllowAll`, `AskAlways`, `AllowReadsAskWrites`, `CompoundPolicy`, `FileSandboxPolicy`, `NetworkSandboxPolicy`, `CLIHumanInput`.
>   - Existing `PermissionPolicy`, `ToolPermissionContext`, `ToolPermissionResult` exports remain available via the tools barrel.
>
> **Tests**:
> - All existing tests continue to pass (`npm test` → 293 tests, 11 files, all green).
> - Permission and human-input behavior is currently covered indirectly via `ToolExecutor` tests; direct unit tests for `core/security` can be added later to mirror the Python suite more closely.

### 11.1 Permission System
- [x] `core/security/permissions.ts`:
  ```typescript
  interface PermissionResult {
    allowed: boolean;
    reason?: string;
    requireConfirmation?: boolean;
  }

  interface PermissionContext extends Record<string, unknown> {
    runId?: string;
    agentId?: string;
    toolCallId?: string;
    toolConfig?: Record<string, unknown>;
  }

  interface PermissionPolicy {
    checkToolCall(
      toolName: string,
      args: Record<string, unknown>,
      context: PermissionContext,
    ): Promise<PermissionResult>;
    checkFileAccess?(
      path: string,
      mode: string,
      context: PermissionContext,
    ): Promise<PermissionResult>;
    checkNetworkAccess?(
      url: string,
      context: PermissionContext,
    ): Promise<PermissionResult>;
  }

  class AllowAll implements PermissionPolicy { /* allow everything */ }
  class AskAlways implements PermissionPolicy { /* always requireConfirmation */ }
  class AllowReadsAskWrites implements PermissionPolicy { /* read vs write heuristics */ }
  class CompoundPolicy implements PermissionPolicy { /* first deny/confirm wins */ }
  class FileSandboxPolicy implements PermissionPolicy { /* restrict paths to allowed prefixes */ }
  class NetworkSandboxPolicy implements PermissionPolicy { /* restrict URLs to allowed patterns */ }
  ```

### 11.2 Human Input Handler
- [x] `core/security/human-input.ts`:
  ```typescript
  interface HumanInputHandler {
    getUserConfirmation(
      prompt: string,
      context?: Record<string, unknown>,
    ): Promise<boolean>;
  }

  class CLIHumanInput implements HumanInputHandler {
    // Uses Node readline over stdin/stdout; treats "y"/"yes" as approval.
  }
  ```

---

<a id="phase-12"></a>
## Phase 12: Extensions (Skills, Plugins, Subagents) ✅ COMPLETED

> **Completed on**: 2026-03-02
>
> **What was implemented**:
> - **Skills (`core/extensions/skills.ts`)**:
>   - `Skill` class bundling name, description, `systemPrompt`, tools, hooks, and free-form `instructions` markdown.
>   - `Skill.fromDirectory(path)` loads a skill from a filesystem directory containing a YAML/JSON manifest (`skill.yaml` / `skill.yml` / `skill.json`) and optional instructions file (`SKILL.md` / `README.md`).
>   - YAML manifest parsing via the `yaml` npm package with a `SkillManifest` type describing the on-disk format.
>   - `SkillRegistry` — in-memory registry with `register`, `unregister`, `list`, `get`, `activate`, `deactivate`, `isActive`, `getActiveSkills`, and `clear`.
> - **Plugins (`core/extensions/plugins.ts`)**:
>   - `Plugin` interface with `name` and `register(builder: AgentBuilder)`; plugins can mutate the builder configuration before `build()`.
>   - `PluginRegistry` — register/unregister/get/list plus `applyAll(builder)` to invoke all registered plugins on a builder.
>   - `discoverPluginsFromPackageJson()` helper scans the current project's `package.json` for dependencies starting with `curio-plugin-`, dynamically imports each package, and treats any exported object with a compatible shape as a plugin (best-effort discovery).
> - **Subagents (`core/extensions/subagent.ts`, `core/agent/builder.ts`, `core/agent/agent.ts`)**:
>   - `SubagentConfig` type in `core/extensions/subagent.ts`:
>     ```typescript
>     interface SubagentConfig {
>       systemPrompt: string;
>       tools?: Tool[];
>       model?: string;
>       maxIterations?: number;
>       timeout?: number;
>     }
>     ```
>   - `AgentBuilder.subagent(name, config)` registers named subagents on the builder; they are materialized as full `Agent` instances during `build()`, sharing the parent hooks, middleware, state store, and memory manager but with their own system prompt, model, tools, and run limits.
>   - `Agent` now keeps a `subagents` map and exposes:
>     - `spawnSubagent(name, input, options?) => Promise<AgentRunResult>`
>     - `spawnSubagentStream(name, input, options?) => AsyncIterableIterator<StreamEvent>`
>   - Subagents use their own `ToolRegistry`/`ToolExecutor` and `Runtime`, while reusing the same underlying LLM client and hook registry as the parent agent.
> - **Builder integration (`core/agent/builder.ts`)**:
>   - `.skill(skill: Skill)` — attaches a skill to the agent, merging its `systemPrompt`, tools, and hooks into the builder configuration.
>   - `.plugin(plugin: Plugin)` — registers a plugin; plugins are applied once at build time via an internal `PluginRegistry` before registries and runtime are constructed.
>   - `.subagent(name: string, config: SubagentConfig)` — registers named subagents as described above.
> - **Public API exports**:
>   - `src/core/extensions/index.ts` — barrel exports for `Skill`, `SkillRegistry`, `PluginRegistry`, `isPlugin`, `discoverPluginsFromPackageJson`, and `SubagentConfig`.
>   - `src/index.ts` — re-exports core extensions types and utilities, and now exports `SubagentConfig` from the extensions layer instead of `models/agent.ts` (which previously contained a placeholder type).

### 12.1 Skills
- [x] `core/extensions/skills.ts`:
  - `Skill` class with name, description, systemPrompt, tools, hooks, instructions
  - `Skill.fromDirectory(path)` — load from directory
  - YAML/JSON manifest parsing
  - `SkillRegistry` — register, activate, deactivate, list

### 12.2 Plugins
- [x] `core/extensions/plugins.ts`:
  - `Plugin` interface with `register(builder: AgentBuilder)`
  - npm package discovery (`curio-plugin-*`)
  - `PluginRegistry` — register, discover, list

### 12.3 Subagents
- [x] `core/extensions/subagent.ts` and Agent wiring:
  - `SubagentConfig` type describing subagent model/tools/prompts/limits
  - `AgentBuilder.subagent(name, config)` for registration
  - `Agent.spawnSubagent(name, input)` and `Agent.spawnSubagentStream(name, input)` methods

---

<a id="phase-13"></a>
## Phase 13: MCP Integration

### 13.1 MCP Client
- [ ] `mcp/client.ts`:
  - Connect to MCP servers (stdio and HTTP/SSE transport)
  - List tools, call tools
  - List/read resources
  - List/get prompts
  - Use `@modelcontextprotocol/sdk` npm package

### 13.2 MCP Configuration
- [ ] `mcp/config.ts`:
  - Parse Cursor/Claude-style MCP config format
  - Environment variable resolution ($VAR syntax)
  - Server lifecycle management

### 13.3 MCP Transport
- [ ] `mcp/transport.ts`:
  - Stdio transport (spawn child process, JSON-RPC over stdin/stdout)
  - HTTP/SSE transport (Server-Sent Events)

### 13.4 MCP Bridge & Adapter
- [ ] `mcp/bridge.ts` — Component lifecycle for MCP servers
- [ ] `mcp/adapter.ts` — Convert MCP tools to Curio `Tool` objects

---

<a id="phase-14"></a>
## Phase 14: CLI Harness

### 14.1 Agent CLI
- [ ] `cli/cli.ts`:
  ```typescript
  class AgentCLI {
    constructor(agent: Agent, options?: CLIOptions);
    runInteractive(options?: { stream?: boolean; useSessions?: boolean; prompt?: string }): Promise<void>;
    runOnce(): Promise<void>;
    registerCommand(name: string, handler: SlashCommandHandler): void;
    registerKeybinding(key: string, handler: () => void): void;
  }
  ```
  - REPL loop with readline
  - Built-in slash commands: /help, /clear, /status, /sessions, /skills, /exit
  - Streaming output
  - Session persistence
  - Custom command registration

---

<a id="phase-15"></a>
## Phase 15: Built-in Tools

### 15.1 Tool Implementations
- [ ] `tools/web-fetch.ts` — Fetch URL, convert HTML to markdown
- [ ] `tools/code-execute.ts` — Execute code (sandboxed subprocess)
- [ ] `tools/shell-execute.ts` — Execute shell commands (sandboxed)
- [ ] `tools/file-read.ts` — Read file contents
- [ ] `tools/file-write.ts` — Write file contents
- [ ] `tools/http-request.ts` — Generic HTTP requests
- [ ] `tools/computer-use.ts` — GUI automation (optional, robotjs/nut.js)
- [ ] `tools/browser.ts` — Browser automation (Playwright)

### 15.2 Sandboxing
- [ ] Resource limits via `child_process` options (timeout, maxBuffer)
- [ ] Restricted environment variables
- [ ] Working directory confinement
- [ ] No shell injection (exec, not shell=true)

---

<a id="phase-16"></a>
## Phase 16: Persistence & Audit

### 16.1 Persistence Interface
- [ ] `persistence/base.ts`:
  ```typescript
  interface Persistence {
    createAgentRun(run: AgentRun): Promise<void>;
    updateAgentRun(runId: string, update: Partial<AgentRun>): Promise<void>;
    getAgentRun(runId: string): Promise<AgentRun | null>;
    logEvent(event: AgentEvent): Promise<void>;
    logLLMUsage(usage: LLMUsageRecord): Promise<void>;
    getStats(agentId?: string): Promise<AgentStats>;
  }
  ```

### 16.2 Implementations
- [ ] `persistence/memory.ts` — In-memory (development)
- [ ] `persistence/sqlite.ts` — SQLite via `better-sqlite3`
- [ ] `persistence/postgres.ts` — PostgreSQL via `pg`

### 16.3 Audit Hooks
- [ ] `persistence/audit-hooks.ts`:
  - `registerAuditHooks(hookRegistry, persistence)` — automatic audit logging

---

<a id="phase-17"></a>
## Phase 17: Testing Utilities

### 17.1 Mock LLM
- [ ] `testing/mock-llm.ts`:
  ```typescript
  class MockLLM implements LLMProvider {
    addTextResponse(text: string): void;
    addToolCallResponse(toolName: string, args: Record<string, unknown>): void;
    addStreamResponse(chunks: string[]): void;
    getCallHistory(): LLMRequest[];
  }
  ```

### 17.2 Test Harness
- [ ] `testing/harness.ts`:
  ```typescript
  class AgentTestHarness {
    constructor(agent: Agent);
    run(input: string): Promise<AgentRunResult>;
    get toolCalls(): [string, Record<string, unknown>][];
    assertToolCalled(name: string, args?: Record<string, unknown>): void;
    assertToolNotCalled(name: string): void;
    assertOutputContains(text: string): void;
  }
  ```

### 17.3 Replay System
- [ ] `testing/replay.ts`:
  - `RecordingMiddleware` — record real LLM interactions to JSON
  - `ReplayLLMClient` — replay recorded interactions deterministically

### 17.4 Tool Test Kit
- [ ] `testing/toolkit.ts` — Mock individual tools, assert call order

### 17.5 Eval Suite
- [ ] `testing/eval.ts` — Benchmark against datasets, compute metrics

### 17.6 Coverage, Regression, Snapshot
- [ ] `testing/coverage.ts` — Track tool/code path coverage
- [ ] `testing/regression.ts` — Detect behavioral changes
- [ ] `testing/snapshot.ts` — Compare outputs against snapshots

---

<a id="phase-18"></a>
## Phase 18: Connectors, Credentials, Resilience

### 18.1 Connectors
- [ ] `connectors/base.ts` — Abstract connector interface
- [ ] `connectors/bridge.ts` — Component lifecycle bridge

### 18.2 Credentials
- [ ] `credentials/credentials.ts`:
  - `CredentialResolver` interface
  - `EnvCredentialResolver` — from environment variables
  - `VaultCredentialResolver` — HashiCorp Vault (optional)
  - `AWSSecretsResolver` — AWS Secrets Manager (optional)

### 18.3 Circuit Breaker
- [ ] `resilience/circuit-breaker.ts`:
  - Open/Closed/Half-Open states
  - Configurable failure threshold and timeout
  - Used in LLM failover

---

<a id="phase-19"></a>
## Phase 19: Documentation & Publishing

### 19.1 Documentation
- [ ] README with quick start guide
- [ ] API reference (generated from TSDoc comments)
- [ ] Migration guide from Python SDK
- [ ] Cookbook / examples directory
- [ ] Architecture guide

### 19.2 Publishing
- [ ] npm publish workflow
- [ ] Semantic versioning (semver)
- [ ] Changelog generation
- [ ] GitHub Releases
- [ ] npm provenance (signed packages)

### 19.3 Examples
- [ ] Basic agent (hello world)
- [ ] Tool-using agent
- [ ] Multi-turn conversation
- [ ] Custom middleware
- [ ] MCP integration
- [ ] Memory-enabled agent
- [ ] Streaming agent
- [ ] Subagent orchestration

---

<a id="typescript-decisions"></a>
## TypeScript-Specific Design Decisions

### 1. Zod Instead of Pydantic
Python uses Pydantic for validation and schema generation. TypeScript uses **Zod**:
- Tool parameter schemas defined with Zod
- Structured output uses Zod schemas
- Config validation uses Zod
- `zod-to-json-schema` for JSON Schema generation

### 2. AsyncIterableIterator for Streaming
Python uses `async for` with `AsyncIterator`. TypeScript uses native `AsyncIterableIterator`:
```typescript
for await (const event of agent.astream("hello")) {
  // handle event
}
```

### 3. Discriminated Unions for Events
Python uses string enums + data dict. TypeScript uses discriminated unions:
```typescript
type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; toolName: string; ... }
  | { type: 'done'; result: AgentRunResult };
```
This enables exhaustive pattern matching with `switch(event.type)`.

### 4. Function-Based Tool Creation
Python uses `@tool` decorator. TypeScript uses both:
```typescript
// Option 1: createTool factory
const myTool = createTool({
  name: 'my_tool',
  description: 'Does something',
  parameters: z.object({ arg: z.string() }),
  execute: async ({ arg }) => `result: ${arg}`
});

// Option 2: Decorator (requires experimentalDecorators)
class MyTools {
  @tool({ timeout: 60 })
  async myTool(arg: string): Promise<string> { ... }
}
```

### 5. AsyncDisposable for Cleanup
Use `Symbol.asyncDispose` for automatic cleanup:
```typescript
await using agent = Agent.builder().model("...").build();
// agent.close() called automatically
```

### 6. Module System
- ESM primary, CJS compatibility via tsup
- Subpath exports for tree-shaking
- `"sideEffects": false` in package.json

### 7. Error Handling
Custom error classes extending `Error` with proper prototype chain:
```typescript
class CurioError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

---

<a id="dependency-mapping"></a>
## Dependency Mapping: Python → TypeScript

| Python Dependency | TypeScript Equivalent | Notes |
|---|---|---|
| `httpx` | `fetch` (built-in) | Native in Node 18+ and Bun |
| `python-dotenv` | `dotenv` | Same functionality |
| `openai` (Python) | `openai` (npm) | Official OpenAI SDK |
| `anthropic` (Python) | `@anthropic-ai/sdk` (npm) | Official Anthropic SDK |
| `groq` (Python) | OpenAI-compatible | Use `openai` SDK with custom base_url |
| `pydantic` | `zod` | Validation + schema generation |
| `tiktoken` | `gpt-tokenizer` or `tiktoken` | Token counting |
| `asyncio` | Native `async/await` | Built-in |
| `logging` | `pino` | Structured logging |
| `sqlite3` | `better-sqlite3` | Sync SQLite (fast) |
| `psycopg2` | `pg` | PostgreSQL client |
| `pyautogui` | `robotjs` or `nut.js` | GUI automation (optional) |
| `playwright` (Python) | `playwright` (npm) | Same package, JS version |
| `pytest` | `vitest` | Test runner |
| `pytest-asyncio` | Built-in (vitest) | Async test support native |
| `mypy` | TypeScript compiler | Type checking built-in |
| `black`/`isort` | `prettier` | Code formatting |
| `ruff` | `eslint` | Linting |
| `setuptools` | `tsup` | Build tool |
| `json-rpc` (for MCP) | `@modelcontextprotocol/sdk` | Official MCP SDK |

### Runtime Dependencies (Core)
```json
{
  "dependencies": {
    "zod": "^3.22",
    "zod-to-json-schema": "^3.22",
    "dotenv": "^16.3",
    "pino": "^8.16"
  },
  "optionalDependencies": {
    "openai": "^4.20",
    "@anthropic-ai/sdk": "^0.10",
    "gpt-tokenizer": "^2.1",
    "better-sqlite3": "^9.2",
    "pg": "^8.11",
    "@modelcontextprotocol/sdk": "^1.0",
    "playwright": "^1.40"
  },
  "devDependencies": {
    "typescript": "^5.3",
    "tsup": "^8.0",
    "vitest": "^1.0",
    "eslint": "^8.54",
    "prettier": "^3.1",
    "@types/node": "^20"
  }
}
```

---

## Timeline Summary

| Phase | Description | Estimated Effort | Priority |
|-------|-------------|-----------------|----------|
| 1 | Project scaffolding & core types | 1 week | P0 |
| 2 | Core Agent & Runtime | 2 weeks | P0 |
| 3 | LLM Client & Providers | 2 weeks | P0 |
| 4 | Tool System | 1-2 weeks | P0 |
| 5 | Agent Loop | 1 week | P0 |
| 6 | State Management | 1-2 weeks | P0 |
| 7 | Hooks & Events | 1 week | P0 |
| 8 | Middleware Pipeline | 1-2 weeks | P1 |
| 9 | Memory System | 2-3 weeks | P1 |
| 10 | Context & Instructions | 1 week | P1 |
| 11 | Security & Permissions | 1 week | P1 |
| 12 | Extensions | 2 weeks | P1 |
| 13 | MCP Integration | 1-2 weeks | P1 |
| 14 | CLI Harness | 1 week | P2 |
| 15 | Built-in Tools | 1-2 weeks | P2 |
| 16 | Persistence & Audit | 1-2 weeks | P2 |
| 17 | Testing Utilities | 2 weeks | P1 |
| 18 | Connectors, Credentials, Resilience | 1 week | P2 |
| 19 | Documentation & Publishing | 1-2 weeks | P1 |

**Total estimated effort**: 22-32 weeks (5-8 months)

**P0 (Core — needed for coding tool)**: Phases 1-7 = ~9-11 weeks
**P1 (Important)**: Phases 8-13, 17, 19 = ~9-13 weeks
**P2 (Nice-to-have)**: Phases 14-16, 18 = ~4-7 weeks

The coding tool (Curio Code) can start building once P0 phases are complete and can use P1 features as they become available.
