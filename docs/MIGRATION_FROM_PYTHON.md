# Migration Guide: Python SDK to TypeScript SDK

This guide is for teams porting existing Python SDK agents to the TypeScript SDK with high behavior parity and low regression risk.

It focuses on practical migration work:
- translating APIs and concepts
- preserving runtime behavior
- handling async and typing differences
- porting tests in a staged, deterministic way

## Table of Contents

- [Migration Strategy at a Glance](#migration-strategy-at-a-glance)
- [Key Runtime Differences](#key-runtime-differences)
- [Concept Mapping](#concept-mapping)
- [Step-by-step Porting Plan](#step-by-step-porting-plan)
- [Code Translation Patterns](#code-translation-patterns)
- [Tool Migration Patterns](#tool-migration-patterns)
- [Memory and Session Migration](#memory-and-session-migration)
- [Middleware and Hooks Migration](#middleware-and-hooks-migration)
- [Testing Migration Plan](#testing-migration-plan)
- [Behavior Parity Checklist](#behavior-parity-checklist)
- [Common Pitfalls](#common-pitfalls)

## Migration Strategy at a Glance

Recommended order:
1. Port baseline agent construction and core run flow.
2. Port tools and tool-routing prompts.
3. Port memory/session behavior.
4. Port middleware/hooks/telemetry.
5. Port tests (unit -> integration -> e2e -> optional live).
6. Run parity checks and tighten prompts/limits.

Keep old and new implementations running in parallel until output quality and failure behavior align.

## Key Runtime Differences

- TypeScript uses a fluent builder (`Agent.builder()`), not Python-style constructor-first setup.
- Tool schemas use Zod at runtime rather than Python type hints/Pydantic models.
- Async boundaries are explicit (`await` everywhere; streaming is `for await`).
- Package structure is import-driven (`curio-agent-sdk`, `curio-agent-sdk/memory`, etc.).
- Type safety is compile-time enforced, so mismatched contracts fail earlier.

## Concept Mapping

| Python SDK concept | TypeScript SDK equivalent |
| --- | --- |
| Agent constructor/config object | `Agent.builder().*().build()` |
| Tool decorators/functions | `createTool({ name, description, parameters, execute })` |
| Typed tool args models | `z.object({...})` schemas |
| Sync + async mixed APIs | consistently async APIs (`await`) |
| Session history handling | `SessionManager` + session stores |
| Memory strategy composition | `MemoryManager` + injection/save/query strategies |
| Hooks/event callbacks | hook registry + event bus/stream events |
| Provider model id usage | `provider:model` format |

## Step-by-step Porting Plan

### Step 1: Port the minimal runnable agent

Start with one simple conversational path.

Python-style idea:

```python
agent = Agent(model="openai:gpt-4o-mini", system_prompt="You are helpful")
result = agent.run("Hello")
```

TypeScript equivalent:

```typescript
import { Agent, LLMClient } from "curio-agent-sdk";

const agent = Agent.builder()
  .model("openai:gpt-4o-mini")
  .llmClient(new LLMClient())
  .systemPrompt("You are helpful")
  .build();

const result = await agent.run("Hello");
console.log(result.output);
```

### Step 2: Port tools one by one

Move tools incrementally and validate each with deterministic tests.

### Step 3: Port memory and session continuity

Enable session-backed history first, then long-term memory if needed.

### Step 4: Port observability and controls

Bring over middleware, hooks, guardrails, and rate/cost controls.

### Step 5: Port tests in layers

Use unit/integration/e2e hierarchy with `MockLLM` where possible.

## Code Translation Patterns

### Configuration and startup

Python often centralizes config in module globals or startup scripts.
In TypeScript, prefer explicit composition:
- env loading at app bootstrap
- dependencies created once
- agent built with injected dependencies

### Async flow control

In Python you may have sync wrappers around async internals.
In TypeScript, keep orchestration async end-to-end:
- API handlers
- job runners
- CLI commands

### Error handling

Prefer typed error boundaries and explicit catches around:
- provider calls
- tool execution
- persistence writes

## Tool Migration Patterns

### Basic migration

```typescript
import { createTool } from "curio-agent-sdk";
import { z } from "zod";

export const weatherTool = createTool({
  name: "weather",
  description: "Lookup weather by city",
  parameters: z.object({
    city: z.string(),
    unit: z.enum(["c", "f"]).default("c"),
  }),
  execute: async ({ city, unit }) => {
    return `Weather for ${city} in ${unit.toUpperCase()}`;
  },
});
```

### Tool migration checklist

- Keep tool names stable if prompts/tests depend on them.
- Preserve semantic descriptions so model routing remains similar.
- Move validation into Zod schemas (required/optional/defaults/enums).
- Normalize return format if downstream parsing expects structure.

## Memory and Session Migration

### Session continuity

Use `SessionManager` and pass `{ sessionId }` to `agent.run(...)` across turns.
This mirrors chat/session persistence patterns from Python implementations.

### Long-term memory

Attach `MemoryManager` with your selected memory backend and strategy.
Validate:
- what gets saved
- when it gets injected
- whether retrieval quality matches prior behavior

## Middleware and Hooks Migration

When porting middleware/hook logic:
- map each old hook to nearest lifecycle equivalent
- preserve ordering assumptions (before/after/error paths)
- ensure side effects are idempotent where retries can occur

Recommended first ports:
1. logging/tracing
2. guardrails
3. rate limit and budget controls

## Testing Migration Plan

### 1) Unit tests

Port tool and utility tests first:
- schema validation
- deterministic tool execution
- parser/formatter helpers

### 2) Integration tests

Cover composed behavior:
- agent + tools
- agent + sessions
- agent + memory
- agent + middleware/hooks

### 3) E2E tests

User-level workflows:
- simple single-turn
- tool-using workflow
- multi-turn continuity
- resilience/fallback behavior

### 4) Optional live tests

Gate with environment flags and keep separate from default CI path.

## Behavior Parity Checklist

Before switching production traffic:
- prompt templates produce equivalent task framing
- tool names and argument shapes remain backward-compatible
- retry/timeouts/max-iterations are tuned similarly
- memory/session continuity matches expected user experience
- error responses and fallback behavior are acceptable
- latency and token/cost envelopes are within budget

## Common Pitfalls

### Hidden sync assumptions

Symptoms:
- race conditions or dropped writes

Fix:
- make the full call path async, await every persistence/network edge

### Schema mismatch after port

Symptoms:
- tool call validation errors at runtime

Fix:
- align Zod schema with actual tool usage and defaults
- inspect tool call payloads from deterministic tests

### Prompt drift causing tool underuse

Symptoms:
- model replies directly when tool usage was expected

Fix:
- improve system instructions and tool descriptions
- assert tool-call expectations in e2e tests

### Over-coupling to provider-specific behavior

Fix:
- preserve provider selection explicitly in model strings
- add abstraction-level tests for essential behavior
