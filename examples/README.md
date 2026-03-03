# Cookbook Examples

This directory contains focused, runnable examples that demonstrate common production patterns for the TypeScript SDK.

Examples are intentionally small, but each one highlights a specific capability:
- baseline single-turn interactions
- tool-enabled reasoning loops
- persistent memory behavior
- real-time streaming integration

## Prerequisites

- Install dependencies:

```bash
npm install
```

- Set at least one provider key (for example `OPENAI_API_KEY`).
- Use Node 20+ and a TypeScript runner such as `tsx`.

## Example Index

### `hello-world.ts`

What it demonstrates:
- minimal `Agent.builder()` setup
- direct `agent.run(...)` usage
- simple output handling

When to use:
- first integration test
- smoke checks in CI or local setup validation

### `tool-agent.ts`

What it demonstrates:
- custom tool definition with `createTool(...)`
- schema-validated tool arguments via Zod
- loop behavior where model calls tools before final answer

When to use:
- integrating internal APIs/utilities as tools
- validating tool call observability and result formatting

### `memory-agent.ts`

What it demonstrates:
- attaching `MemoryManager` to an agent
- storing user context and retrieving it in subsequent turns
- memory-aware conversational continuity

When to use:
- assistants that must preserve preferences or historical facts
- long-running sessions beyond a single request/response

### `streaming-agent.ts`

What it demonstrates:
- consuming `agent.astream(...)`
- rendering incremental text and tool events
- handling stream completion and errors

When to use:
- terminal/chat UI streaming
- event-driven orchestration and progress feedback

## Running Examples

Run an example with `tsx`:

```bash
npx tsx examples/hello-world.ts
```

Other examples:

```bash
npx tsx examples/tool-agent.ts
npx tsx examples/memory-agent.ts
npx tsx examples/streaming-agent.ts
```

## Suggested Learning Path

1. Run `hello-world.ts` first to validate provider and baseline setup.
2. Run `tool-agent.ts` to understand tool schema and execution flow.
3. Run `streaming-agent.ts` to integrate event-driven UX.
4. Run `memory-agent.ts` once you need continuity beyond a single run.

## Adapting Examples for Production

When moving from sample to production:
- replace demo tool logic (for example `Function(...)` math shortcuts) with safe parsers/services
- add retry/timeouts and permission boundaries for side-effectful tools
- add middleware for tracing, cost tracking, and request correlation
- add deterministic tests using `MockLLM` before enabling live-provider traffic

## Troubleshooting

### Authentication errors

- verify provider env vars are set in your current shell
- ensure model id prefix matches provider (`openai:`, `anthropic:`, etc.)

### No streaming output

- verify your loop handles `text_delta` events
- check selected provider/model supports streaming behavior

### Unexpected tool behavior

- validate tool schema shape and parameter names
- improve tool descriptions so model selection is more reliable
