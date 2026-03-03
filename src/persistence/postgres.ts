import type { Pool, PoolConfig, QueryResult } from "pg";
import type { AgentEvent } from "../models/events.js";
import type { AgentRun, AgentStats, LLMUsageRecord, Persistence } from "./base.js";

/**
 * Options for configuring the Postgres persistence backend.
 */
export interface PostgresPersistenceOptions {
  /** Standard pg Pool configuration or connection string. */
  poolConfig?: PoolConfig | string;
}

type PoolConstructor = new (config?: PoolConfig | string) => Pool;

/**
 * PostgreSQL-backed Persistence implementation using pg.Pool.
 *
 * Tables are created lazily on first use. This implementation is intended
 * for production deployments where a remote database is preferred over
 * embedded SQLite.
 */
export class PostgresPersistence implements Persistence {
  private readonly pool: Pool;
  private initialized = false;

  constructor(options: PostgresPersistenceOptions = {}) {
    let PgPool: PoolConstructor;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      PgPool = require("pg").Pool as PoolConstructor;
    } catch (err) {
      throw new Error(
        'pg is not installed. Install it with "npm install pg" to use PostgresPersistence.',
        { cause: err as Error },
      );
    }

    this.pool = new PgPool(options.poolConfig);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT,
        input TEXT,
        output TEXT,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        duration_ms BIGINT,
        model TEXT,
        usage_json JSONB,
        metrics_json JSONB,
        error_message TEXT,
        metadata_json JSONB
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT,
        agent_id TEXT,
        type TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        data_json JSONB
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS llm_usage (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT,
        agent_id TEXT,
        provider TEXT,
        model TEXT NOT NULL,
        input_tokens BIGINT NOT NULL,
        output_tokens BIGINT NOT NULL,
        total_tokens BIGINT NOT NULL,
        latency_ms BIGINT,
        cost_usd DOUBLE PRECISION,
        timestamp TIMESTAMPTZ NOT NULL
      );
    `);

    this.initialized = true;
  }

  async createAgentRun(run: AgentRun): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `
      INSERT INTO agent_runs (
        run_id, agent_id, agent_name, input, output, status,
        started_at, completed_at, duration_ms, model,
        usage_json, metrics_json, error_message, metadata_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14
      )
      ON CONFLICT (run_id) DO UPDATE SET
        agent_id = EXCLUDED.agent_id,
        agent_name = EXCLUDED.agent_name,
        input = EXCLUDED.input,
        output = EXCLUDED.output,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        duration_ms = EXCLUDED.duration_ms,
        model = EXCLUDED.model,
        usage_json = EXCLUDED.usage_json,
        metrics_json = EXCLUDED.metrics_json,
        error_message = EXCLUDED.error_message,
        metadata_json = EXCLUDED.metadata_json
      `,
      this.toRunParams(run),
    );
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
    await this.ensureInitialized();
    const result: QueryResult<{
      run_id: string;
      agent_id: string;
      agent_name: string | null;
      input: string | null;
      output: string | null;
      status: string;
      started_at: string;
      completed_at: string | null;
      duration_ms: string | null;
      model: string | null;
      usage_json: unknown | null;
      metrics_json: unknown | null;
      error_message: string | null;
      metadata_json: unknown | null;
    }> = await this.pool.query(
      `
      SELECT *
      FROM agent_runs
      WHERE run_id = $1
      `,
      [runId],
    );

    const row = result.rows[0];
    if (!row) return null;
    return this.fromRunRow(row);
  }

  async logEvent(event: AgentEvent): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `
      INSERT INTO events (run_id, agent_id, type, timestamp, data_json)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        event.runId,
        event.agentId,
        event.type,
        event.timestamp.toISOString(),
        event.data ?? {},
      ],
    );
  }

  async logLLMUsage(usage: LLMUsageRecord): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `
      INSERT INTO llm_usage (
        run_id, agent_id, provider, model,
        input_tokens, output_tokens, total_tokens,
        latency_ms, cost_usd, timestamp
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10
      )
      `,
      [
        usage.runId ?? null,
        usage.agentId ?? null,
        usage.provider ?? null,
        usage.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.latencyMs ?? null,
        usage.costUsd ?? null,
        usage.timestamp.toISOString(),
      ],
    );
  }

  async getStats(agentId?: string): Promise<AgentStats> {
    await this.ensureInitialized();
    const whereClause = agentId ? "WHERE agent_id = $1" : "";
    const result: QueryResult<{
      runs_total: string;
      runs_succeeded: string;
      runs_failed: string;
      prompt_tokens: string | null;
      completion_tokens: string | null;
      total_tokens: string | null;
      llm_calls: string | null;
      tool_calls: string | null;
      total_cost_usd: string | null;
      total_duration_ms: string | null;
      last_run_at: string | null;
    }> = await this.pool.query(
      `
      SELECT
        COUNT(*) AS runs_total,
        COUNT(*) FILTER (WHERE status = 'completed') AS runs_succeeded,
        COUNT(*) FILTER (WHERE status = 'error') AS runs_failed,
        COALESCE(SUM((usage_json->>'promptTokens')::bigint), 0) AS prompt_tokens,
        COALESCE(SUM((usage_json->>'completionTokens')::bigint), 0) AS completion_tokens,
        COALESCE(SUM((usage_json->>'totalTokens')::bigint), 0) AS total_tokens,
        COALESCE(SUM((metrics_json->>'llmCalls')::bigint), 0) AS llm_calls,
        COALESCE(SUM((metrics_json->>'toolCalls')::bigint), 0) AS tool_calls,
        COALESCE(SUM((metrics_json->>'estimatedCost')::double precision), 0) AS total_cost_usd,
        COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
        MAX(COALESCE(completed_at, started_at)) AS last_run_at
      FROM agent_runs
      ${whereClause}
      `,
      agentId ? [agentId] : [],
    );

    const row = result.rows[0];
    if (!row) {
      return {
        agentId: agentId ?? null,
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
      };
    }
    const runsTotal = parseInt(row.runs_total, 10) || 0;
    const runsSucceeded = parseInt(row.runs_succeeded, 10) || 0;
    const runsFailed = parseInt(row.runs_failed, 10) || 0;
    const promptTokens = parseInt(row.prompt_tokens ?? "0", 10) || 0;
    const completionTokens = parseInt(row.completion_tokens ?? "0", 10) || 0;
    const totalTokens = parseInt(row.total_tokens ?? "0", 10) || 0;
    const llmCalls = parseInt(row.llm_calls ?? "0", 10) || 0;
    const toolCalls = parseInt(row.tool_calls ?? "0", 10) || 0;
    const totalCostUsd = parseFloat(row.total_cost_usd ?? "0") || 0;
    const totalDurationMs = parseInt(row.total_duration_ms ?? "0", 10) || 0;
    const lastRunAt = row.last_run_at ? new Date(row.last_run_at) : null;

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

  private toRunParams(run: AgentRun): unknown[] {
    return [
      run.runId,
      run.agentId,
      run.agentName ?? null,
      run.input ?? null,
      run.output ?? null,
      run.status,
      run.startedAt.toISOString(),
      run.completedAt ? run.completedAt.toISOString() : null,
      run.durationMs ?? null,
      run.model ?? null,
      run.usage ?? null,
      run.metrics ?? null,
      run.errorMessage ?? null,
      run.metadata ?? null,
    ];
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
    duration_ms: string | null;
    model: string | null;
    usage_json: unknown | null;
    metrics_json: unknown | null;
    error_message: string | null;
    metadata_json: unknown | null;
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
      durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
      model: row.model ?? null,
      usage: (row.usage_json as AgentRun["usage"]) ?? null,
      metrics: (row.metrics_json as AgentRun["metrics"]) ?? null,
      errorMessage: row.error_message ?? null,
      metadata: (row.metadata_json as AgentRun["metadata"]) ?? null,
    };
  }
}

