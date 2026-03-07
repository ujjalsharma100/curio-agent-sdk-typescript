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

### Setting provider keys

Examples expect your provider credentials to be available as environment variables. For OpenAI, Anthropic, and Groq this typically looks like:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GROQ_API_KEY=gsk_...
```

To persist a key for your shell, you can add it to your shell profile (for example on zsh):

```bash
echo 'export OPENAI_API_KEY=sk-...' >> ~/.zshrc
source ~/.zshrc
```

If you prefer using a `.env` file, install `dotenv` and load it before running examples:

```bash
npm install dotenv
```

Then, in your example entrypoint:

```typescript
import "dotenv/config";
```

Make sure the environment variable name matches the provider prefix used in your model string:
- `openai:...` → `OPENAI_API_KEY`
- `anthropic:...` → `ANTHROPIC_API_KEY`
- `groq:...` → `GROQ_API_KEY`

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
- **full run logging** — writes a timestamped `.log` file with every LLM request/response, tool call (name + exact args), and result

When to use:
- integrating internal APIs/utilities as tools
- validating tool call observability and result formatting
- inspecting exactly what the agent sent and received (prompts, tool calls, arguments)

### Tool agents by provider

Each logs the full run to a `.log` file (e.g. `tool-agent-openai-2025-03-07T12-30-45.log`):

- **`tool-agent-openai.ts`** — OpenAI (e.g. `gpt-4o-mini`). Requires `OPENAI_API_KEY`.
- **`tool-agent-groq.ts`** — Groq (e.g. `llama-3.3-70b-versatile`). Requires `GROQ_API_KEY`.
- **`tool-agent-anthropic.ts`** — Anthropic (e.g. `claude-3-5-haiku`). Requires `ANTHROPIC_API_KEY`.
- **`tool-agent-ollama.ts`** — Ollama (e.g. `llama3.2`). Requires Ollama running locally (`ollama pull llama3.2`). Set `OLLAMA_HOST` if not at `http://localhost:11434`.

Run any of them; after the run, open the printed log path to see:
- each LLM request (messages, model, tools)
- each LLM response (content, tool calls with arguments, usage)
- each tool call start (tool name, exact arguments)
- each tool call end (result, duration)

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
npx tsx examples/tool-agent-openai.ts
npx tsx examples/tool-agent-groq.ts
npx tsx examples/tool-agent-anthropic.ts
npx tsx examples/tool-agent-ollama.ts
npx tsx examples/memory-agent.ts
npx tsx examples/streaming-agent.ts
```

Tool examples write a **run log** to a timestamped file (e.g. `tool-agent-openai-2025-03-07T12-30-45.log`) in the current working directory. The path is printed at the end of the run.

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
