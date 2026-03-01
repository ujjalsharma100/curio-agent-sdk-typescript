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
## Phase 2: Core Agent & Runtime

### 2.1 Agent Class
- [ ] `core/agent/agent.ts`:
  - Constructor accepting all components
  - Static `builder()` method returning `AgentBuilder`
  - `run(input: string): Promise<AgentRunResult>` (sync wrapper)
  - `arun(input: string, options?: RunOptions): Promise<AgentRunResult>`
  - `astream(input: string, options?: RunOptions): AsyncIterableIterator<StreamEvent>`
  - `close(): Promise<void>`
  - Implements `AsyncDisposable` (`await using agent = ...`)
  - Properties: `agentId`, `agentName`, `runtime`, `tools`, `model`

### 2.2 Agent Builder
- [ ] `core/agent/builder.ts`:
  - Fluent API with method chaining
  - Type-safe builder (generic accumulation pattern)
  - Methods:
    - `.model(model: string)`
    - `.systemPrompt(prompt: string | (() => string))`
    - `.tools(tools: Tool[])`
    - `.tool(tool: Tool)`
    - `.middleware(middleware: Middleware[])`
    - `.memoryManager(manager: MemoryManager)`
    - `.stateStore(store: StateStore)`
    - `.sessionManager(manager: SessionManager)`
    - `.permissions(policy: PermissionPolicy)`
    - `.humanInput(handler: HumanInputHandler)`
    - `.hook(event: string, handler: HookHandler, priority?: number)`
    - `.skill(skill: Skill)`
    - `.subagent(name: string, config: SubagentConfig)`
    - `.mcpServer(name: string, config: MCPServerConfig)`
    - `.plugin(plugin: Plugin)`
    - `.contextManager(manager: ContextManager)`
    - `.onEvent(handler: (event: AgentEvent) => void)`
    - `.maxIterations(n: number)`
    - `.timeout(ms: number)`
    - `.build(): Agent`

### 2.3 Runtime
- [ ] `core/agent/runtime.ts`:
  - `createState(input: string): AgentState`
  - `runWithState(state: AgentState): Promise<AgentRunResult>`
  - `streamWithState(state: AgentState): AsyncIterableIterator<StreamEvent>`
  - Hook emission (agent.run.before/after/error)
  - Memory injection/saving
  - State persistence
  - Timeout management via `AbortController`

---

<a id="phase-3"></a>
## Phase 3: LLM Client & Providers

### 3.1 Provider Interface
- [ ] `core/llm/providers/base.ts`:
  ```typescript
  interface LLMProvider {
    name: string;
    supportedModels: string[];
    call(request: LLMRequest, config: ProviderConfig): Promise<LLMResponse>;
    stream(request: LLMRequest, config: ProviderConfig): AsyncIterableIterator<LLMStreamChunk>;
    supportsModel(model: string): boolean;
  }

  interface ProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    headers?: Record<string, string>;
  }
  ```

### 3.2 Provider Implementations
- [ ] `providers/openai.ts` — OpenAI provider (using `openai` npm package)
  - Models: gpt-4o, gpt-4o-mini, gpt-4-turbo, o1, o3
  - Tool calling, streaming, vision, response_format
- [ ] `providers/anthropic.ts` — Anthropic provider (using `@anthropic-ai/sdk`)
  - Models: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
  - Tool use, streaming, prompt caching, extended thinking
- [ ] `providers/groq.ts` — Groq provider (OpenAI-compatible)
  - Models: llama-3.1-8b-instant, llama-3.1-70b-versatile
- [ ] `providers/ollama.ts` — Ollama provider (HTTP API)
  - Local models: llama, mistral, codellama, etc.

### 3.3 LLM Client
- [ ] `core/llm/client.ts`:
  - Provider registration and management
  - `call(request: LLMRequest): Promise<LLMResponse>`
  - `stream(request: LLMRequest): AsyncIterableIterator<LLMStreamChunk>`
  - Request deduplication (hash-based caching)
  - Usage tracking
  - Automatic retry with exponential backoff
  - `AbortSignal` support

### 3.4 Tiered Router
- [ ] `core/llm/router.ts`:
  - Three-tier model selection
  - Auto-discovery from environment variables
  - Degradation strategies: FallbackToLowerTier, ResetAndRetry, RaiseError
  - Configurable tier assignments

### 3.5 Token Counter
- [ ] `core/llm/token-counter.ts`:
  - Use `gpt-tokenizer` or `tiktoken` for OpenAI models
  - Anthropic token estimation
  - Caching for performance
  - `countTokens(messages, model, tools): number`

---

<a id="phase-4"></a>
## Phase 4: Tool System

### 4.1 Tool Class
- [ ] `core/tools/tool.ts`:
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
- [ ] `core/tools/schema.ts`:
  - Zod → JSON Schema conversion (using `zod-to-json-schema`)
  - `ToolSchema` class with `validate()`, `toJsonSchema()`, `toLLMSchema()`
  - `fromZod(schema: ZodSchema): ToolSchema`
  - Support for all JSON Schema types

### 4.3 Tool Registry
- [ ] `core/tools/registry.ts`:
  - `register(tool: Tool): void`
  - `get(name: string): Tool | undefined`
  - `has(name: string): boolean`
  - `getAll(): Tool[]`
  - `getSchemas(): ToolSchema[]`
  - Iterable interface

### 4.4 Tool Executor
- [ ] `core/tools/executor.ts`:
  - `executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult>`
  - `executeParallel(calls: ToolCall[]): Promise<ToolResult[]>`
  - Timeout enforcement
  - Retry with backoff
  - Caching (TTL-based)
  - Permission checking (delegate to PermissionPolicy)
  - Hook emission (tool.call.before/after/error)

---

<a id="phase-5"></a>
## Phase 5: Agent Loop

### 5.1 Loop Interface
- [ ] `core/loops/base.ts`:
  ```typescript
  interface AgentLoop {
    step(state: AgentState): Promise<AgentState>;
    shouldContinue(state: AgentState): boolean;
  }
  ```

### 5.2 Tool Calling Loop
- [ ] `core/loops/tool-calling.ts`:
  - Standard pattern: Call LLM → parse tool calls → execute → loop
  - Parallel tool execution
  - Max iterations enforcement
  - Structured output support (Zod models)
  - Stream delegation (yield events during execution)
  - Hook emission (iteration.before/after)

---

<a id="phase-6"></a>
## Phase 6: State Management

### 6.1 Agent State
- [ ] `core/state/state.ts`:
  ```typescript
  class AgentState {
    messages: Message[];
    tools: ToolSchema[];
    iteration: number;
    maxIterations: number;
    metadata: Map<string, unknown>;
    metrics: AgentMetrics;
    extensions: Map<string, StateExtension>;
    runId: string;

    addMessage(msg: Message): void;
    getExtension<T extends StateExtension>(key: string): T | undefined;
    setExtension(key: string, ext: StateExtension): void;
    toCheckpoint(): CheckpointData;
    static fromCheckpoint(data: CheckpointData): AgentState;
  }

  interface StateExtension {
    toDict(): Record<string, unknown>;
    fromDict(data: Record<string, unknown>): StateExtension;
  }
  ```

### 6.2 State Store
- [ ] `core/state/state-store.ts`:
  ```typescript
  interface StateStore {
    save(state: AgentState): Promise<void>;
    load(runId: string): Promise<AgentState | null>;
    list(): Promise<string[]>;
    delete(runId: string): Promise<void>;
  }

  class InMemoryStateStore implements StateStore { ... }
  class FileStateStore implements StateStore { ... }
  ```

### 6.3 Checkpoint
- [ ] `core/state/checkpoint.ts`:
  - Serialize/deserialize AgentState to JSON
  - Version-tagged for migration support
  - Include message history, tool schemas, extensions

### 6.4 Session Management
- [ ] `core/state/session.ts`:
  ```typescript
  interface Session {
    id: string;
    agentId: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }

  interface SessionStore {
    create(agentId: string, metadata?: Record<string, unknown>): Promise<Session>;
    get(sessionId: string): Promise<Session | null>;
    addMessage(sessionId: string, message: Message): Promise<void>;
    getMessages(sessionId: string, limit?: number): Promise<Message[]>;
    list(agentId?: string): Promise<Session[]>;
    delete(sessionId: string): Promise<void>;
  }

  class InMemorySessionStore implements SessionStore { ... }
  class FileSessionStore implements SessionStore { ... }

  class SessionManager {
    create(agentId: string): Promise<Session>;
    get(sessionId: string): Promise<Session>;
    listSessions(agentId?: string): Promise<Session[]>;
    delete(sessionId: string): Promise<void>;
  }
  ```

---

<a id="phase-7"></a>
## Phase 7: Hooks & Events

### 7.1 Hook System
- [ ] `core/events/hooks.ts`:
  ```typescript
  type HookHandler = (ctx: HookContext) => void | Promise<void>;

  class HookContext {
    event: string;
    data: Record<string, unknown>;
    state?: AgentState;
    runId?: string;
    agentId?: string;
    iteration?: number;

    cancel(): void;
    modify(key: string, value: unknown): void;
    isCancelled(): boolean;
  }

  class HookRegistry {
    on(event: string, handler: HookHandler, priority?: number): void;
    off(event: string, handler: HookHandler): void;
    emit(event: string, context: HookContext): Promise<void>;
    listHandlers(event: string): HookHandler[];
  }
  ```
  - 16 built-in events matching Python SDK
  - Priority-based execution order
  - Async handler support
  - Mutable context (cancel, modify)

### 7.2 Event Bus
- [ ] `core/events/event-bus.ts`:
  ```typescript
  interface EventBus {
    subscribe(pattern: string, handler: (event: AgentEvent) => void): () => void;
    publish(event: AgentEvent): Promise<void>;
    replay(startTime: Date, pattern?: string): AsyncIterableIterator<AgentEvent>;
  }

  class InMemoryEventBus implements EventBus { ... }
  ```
  - Glob pattern matching for subscriptions
  - Replay capability
  - Dead letter queue

---

<a id="phase-8"></a>
## Phase 8: Middleware Pipeline

### 8.1 Middleware Interface
- [ ] `middleware/base.ts`:
  ```typescript
  interface Middleware {
    name: string;
    beforeLLMCall?(request: LLMRequest): Promise<LLMRequest | void>;
    afterLLMCall?(request: LLMRequest, response: LLMResponse): Promise<LLMResponse | void>;
    onLLMStreamChunk?(request: LLMRequest, chunk: LLMStreamChunk): Promise<LLMStreamChunk | void>;
    beforeToolCall?(toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown> | void>;
    afterToolCall?(toolName: string, args: Record<string, unknown>, result: string): Promise<string | void>;
    onError?(error: Error, context: Record<string, unknown>): Promise<Error | null>;
  }

  class MiddlewarePipeline {
    add(middleware: Middleware): void;
    runBeforeLLMCall(request: LLMRequest): Promise<LLMRequest>;
    runAfterLLMCall(request: LLMRequest, response: LLMResponse): Promise<LLMResponse>;
    // ... etc.
  }
  ```

### 8.2 Built-in Middleware
- [ ] `middleware/logging.ts` — Structured logging (pino-compatible)
- [ ] `middleware/cost-tracker.ts` — Budget enforcement, per-model breakdown
- [ ] `middleware/rate-limit.ts` — Token bucket rate limiting
- [ ] `middleware/tracing.ts` — OpenTelemetry spans
- [ ] `middleware/guardrails.ts` — Content safety, PII detection, injection blocking
- [ ] `middleware/prometheus.ts` — Prometheus metrics export
- [ ] `middleware/consumers.ts` — Hook-based observability consumers

---

<a id="phase-9"></a>
## Phase 9: Memory System

### 9.1 Memory Interface
- [ ] `memory/base.ts`:
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
- [ ] `memory/manager.ts`:
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
- [ ] `memory/conversation.ts` — Sliding window (last N messages)
- [ ] `memory/vector.ts` — Semantic search via embeddings (cosine similarity)
- [ ] `memory/key-value.ts` — Key-value store
- [ ] `memory/composite.ts` — Combine multiple backends with namespace support
- [ ] `memory/working.ts` — Ephemeral scratchpad (per-run)
- [ ] `memory/episodic.ts` — Temporal episodes with decay
- [ ] `memory/graph.ts` — Entity-relationship knowledge graph (triples)
- [ ] `memory/self-editing.ts` — MemGPT/Letta-style (core + archival)
- [ ] `memory/file.ts` — File-based persistent memory (MEMORY.md style)

---

<a id="phase-10"></a>
## Phase 10: Context & Instructions

### 10.1 Context Manager
- [ ] `core/context/context.ts`:
  ```typescript
  class ContextManager {
    constructor(options: { maxTokens: number; reserveTokens?: number; strategy?: 'truncate_oldest' | 'summarize' });
    fitMessages(messages: Message[], tools?: ToolSchema[], model?: string): Promise<Message[]>;
  }
  ```
  - Token budget enforcement
  - Preserve system message
  - Truncation or summarization strategy

### 10.2 Instruction Loader
- [ ] `core/context/instructions.ts`:
  - Load from configurable file names
  - Hierarchical: global → project → directory
  - Dynamic injection mid-session
  - File watching for live reload

---

<a id="phase-11"></a>
## Phase 11: Security & Permissions

### 11.1 Permission System
- [ ] `core/security/permissions.ts`:
  ```typescript
  interface PermissionResult {
    allowed: boolean;
    reason?: string;
    requireConfirmation?: boolean;
  }

  interface PermissionPolicy {
    checkToolCall(toolName: string, args: Record<string, unknown>, context: PermissionContext): Promise<PermissionResult>;
    checkFileAccess?(path: string): Promise<PermissionResult>;
    checkNetworkAccess?(url: string): Promise<PermissionResult>;
  }

  class AllowAll implements PermissionPolicy { ... }
  class AskAlways implements PermissionPolicy { ... }
  class AllowReadsAskWrites implements PermissionPolicy { ... }
  class CompoundPolicy implements PermissionPolicy { ... }
  class FileSandboxPolicy implements PermissionPolicy { ... }
  class NetworkSandboxPolicy implements PermissionPolicy { ... }
  ```

### 11.2 Human Input Handler
- [ ] `core/security/human-input.ts`:
  ```typescript
  interface HumanInputHandler {
    getUserConfirmation(prompt: string, context?: Record<string, unknown>): Promise<boolean>;
  }

  class CLIHumanInput implements HumanInputHandler { ... }  // readline-based
  ```

---

<a id="phase-12"></a>
## Phase 12: Extensions (Skills, Plugins, Subagents)

### 12.1 Skills
- [ ] `core/extensions/skills.ts`:
  - `Skill` class with name, description, systemPrompt, tools, hooks, instructions
  - `Skill.fromDirectory(path)` — load from directory
  - YAML manifest parsing
  - `SkillRegistry` — register, activate, deactivate, list

### 12.2 Plugins
- [ ] `core/extensions/plugins.ts`:
  - `Plugin` interface with `register(builder: AgentBuilder)`
  - npm package discovery (`curio-plugin-*`)
  - `PluginRegistry` — register, discover, list

### 12.3 Subagents
- [ ] `core/extensions/subagent.ts`:
  ```typescript
  interface SubagentConfig {
    systemPrompt: string;
    tools?: Tool[];
    model?: string;
    maxIterations?: number;
    timeout?: number;
  }

  // Spawn methods on Agent:
  // agent.spawnSubagent(name: string, input: string): Promise<AgentRunResult>
  // agent.spawnSubagentStream(name: string, input: string): AsyncIterableIterator<StreamEvent>
  ```

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
