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
- [Core Concepts](#core-concepts)
- [Model and Provider Configuration](#model-and-provider-configuration)
- [Tools](#tools)
- [Streaming](#streaming)
- [Sessions and Multi-turn Conversations](#sessions-and-multi-turn-conversations)
- [Memory](#memory)
- [Middleware, Hooks, and Events](#middleware-hooks-and-events)
- [Testing and Deterministic Development](#testing-and-deterministic-development)
- [Docs and References](#docs-and-references)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)

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
- `groq:llama-3.1-70b-versatile`
- `ollama:llama3.1`

Environment variables commonly used:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`

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
