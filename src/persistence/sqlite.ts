import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import type { AgentEvent } from "../models/events.js";
import type { AgentRun, AgentStats, LLMUsageRecord, Persistence } from "./base.js";

/**
 * Options for configuring the SQLite persistence backend.
 */
export interface SqlitePersistenceOptions {
  /** Path to the SQLite database file. Defaults to "curio-agent.sqlite3". */
  filePath?: string;
}

type BetterSqliteConstructor = new (file: string) => BetterSqliteDatabase;

/**
 * SQLite-backed Persistence implementation using better-sqlite3.
 *
 * This implements a minimal schema that can evolve over time without
 * breaking backward compatibility. Tables are created on-demand.
 */
export class SqlitePersistence implements Persistence {
  private readonly db: BetterSqliteDatabase;

  constructor(options: SqlitePersistenceOptions = {}) {
    const filePath = options.filePath ?? "curio-agent.sqlite3";

    let BetterSqlite: BetterSqliteConstructor;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      BetterSqlite = require("better-sqlite3") as BetterSqliteConstructor;
    } catch (err) {
      throw new Error(
        'better-sqlite3 is not installed. Install it with "npm install better-sqlite3" to use SqlitePersistence.',
        { cause: err as Error },
      );
    }

    this.db = new BetterSqlite(filePath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS agent_runs (
          run_id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          agent_name TEXT,
          input TEXT,
          output TEXT,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          duration_ms INTEGER,
          model TEXT,
          usage_json TEXT,
          metrics_json TEXT,
          error_message TEXT,
          metadata_json TEXT
        )
      `,
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT,
          agent_id TEXT,
          type TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          data_json TEXT
        )
      `,
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS llm_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT,
          agent_id TEXT,
          provider TEXT,
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          latency_ms INTEGER,
          cost_usd REAL,
          timestamp TEXT NOT NULL
        )
      `,
      )
      .run();
  }

  async createAgentRun(run: AgentRun): Promise<void> {
    const stmt = this.db.prepare(
      `
      INSERT OR REPLACE INTO agent_runs (
        run_id, agent_id, agent_name, input, output, status,
        started_at, completed_at, duration_ms, model,
        usage_json, metrics_json, error_message, metadata_json
      ) VALUES (
        @run_id, @agent_id, @agent_name, @input, @output, @status,
        @started_at, @completed_at, @duration_ms, @model,
        @usage_json, @metrics_json, @error_message, @metadata_json
      )
    `,
    );

    stmt.run(this.toRunRow(run));
  }

  async updateAgentRun(runId: string, update: Partial<AgentRun>): Promise<void> {
    const existing = await this.getAgentRun(runId);
    const merged: AgentRun = existing
      ? { ...existing, ...update, runId }
      : {
          runId,
          agentId: update.agentId ?? "unknown",
          status: update.status ?? "running",
          startedAt: update.startedAt ?? new Date(),
          ...update,
        };
    await this.createAgentRun(merged);
  }

  async getAgentRun(runId: string): Promise<AgentRun | null> {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM agent_runs
        WHERE run_id = ?
      `,
      )
      .get(runId) as
      | {
          run_id: string;
          agent_id: string;
          agent_name: string | null;
          input: string | null;
          output: string | null;
          status: string;
          started_at: string;
          completed_at: string | null;
          duration_ms: number | null;
          model: string | null;
          usage_json: string | null;
          metrics_json: string | null;
          error_message: string | null;
          metadata_json: string | null;
        }
      | undefined;

    if (!row) return null;
    return this.fromRunRow(row);
  }

  async logEvent(event: AgentEvent): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO events (run_id, agent_id, type, timestamp, data_json)
        VALUES (@run_id, @agent_id, @type, @timestamp, @data_json)
      `,
      )
      .run({
        run_id: event.runId,
        agent_id: event.agentId,
        type: event.type,
        timestamp: event.timestamp.toISOString(),
        data_json: JSON.stringify(event.data ?? {}),
      });
  }

  async logLLMUsage(usage: LLMUsageRecord): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO llm_usage (
          run_id, agent_id, provider, model,
          input_tokens, output_tokens, total_tokens,
          latency_ms, cost_usd, timestamp
        ) VALUES (
          @run_id, @agent_id, @provider, @model,
          @input_tokens, @output_tokens, @total_tokens,
          @latency_ms, @cost_usd, @timestamp
        )
      `,
      )
      .run({
        run_id: usage.runId ?? null,
        agent_id: usage.agentId ?? null,
        provider: usage.provider ?? null,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        latency_ms: usage.latencyMs ?? null,
        cost_usd: usage.costUsd ?? null,
        timestamp: usage.timestamp.toISOString(),
      });
  }

  async getStats(agentId?: string): Promise<AgentStats> {
    const whereClause = agentId ? "WHERE agent_id = @agent_id" : "";
    const runs = this.db
      .prepare(
        `
        SELECT *
        FROM agent_runs
        ${whereClause}
      `,
      )
      .all(agentId ? { agent_id: agentId } : {}) as Array<{
      run_id: string;
      agent_id: string;
      agent_name: string | null;
      input: string | null;
      output: string | null;
      status: string;
      started_at: string;
      completed_at: string | null;
      duration_ms: number | null;
      model: string | null;
      usage_json: string | null;
      metrics_json: string | null;
      error_message: string | null;
      metadata_json: string | null;
    }>;

    let runsTotal = runs.length;
    let runsSucceeded = 0;
    let runsFailed = 0;
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let llmCalls = 0;
    let toolCalls = 0;
    let totalCostUsd = 0;
    let totalDurationMs = 0;
    let lastRunAt: Date | null = null;

    for (const row of runs) {
      const run = this.fromRunRow(row);

      if (run.status === "completed") runsSucceeded += 1;
      if (run.status === "error") runsFailed += 1;

      if (run.usage) {
        promptTokens += run.usage.promptTokens ?? 0;
        completionTokens += run.usage.completionTokens ?? 0;
        totalTokens += run.usage.totalTokens ?? 0;
      }
      if (run.metrics) {
        llmCalls += run.metrics.llmCalls ?? 0;
        toolCalls += run.metrics.toolCalls ?? 0;
        totalCostUsd += run.metrics.estimatedCost ?? 0;
      }
      if (run.durationMs != null) {
        totalDurationMs += run.durationMs;
      }
      const completed = run.completedAt ?? run.startedAt;
      if (!lastRunAt || completed > lastRunAt) {
        lastRunAt = completed;
      }
    }

    const averageRunDurationMs =
      runsTotal > 0 ? Math.round(totalDurationMs / runsTotal) : 0;

    return {
      agentId: agentId ?? null,
      runsTotal,
      runsSucceeded,
      runsFailed,
      totalTokens,
      promptTokens,
      completionTokens,
      llmCalls,
      toolCalls,
      totalCostUsd,
      averageRunDurationMs,
      lastRunAt,
    };
  }

  private toRunRow(run: AgentRun): Record<string, unknown> {
    return {
      run_id: run.runId,
      agent_id: run.agentId,
      agent_name: run.agentName ?? null,
      input: run.input ?? null,
      output: run.output ?? null,
      status: run.status,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt ? run.completedAt.toISOString() : null,
      duration_ms: run.durationMs ?? null,
      model: run.model ?? null,
      usage_json: run.usage ? JSON.stringify(run.usage) : null,
      metrics_json: run.metrics ? JSON.stringify(run.metrics) : null,
      error_message: run.errorMessage ?? null,
      metadata_json: run.metadata ? JSON.stringify(run.metadata) : null,
    };
  }

  private fromRunRow(row: {
    run_id: string;
    agent_id: string;
    agent_name: string | null;
    input: string | null;
    output: string | null;
    status: string;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    model: string | null;
    usage_json: string | null;
    metrics_json: string | null;
    error_message: string | null;
    metadata_json: string | null;
  }): AgentRun {
    return {
      runId: row.run_id,
      agentId: row.agent_id,
      agentName: row.agent_name ?? undefined,
      input: row.input ?? undefined,
      output: row.output ?? undefined,
      status: row.status as AgentRun["status"],
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      durationMs: row.duration_ms ?? null,
      model: row.model ?? null,
      usage: row.usage_json ? (JSON.parse(row.usage_json) as AgentRun["usage"]) : null,
      metrics: row.metrics_json
        ? (JSON.parse(row.metrics_json) as AgentRun["metrics"])
        : null,
      errorMessage: row.error_message ?? null,
      metadata: row.metadata_json
        ? (JSON.parse(row.metadata_json) as AgentRun["metadata"])
        : null,
    };
  }
}

