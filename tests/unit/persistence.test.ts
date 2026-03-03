/**
 * Unit tests for Phase 16: Persistence & Audit.
 */

import { describe, it, expect, vi } from "vitest";
import {
  InMemoryPersistence,
  SqlitePersistence,
  PostgresPersistence,
  registerAuditHooks,
  HookRegistry,
  HookContext,
  HookEvent,
} from "../../src/index.js";
import { emptyTokenUsage } from "../../src/models/llm.js";
import { emptyMetrics } from "../../src/models/agent.js";

// ---------------------------------------------------------------------------
// InMemoryPersistence
// ---------------------------------------------------------------------------

describe("InMemoryPersistence", () => {
  it("creates, updates, and retrieves runs", async () => {
    const persistence = new InMemoryPersistence();
    const startedAt = new Date();
    await persistence.createAgentRun({
      runId: "run-1",
      agentId: "agent-1",
      agentName: "TestAgent",
      input: "hello",
      output: null,
      status: "running",
      startedAt,
      completedAt: null,
      durationMs: null,
      model: "gpt-4o-mini",
      usage: {
        ...emptyTokenUsage(),
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      metrics: {
        ...emptyMetrics(),
        llmCalls: 1,
        toolCalls: 2,
        estimatedCost: 0.01,
      },
      errorMessage: null,
      metadata: { foo: "bar" },
    });

    const completedAt = new Date(startedAt.getTime() + 100);
    await persistence.updateAgentRun("run-1", {
      status: "completed",
      output: "ok",
      completedAt,
      durationMs: 100,
    });

    const run = await persistence.getAgentRun("run-1");
    expect(run).not.toBeNull();
    expect(run?.status).toBe("completed");
    expect(run?.output).toBe("ok");
    expect(run?.agentId).toBe("agent-1");
    expect(run?.agentName).toBe("TestAgent");
    expect(run?.durationMs).toBe(100);
  });

  it("getStats aggregates metrics and usage", async () => {
    const persistence = new InMemoryPersistence();
    const now = new Date();

    await persistence.createAgentRun({
      runId: "r1",
      agentId: "a1",
      status: "completed",
      startedAt: now,
      completedAt: new Date(now.getTime() + 100),
      durationMs: 100,
      model: "gpt-4o-mini",
      input: "hi",
      output: "ok",
      agentName: "AgentOne",
      usage: {
        ...emptyTokenUsage(),
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      metrics: {
        ...emptyMetrics(),
        llmCalls: 2,
        toolCalls: 1,
        estimatedCost: 0.02,
      },
      errorMessage: null,
      metadata: null,
    });

    await persistence.createAgentRun({
      runId: "r2",
      agentId: "a1",
      status: "error",
      startedAt: now,
      completedAt: new Date(now.getTime() + 200),
      durationMs: 200,
      model: "gpt-4o-mini",
      input: "bad",
      output: null,
      agentName: "AgentOne",
      usage: null,
      metrics: null,
      errorMessage: "boom",
      metadata: null,
    });

    const stats = await persistence.getStats("a1");
    expect(stats.agentId).toBe("a1");
    expect(stats.runsTotal).toBe(2);
    expect(stats.runsSucceeded).toBe(1);
    expect(stats.runsFailed).toBe(1);
    expect(stats.promptTokens).toBe(20);
    expect(stats.completionTokens).toBe(10);
    expect(stats.totalTokens).toBe(30);
    expect(stats.llmCalls).toBe(2);
    expect(stats.toolCalls).toBe(1);
    expect(stats.totalCostUsd).toBeCloseTo(0.02);
    expect(stats.averageRunDurationMs).toBeGreaterThanOrEqual(100);
    expect(stats.averageRunDurationMs).toBeLessThanOrEqual(200);
  });

  it("getStats falls back to LLM usage records when runs lack usage", async () => {
    const persistence = new InMemoryPersistence();
    const now = new Date();

    await persistence.logLLMUsage({
      model: "gpt-4o-mini",
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
      timestamp: now,
      runId: "r-usage",
      agentId: "a-usage",
      provider: "openai",
      latencyMs: 50,
      costUsd: 0.001,
    });

    const stats = await persistence.getStats("a-usage");
    expect(stats.totalTokens).toBe(12);
    expect(stats.promptTokens).toBe(5);
    expect(stats.completionTokens).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// registerAuditHooks wiring (with a mocked Persistence implementation)
// ---------------------------------------------------------------------------

describe("registerAuditHooks", () => {
  it("wires agent run, LLM, and tool events into Persistence", async () => {
    const createAgentRun = vi.fn(async () => {});
    const updateAgentRun = vi.fn(async () => {});
    const logEvent = vi.fn(async () => {});
    const logLLMUsage = vi.fn(async () => {});

    const persistence = {
      createAgentRun,
      updateAgentRun,
      getAgentRun: async () => null,
      logEvent,
      logLLMUsage,
      getStats: async () => ({
        agentId: null,
        runsTotal: 0,
        runsSucceeded: 0,
        runsFailed: 0,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        llmCalls: 0,
        toolCalls: 0,
        totalCostUsd: 0,
        averageRunDurationMs: 0,
        lastRunAt: null,
      }),
    };

    const registry = new HookRegistry();
    registerAuditHooks(registry, persistence);

    const runCtxBefore = new HookContext({
      event: HookEvent.AGENT_RUN_BEFORE,
      data: { agent_name: "TestAgent", input: "hello" },
      runId: "run-1",
      agentId: "agent-1",
      iteration: 0,
    });
    await registry.emit(HookEvent.AGENT_RUN_BEFORE, runCtxBefore);

    expect(createAgentRun).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledTimes(1);

    const runCtxAfter = new HookContext({
      event: HookEvent.AGENT_RUN_AFTER,
      data: { status: "completed" },
      runId: "run-1",
      agentId: "agent-1",
      iteration: 0,
    });
    await registry.emit(HookEvent.AGENT_RUN_AFTER, runCtxAfter);
    expect(updateAgentRun).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledTimes(2);

    const llmCtxAfter = new HookContext({
      event: HookEvent.LLM_CALL_AFTER,
      data: {
        response: {
          provider: "openai",
          model: "gpt-4o-mini",
          usage: {
            promptTokens: 3,
            completionTokens: 4,
            totalTokens: 7,
          },
        },
        latency_ms: 42,
      },
      runId: "run-1",
      agentId: "agent-1",
      iteration: 0,
    });
    await registry.emit(HookEvent.LLM_CALL_AFTER, llmCtxAfter);
    expect(logEvent).toHaveBeenCalledTimes(3);
    expect(logLLMUsage).toHaveBeenCalledTimes(1);

    const toolCtxAfter = new HookContext({
      event: HookEvent.TOOL_CALL_AFTER,
      data: { tool_name: "echo", result: "ok" },
      runId: "run-1",
      agentId: "agent-1",
      iteration: 1,
    });
    await registry.emit(HookEvent.TOOL_CALL_AFTER, toolCtxAfter);
    expect(logEvent).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// SqlitePersistence — only when better-sqlite3 is available
// ---------------------------------------------------------------------------

let hasBetterSqlite = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("better-sqlite3");
} catch {
  hasBetterSqlite = false;
}

(hasBetterSqlite ? describe : describe.skip)("SqlitePersistence", () => {
  it("creates and retrieves runs from SQLite", async () => {
    const persistence = new SqlitePersistence({ filePath: ":memory:" });
    const startedAt = new Date();
    await persistence.createAgentRun({
      runId: "sqlite-run-1",
      agentId: "sqlite-agent",
      status: "completed",
      startedAt,
      completedAt: startedAt,
      durationMs: 10,
      model: "gpt-4o-mini",
      input: "hi",
      output: "ok",
      agentName: "SqlAgent",
      usage: null,
      metrics: null,
      errorMessage: null,
      metadata: null,
    });

    const run = await persistence.getAgentRun("sqlite-run-1");
    expect(run).not.toBeNull();
    expect(run?.agentId).toBe("sqlite-agent");

    const stats = await persistence.getStats("sqlite-agent");
    expect(stats.runsTotal).toBe(1);
    expect(stats.runsSucceeded).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PostgresPersistence — only when pg is available
// ---------------------------------------------------------------------------

let hasPg = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("pg");
} catch {
  hasPg = false;
}

(hasPg ? describe : describe.skip)("PostgresPersistence", () => {
  it("computes stats from aggregated row", async () => {
    const persistence = new PostgresPersistence({ poolConfig: {} as unknown });

    // Override the internal pool.query with a stub that returns aggregate stats.
    const pool = (persistence as unknown as { pool: { query: ReturnType<typeof vi.fn> } })
      .pool;

    pool.query = vi.fn(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT") && sql.includes("FROM agent_runs")) {
        return {
          rows: [
            {
              runs_total: "2",
              runs_succeeded: "1",
              runs_failed: "1",
              prompt_tokens: "10",
              completion_tokens: "5",
              total_tokens: "15",
              llm_calls: "3",
              tool_calls: "2",
              total_cost_usd: "0.05",
              total_duration_ms: "300",
              last_run_at: new Date().toISOString(),
            },
          ],
        } as unknown;
      }
      // Schema initialization queries
      return { rows: [], rowCount: 0 } as unknown;
    });

    const stats = await persistence.getStats();
    expect(stats.runsTotal).toBe(2);
    expect(stats.runsSucceeded).toBe(1);
    expect(stats.runsFailed).toBe(1);
    expect(stats.totalTokens).toBe(15);
    expect(stats.promptTokens).toBe(10);
    expect(stats.completionTokens).toBe(5);
    expect(stats.llmCalls).toBe(3);
    expect(stats.toolCalls).toBe(2);
    expect(stats.totalCostUsd).toBeCloseTo(0.05);
    expect(stats.averageRunDurationMs).toBeGreaterThan(0);
  });
});

