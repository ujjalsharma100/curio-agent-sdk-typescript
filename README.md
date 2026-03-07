# Curio Agent SDK (TypeScript)

Production-grade primitives for building autonomous AI agents in TypeScript.

The SDK is designed for real agent workloads, not just demo wrappers:
- Multi-step tool calling loops
- Pluggable memory and session persistence
- Middleware and hook-based observability
- Provider routing, retry, deduplication, and resilience controls
- Strong typing and schema validation for safer tool execution

## Table of Contents

- [Who This Is For](#who-this-is-for)
- [Feature Highlights](#feature-highlights)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Directory Structure](#directory-structure)
- [Core Concepts](#core-concepts)
- [Model and Provider Configuration](#model-and-provider-configuration)
- [Tools](#tools)
- [Streaming](#streaming)
- [Sessions and Multi-turn Conversations](#sessions-and-multi-turn-conversations)
- [Memory](#memory)
- [Middleware, Hooks, and Events](#middleware-hooks-and-events)
- [Testing and Deterministic Development](#testing-and-deterministic-development)
- [Advanced Topics](#advanced-topics)
- [Docs and References](#docs-and-references)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Who This Is For

Use this SDK if you need one or more of the following:
- You are building a real assistant, coding agent, workflow agent, or orchestration layer.
- You need tool safety boundaries with typed inputs and execution guards.
- You need deterministic tests while still supporting live-provider runs in production.
- You want a composable architecture (agent loop, memory, middleware, hooks, persistence).

If you only need one-off prompt calls, a raw provider SDK may be simpler.

## Feature Highlights

- Fluent `Agent.builder()` API to assemble runtime concerns.
- `createTool(...)` with Zod schemas and structured execution.
- `agent.run(...)` for completion-style calls and `agent.astream(...)` for streaming.
- Provider abstraction through `LLMClient` with model strings like `openai:gpt-4o-mini`.
- Optional session stores and memory managers for continuity.
- Middleware and hooks for logging, tracing, rate limits, guardrails, and custom logic.
- Support modules for testing, persistence, MCP integration, and subagents.

## Requirements

- Node.js `>=20.0.0`
- npm `>=10`
- TypeScript `>=5.6` for SDK development (not required for plain JS consumption)

## Installation

```bash
npm install curio-agent-sdk zod
```

Optional provider packages are loaded when used:
- `openai` for OpenAI provider models
- `@anthropic-ai/sdk` for Anthropic provider models
- `@modelcontextprotocol/sdk` for MCP integrations
- `playwright` for browser/computer-use style tools

## Quick Start

Before running this example, make sure you have set an API key for the provider you are using (for `openai:gpt-4o-mini`, set `OPENAI_API_KEY`; see [Model and Provider Configuration](#model-and-provider-configuration) for details).

```typescript
import { Agent, LLMClient, createTool } from "curio-agent-sdk";
import { z } from "zod";

const calculator = createTool({
  name: "calculator",
  description: "Evaluate arithmetic expressions",
  parameters: z.object({
    expression: z.string().describe("Expression like '17 * 23'"),
  }),
  execute: async ({ expression }) => {
    // Replace with a safe parser in production.
    const result = Function(`"use strict"; return (${expression})`)();
    return String(result);
  },
});

const llm = new LLMClient();

const agent = Agent.builder()
  .agentName("assistant")
  .model("openai:gpt-4o-mini")
  .llmClient(llm)
  .systemPrompt("You are a concise, practical assistant.")
  .tool(calculator)
  .maxIterations(8)
  .build();

const result = await agent.run("What is 17 * 23?");
console.log(result.output);
```

## Directory Structure

```
curio-agent-sdk-typescript/
├── docs/
│   ├── API_REFERENCE.md      # Generated API docs
│   └── ARCHITECTURE.md       # Architecture guide and diagrams
├── examples/
│   ├── README.md             # Cookbook and example index
│   ├── hello-world.ts
│   ├── memory-agent.ts
│   ├── streaming-agent.ts
│   └── tool-agent.ts
├── src/
│   ├── index.ts              # Main package entry; re-exports public API
│   ├── base/                 # Component base and shared primitives
│   ├── cli/                  # CLI harness (AgentCLI, REPL)
│   ├── connectors/           # Connector bridge and base (HTTP, DB, etc.)
│   ├── core/
│   │   ├── agent/            # Agent, AgentBuilder, Runtime
│   │   ├── context/          # Context and instruction assembly
│   │   ├── events/           # Hooks, event bus
│   │   ├── extensions/       # Skills, plugins, subagents
│   │   ├── llm/              # LLMClient, providers, router, token counting
│   │   ├── loops/            # ToolCallingLoop and loop abstraction
│   │   ├── security/         # Permissions, human-input
│   │   ├── state/            # AgentState, session, checkpoint, state store
│   │   └── tools/            # Tool definition, registry, executor, schema
│   ├── credentials/          # Credential resolution
│   ├── memory/               # MemoryManager, backends, strategies
│   ├── middleware/           # Logging, tracing, guardrails, rate-limit, etc.
│   ├── mcp/                  # MCP bridge, client, config, transport
│   ├── models/               # Types: messages, LLM, agent, events
│   ├── persistence/          # Run/audit persistence (memory, sqlite, postgres)
│   ├── resilience/           # Circuit breaker and retry
│   ├── testing/              # MockLLM, harness, replay, eval, coverage
│   ├── tools/                # Built-in tools (web-fetch, file, shell, etc.)
│   └── utils/                # Async, hashing, logging helpers
├── tests/
│   ├── setup.ts
│   ├── fixtures/             # Shared test fixtures
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── performance/
│   └── live/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── typedoc.json
├── vitest.config.ts
└── README.md
```

Package entry points (see `package.json` exports):

- **`curio-agent-sdk`** — main API (Agent, tools, LLM, hooks, etc.)
- **`curio-agent-sdk/testing`** — MockLLM, AgentTestHarness, record/replay, evals
- **`curio-agent-sdk/memory`** — MemoryManager, backends, strategies
- **`curio-agent-sdk/middleware`** — Middleware implementations and consumers

## Core Concepts

### 1) Agent

`Agent` is the main user-facing entry point:
- `run(input, options?)` returns full run result.
- `arun(input, options?)` async variant (same output contract).
- `astream(input, options?)` yields `StreamEvent` chunks.

### 2) Runtime and Loop

Under the hood, `Runtime` coordinates:
- state creation
- iteration lifecycle
- LLM calls
- tool invocation
- hooks/events and result aggregation

Default loop implementation is tool-calling oriented (`ToolCallingLoop`).

### 3) Tool Registry and Executor

Tools are registered once and then invoked by name from model tool calls:
- Zod schemas validate runtime args
- execution errors are captured and surfaced into run telemetry
- optional permissions and middleware can gate/observe calls

## Model and Provider Configuration

Model strings use `provider:model`:
- `openai:gpt-4o-mini`
- `anthropic:claude-sonnet-4-6`
- `groq:llama-3.3-70b-versatile`
- `ollama:llama3.1`

### Provider credentials / environment variables

Environment variables commonly used:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`

For live provider calls, ensure keys are present in `process.env`. A typical local setup looks like:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GROQ_API_KEY=gsk_...
```

You can persist these in your shell profile (for example on zsh):

```bash
echo 'export OPENAI_API_KEY=sk-...' >> ~/.zshrc
source ~/.zshrc
```

Or load them from a `.env` file using `dotenv`:

```bash
npm install dotenv
```

Then, in your app entrypoint:

```typescript
import "dotenv/config";
```

Make sure the environment variable name matches the provider prefix used in your model string:
- `openai:...` → `OPENAI_API_KEY`
- `anthropic:...` → `ANTHROPIC_API_KEY`
- `groq:...` → `GROQ_API_KEY`

For local Ollama:
- start Ollama daemon
- ensure model exists locally
- target via `ollama:<model-id>`

## Tools

Minimal pattern:

```typescript
import { createTool } from "curio-agent-sdk";
import { z } from "zod";

export const searchTool = createTool({
  name: "search",
  description: "Search internal docs",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => `Results for: ${query}`,
});
```

Tool best practices:
- Keep `execute` side effects explicit and auditable.
- Validate all fields with schemas, even optional ones.
- Return stable, parseable text or JSON strings.
- Use permission policy middleware for file/network actions.

## Streaming

Use `agent.astream(...)` for real-time UX:

```typescript
for await (const event of agent.astream("Explain event loops in JS.")) {
  if (event.type === "text_delta") process.stdout.write(event.text);
  if (event.type === "done") console.log("\nDone:", event.result.duration);
}
```

Common stream events:
- `text_delta`
- `tool_call_start` / `tool_call_end`
- `thinking`
- `iteration_start` / `iteration_end`
- `error`
- `done`

## Sessions and Multi-turn Conversations

For continuity across turns, configure a `SessionManager` and pass `sessionId`:
- previous messages are loaded before each run
- new run messages are persisted back to the session store

This is the preferred approach for chatbot-style UX where each user has ongoing context.

## Memory

Attach a `MemoryManager` for long-term retrieval and persistence strategies:
- memory injection before generation
- memory save/query strategies during and after runs
- built-in memory-aware tools can be exposed to the agent

Useful memory backends include conversation, key-value, vector-like, and composite styles.

## Middleware, Hooks, and Events

Middleware adds cross-cutting behavior:
- logging
- tracing
- cost accounting
- guardrails
- rate limiting

Hooks and events let you react to lifecycle boundaries:
- before/after run
- before/after/error for LLM calls
- before/after/error for tool calls
- state checkpoints and memory activity

**Optional granular run logging (debug/audit):** Use `createRunLogger` and `useRunLogger` to write a full dump of each run to a file or custom sink (every LLM request/response, tool call args and results). Opt-in only; useful for debugging or support. See the tool-agent examples and `RunLoggerOptions` (including `sink`) for production use.

## Testing and Deterministic Development

Recommended workflow:
1. Build behavior with `MockLLM` and fixture tools.
2. Add integration coverage (memory/sessions/middleware).
3. Add e2e behavior tests for real conversation flows.
4. Gate live-provider tests behind env flags.

Available scripts:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:all
```

## Advanced Topics

### Architecture overview

At a high level:

1. `Agent.builder()` collects configuration (model, tools, hooks, memory, sessions, middleware, permissions, etc.).
2. `.build()` materializes collaborators like `ToolRegistry`, `ToolExecutor`, `HookRegistry`, `MemoryManager`, `StateStore`, and a `Runtime` using a `ToolCallingLoop`.
3. `agent.run(...)` / `agent.astream(...)` create an `AgentState`, optionally load session history, inject memory, call the LLM, execute tools, and iterate until completion.
4. The final `AgentRunResult` includes output text, tool calls, token usage, metrics, and run metadata.

For a much deeper breakdown, see `docs/ARCHITECTURE.md`.

### Built-in tools

The SDK ships with batteries-included tools for web fetch, code/shell execution, files, HTTP, computer use, and browser automation:

```typescript
import {
  Agent,
  webFetchTool,
  fileReadTool,
  fileWriteTool,
  httpRequestTool,
  codeExecuteTool,
  shellExecuteTool,
  computerUseTool,
  browserTool,
} from "curio-agent-sdk";

const agent = Agent.builder()
  .model("openai:gpt-4o-mini")
  .tools([webFetchTool, fileReadTool, fileWriteTool, httpRequestTool])
  .tool(codeExecuteTool)
  .tool(shellExecuteTool)
  .tool(computerUseTool)
  .tool(browserTool)
  .build();
```

Use these as-is, or wrap them with domain-specific prompts and guardrails.

### Skills

Skills bundle prompts, tools, and hooks into reusable capabilities:

```typescript
import { Agent, Skill, HookEvent } from "curio-agent-sdk";
import { calculatorTool } from "./tools";

const commitSkill = new Skill({
  name: "commit",
  description: "Create well-formatted git commits.",
  systemPrompt: "When committing, analyze changes and write a clear message.",
  tools: [calculatorTool],
  hooks: [
    {
      event: HookEvent.AGENT_RUN_BEFORE,
      handler: async (ctx) => {
        // e.g., log or modify metadata
        console.log("About to run", ctx.runId);
      },
    },
  ],
});

const agent = Agent.builder()
  .model("openai:gpt-4o")
  .systemPrompt("You are a helpful coding assistant.")
  .skill(commitSkill)
  .build();
```

Attach multiple skills to the same agent to compose behavior.

### Subagents and multi-agent orchestration

Subagents let you define named child agents with their own prompts, tools, and limits:

```typescript
import { Agent } from "curio-agent-sdk";
import { calculatorTool, searchTool } from "./tools";

const agent = Agent.builder()
  .model("tier2") // uses TieredRouter tiers
  .systemPrompt("You are a coordinator that delegates to specialists.")
  .subagent("math", {
    systemPrompt: "You are a math specialist. Use the calculator tool.",
    tools: [calculatorTool],
  })
  .subagent("research", {
    systemPrompt: "You are a research specialist.",
    tools: [searchTool],
  })
  .build();

const result = await agent.spawnSubagent("math", "What is 7 * 8?");
console.log(result.output);
```

Subagents share hooks, middleware, state store, and memory with the parent while customizing prompts/models/tools.

### Memory system

Combine multiple memory backends with pluggable strategies:

```typescript
import {
  Agent,
  MemoryManager,
  ConversationMemory,
  VectorMemory,
  CompositeMemory,
  FileMemory,
  UserMessageInjection,
  SaveSummaryStrategy,
  AdaptiveTokenQuery,
} from "curio-agent-sdk";

const memory = new CompositeMemory({
  conversation: new ConversationMemory({ maxEntries: 50 }),
  semantic: new VectorMemory({ persistPath: "./vectors" }),
  files: new FileMemory({ basePath: "./memory", namespace: "project-x" }),
});

const memoryManager = new MemoryManager({
  memory,
  injectionStrategy: new UserMessageInjection(),
  saveStrategy: new SaveSummaryStrategy(async (input, output, state) => {
    // Call your favorite summarizer here.
    return `Summary of ${state.messages.length} messages: ${input.slice(0, 80)} -> ${output.slice(0, 80)}`;
  }),
  queryStrategy: new AdaptiveTokenQuery(),
});

const agent = Agent.builder()
  .model("openai:gpt-4o")
  .memoryManager(memoryManager)
  .build();
```

See the `curio-agent-sdk/memory` entry point for all memory types and helpers.

### MCP (Model Context Protocol)

Use MCP to turn external MCP servers into normal tools:

```typescript
import { Agent, MCPBridge, loadMcpConfig } from "curio-agent-sdk";

const servers = await loadMcpConfig("mcp.json");
const bridge = new MCPBridge({ servers });

await bridge.startup();
const mcpTools = await bridge.getTools();

const agent = Agent.builder()
  .model("openai:gpt-4o")
  .tools(mcpTools)
  .build();
```

This works with Claude / Cursor–style `mcpServers` configs and supports stdio and HTTP transports.

### Connectors

Connectors provide lifecycle-managed integrations for external systems (HTTP APIs, databases, queues, etc.):

```typescript
import { BaseConnector, ConnectorBridge } from "curio-agent-sdk";

class MyApiConnector extends BaseConnector<{ path: string }, { status: number }> {
  constructor() {
    super({ name: "my-api" });
  }

  async connect(): Promise<void> {
    // initialize client
  }

  async disconnect(): Promise<void> {
    // clean up
  }

  async request(req: { path: string }) {
    // perform the request against your API
    return { status: 200 };
  }
}

const bridge = new ConnectorBridge({
  connectors: [new MyApiConnector()],
});

await bridge.startup();
const response = await bridge.request("my-api", { path: "/v1/items" });
console.log(response.status);
await bridge.shutdown();
```

### Permissions and sandboxing

Combine permission policies and sandboxes to constrain file and network access:

```typescript
import {
  Agent,
  AllowReadsAskWrites,
  CompoundPolicy,
  FileSandboxPolicy,
  NetworkSandboxPolicy,
} from "curio-agent-sdk";

const permissions = new CompoundPolicy([
  new AllowReadsAskWrites(),
  new FileSandboxPolicy(["/workspace", "/tmp"]),
  new NetworkSandboxPolicy(["https://api.github.com/*"]),
]);

const agent = Agent.builder()
  .model("openai:gpt-4o")
  .permissions(permissions)
  .build();
```

### Event bus and observability

Hook-based consumers make it easy to export metrics and traces:

```typescript
import {
  Agent,
  HookEvent,
  InMemoryEventBus,
  TracingConsumer,
  LoggingConsumer,
  PrometheusExporter,
} from "curio-agent-sdk";

const bus = new InMemoryEventBus();
const tracing = new TracingConsumer({ serviceName: "curio-agent" });
const logging = new LoggingConsumer();
const prometheus = new PrometheusExporter();

const agent = Agent.builder()
  .model("openai:gpt-4o")
  .hook(HookEvent.LLM_CALL_AFTER, async (ctx) => {
    await bus.publish(ctx.event);
  })
  .build();

// Attach consumers to the hook registry during app bootstrap
tracing.attach(agent.hookRegistry);
logging.attach(agent.hookRegistry);
prometheus.attach(agent.hookRegistry);
```

You can also pipe events into your own structured logging or tracing systems via hooks.

### CLI harness

The CLI harness wraps an agent in an interactive REPL with streaming, sessions, and custom commands:

```typescript
import { Agent, AgentCLI } from "curio-agent-sdk";

const agent = Agent.builder()
  .model("openai:gpt-4o")
  .systemPrompt("You are a CLI assistant.")
  .build();

const cli = new AgentCLI(agent);
cli.registerCommand("/deploy", async (input, state) => {
  // handle custom command
  return { output: "Deployed!", state };
});

await cli.runInteractive();
```

### Reliability and tiered routing

Use `TieredRouter` and `LLMClient` for multi-tier model routing and failover:

```typescript
import { Agent, LLMClient, TieredRouter } from "curio-agent-sdk";

const router = new TieredRouter();
// Optionally populate tiers from:
// TIER1_MODELS=groq:llama-3.1-8b-instant,openai:gpt-4o-mini
// TIER2_MODELS=openai:gpt-4o,anthropic:claude-sonnet-4-6
// TIER3_MODELS=anthropic:claude-sonnet-4-6,openai:gpt-4o

const llm = new LLMClient({ router, dedupEnabled: true });

const agent = Agent.builder()
  .model("tier2") // "tier1", "tier2", or "tier3"
  .llmClient(llm)
  .build();
```

This lets you trade off speed, cost, and quality while keeping agent code unchanged.

### Testing utilities

The `curio-agent-sdk/testing` entry point exposes utilities for deterministic tests, record/replay, and evals:

```typescript
import { Agent } from "curio-agent-sdk";
import {
  MockLLM,
  AgentTestHarness,
  ToolTestKit,
  RecordingMiddleware,
  ReplayLLMClient,
  AgentEvalSuite,
} from "curio-agent-sdk/testing";

const llm = new MockLLM();
llm.addTextResponse("2 + 2 = 4");

const agent = Agent.builder()
  .model("mock-model")
  .llmClient(llm)
  .build();

const harness = new AgentTestHarness(agent);
const result = await harness.run("What is 2+2?");
console.log(result.output);

// Tool-level testing and record/replay/evals are also available via ToolTestKit,
// RecordingMiddleware + ReplayLLMClient, and AgentEvalSuite/AgentCoverageTracker.
```

## Docs and References

- API reference generation and maintenance: `docs/API_REFERENCE.md`
- Python migration guide: `docs/MIGRATION_FROM_PYTHON.md`
- Runtime architecture deep dive: `docs/ARCHITECTURE.md`
- Cookbook examples: `examples/README.md`

## Development Workflow

```bash
npm install
npm run build
npm run typecheck
npm run lint
npm run test:all
npm run docs:api
```

Before publishing:
- regenerate API docs
- confirm tests pass by category
- verify exported surface in `src/index.ts`
- verify package files list includes docs/readme/license as intended

## Troubleshooting

### Missing provider credentials

Symptoms:
- auth or provider registration errors

Fix:
- set provider env var (for example `OPENAI_API_KEY`)
- verify model prefix matches installed provider

### Tool not called

Symptoms:
- model answers directly without using your tool

Fix:
- improve tool description and parameter descriptions
- tighten system prompt (explicitly require tool usage for specific tasks)
- ensure `maxIterations` allows at least one tool round trip

### Streaming appears stalled

Symptoms:
- no output until final response

Fix:
- ensure you iterate `for await (...)` and flush output in handlers
- verify provider supports streaming for selected model

### Non-deterministic tests

Fix:
- prefer `MockLLM` for unit/integration
- avoid wall-clock assertions unless explicitly testing timing
- isolate state/memory stores per test

## License

Apache License 2.0. See the root `LICENSE` file in the monorepo for full terms.
