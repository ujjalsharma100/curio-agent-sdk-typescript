# API Reference Guide

This SDK publishes reference documentation generated from TSDoc comments in `src/`.

The generated API docs are intended to answer:
- What symbols are public and stable for consumers
- Which types and classes belong together by module
- What runtime contracts (inputs/outputs/events) each API exposes

## Table of Contents

- [How API Docs Are Generated](#how-api-docs-are-generated)
- [Generation Commands](#generation-commands)
- [Output Structure](#output-structure)
- [Entry Points Included in Docs](#entry-points-included-in-docs)
- [Public API Surface Map](#public-api-surface-map)
- [Working with TSDoc](#working-with-tsdoc)
- [Release-time Checklist](#release-time-checklist)
- [Common Warnings and Their Meaning](#common-warnings-and-their-meaning)
- [Troubleshooting](#troubleshooting)

## How API Docs Are Generated

The project uses TypeDoc configured by `typedoc.json`. The generation process:
1. Resolves configured entry points.
2. Follows re-exports from those roots.
3. Builds type/class/function docs from TSDoc blocks.
4. Emits HTML output into `docs/api/`.

The generated files are build artifacts and should not be edited manually.

## Generation Commands

```bash
npm run docs:api
```

Equivalent direct command:

```bash
npx typedoc --options typedoc.json
```

## Output Structure

After generation, `docs/api/` contains:
- `index.html` and module/type pages for browser navigation
- search metadata assets used by the HTML UI
- grouped documentation pages by entry module and symbol

## Entry Points Included in Docs

Configured entry points:
- `src/index.ts` (main package API)
- `src/testing/index.ts` (`curio-agent-sdk/testing`)
- `src/memory/index.ts` (`curio-agent-sdk/memory`)
- `src/middleware/index.ts` (`curio-agent-sdk/middleware`)

Why these entry points:
- They mirror published package subpath exports.
- They keep docs aligned with what consumers can import.

## Public API Surface Map

Use this as a reading guide when navigating generated docs.

### `curio-agent-sdk` (main entry)

Primary domains:
- **Agent runtime:** `Agent`, `AgentBuilder`, `Runtime`, run result/types
- **LLM layer:** `LLMClient`, provider abstractions, routing helpers
- **Tools:** `Tool`, `createTool`, registries, schema helpers
- **State and sessions:** checkpointing, stores, session manager
- **Hooks/events:** hook registry, event types, stream event contracts
- **Security:** permission policies and human-input adapters
- **Extensions:** skills, plugins, subagents
- **MCP:** bridge, client, transport, config parsing
- **Persistence:** in-memory/sqlite/postgres persistence and audit hooks
- **Utilities:** retries, timeout helpers, id generation, logger factory

### `curio-agent-sdk/testing`

Testing helpers for deterministic and regression-focused workflows:
- mock/replay clients
- harness and toolkit utilities
- evaluation and coverage helpers

### `curio-agent-sdk/memory`

Memory interfaces and implementations:
- memory backends (`ConversationMemory`, `KeyValueMemory`, etc.)
- manager and strategy contracts
- relevance/scoring helpers

### `curio-agent-sdk/middleware`

Cross-cutting runtime concerns:
- base middleware pipeline
- logging, tracing, guardrails, and cost/rate modules
- telemetry consumers and exporters

## Working with TSDoc

To produce useful API docs, document:
- **Intent:** why a symbol exists and where to use it
- **Contract:** parameter meaning and return semantics
- **Behavioral notes:** side effects, limits, assumptions
- **Examples:** realistic usage snippets for non-trivial APIs

Recommended TSDoc pattern:

```ts
/**
 * One-sentence summary.
 *
 * Longer behavior notes where needed.
 *
 * @param foo - What it controls.
 * @returns What callers can rely on.
 * @example
 * // minimal but realistic snippet
 */
```

## Release-time Checklist

Before publishing:
1. Ensure new public exports are intentionally added in entry points.
2. Add/update TSDoc for newly public symbols.
3. Run `npm run docs:api`.
4. Spot-check docs for key modules and symbol pages.
5. Commit generated docs if your release process expects checked-in artifacts.

## Common Warnings and Their Meaning

You may see TypeDoc warnings such as:
- "referenced by X but not included in documentation"
- source-link warnings if git remotes are unavailable in local context

Interpretation:
- These are often non-fatal and do not block generation.
- They usually mean a referenced type is not reachable from configured entry points.

When to fix:
- Fix warnings for symbols that should be public and documented.
- Ignore/internalize symbols that are implementation-only and not part of package API.

## Troubleshooting

### `docs:api` command fails

Check:
- dependency installed (`typedoc`)
- `typedoc.json` path and entry points are valid
- TypeScript project compiles (`npm run typecheck`)

### Newly exported symbol not appearing

Check:
- exported from an included entry point
- not excluded by TypeDoc config flags
- symbol has no unresolved type errors preventing emit

### Warnings are noisy after refactor

Approach:
- regenerate docs and inspect changed modules
- decide if newly referenced types should be exported
- otherwise keep them internal and avoid leaking internal types from public signatures
