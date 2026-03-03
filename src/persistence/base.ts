/**
 * Persistence interfaces and core types for storing agent runs and usage.
 *
 * This module is a TypeScript analogue of the Python curio_agent_sdk
 * persistence layer. It intentionally defines a narrow, backend-agnostic
 * interface that can be implemented by in-memory, SQLite, Postgres, or
 * custom adapters.
 */

import type { AgentEvent } from "../models/events.js";
import type { AgentMetrics, AgentRunResult } from "../models/agent.js";
import type { TokenUsage } from "../models/llm.js";

// ---------------------------------------------------------------------------
// Core record types
// ---------------------------------------------------------------------------

/** Status of an agent run, from creation through completion. */
export type AgentRunStatus = "running" | "completed" | "error";

/**
 * A durable record of a single agent run.
 *
 * Backends are free to add additional columns/fields, but should be able
 * to round-trip at least the properties defined here.
 */
export interface AgentRun {
  /** Unique identifier for this run (typically the AgentState.runId). */
  runId: string;
  /** Identifier of the agent that produced this run. */
  agentId: string;
  /** Optional human-readable agent name. */
  agentName?: string;

  /** Original user input for this run, if available. */
  input?: string | null;
  /** Final output from the agent, if completed. */
  output?: string | null;

  /** Current status of the run. */
  status: AgentRunStatus;

  /** When the run started. */
  startedAt: Date;
  /** When the run completed or failed. */
  completedAt?: Date | null;

  /** Total wall-clock duration in milliseconds, if known. */
  durationMs?: number | null;

  /** Model identifier used for this run. */
  model?: string | null;

  /** Aggregated token usage across all LLM calls. */
  usage?: TokenUsage | null;

  /** Aggregated runtime metrics captured by the agent. */
  metrics?: AgentMetrics | null;

  /** Optional error message when status === "error". */
  errorMessage?: string | null;

  /** Arbitrary metadata provided by the caller or backend. */
  metadata?: Record<string, unknown> | null;
}

/**
 * A single LLM usage record, typically corresponding to one LLM call.
 */
export interface LLMUsageRecord {
  id?: string;
  runId?: string | null;
  agentId?: string | null;

  provider?: string | null;
  model: string;

  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  /** Wall-clock latency for this call (ms). */
  latencyMs?: number | null;

  /** Optional cost in USD, when available. */
  costUsd?: number | null;

  /** Timestamp of when the call completed. */
  timestamp: Date;
}

/**
 * Aggregated statistics across one or more agent runs.
 *
 * Implementations are free to compute additional, backend-specific
 * statistics, but should populate at least these core counters.
 */
export interface AgentStats {
  /** Agent identifier this snapshot is scoped to (if any). */
  agentId?: string | null;

  /** Total number of runs observed. */
  runsTotal: number;
  /** Number of successfully completed runs. */
  runsSucceeded: number;
  /** Number of runs that ended in error. */
  runsFailed: number;

  /** Aggregate token usage. */
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;

  /** Aggregate counts of LLM/tool calls, when available. */
  llmCalls: number;
  toolCalls: number;

  /** Total estimated cost across runs (USD), when available. */
  totalCostUsd: number;

  /** Average run duration in milliseconds, rounded to nearest integer. */
  averageRunDurationMs: number;

  /** Timestamp of most recent run included in this snapshot, if any. */
  lastRunAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Persistence interface
// ---------------------------------------------------------------------------

/**
 * Backend-agnostic persistence interface for recording agent activity.
 *
 * All methods are intentionally coarse-grained to keep backends simple and
 * to support both relational and document-style storage engines.
 */
export interface Persistence {
  /**
   * Create a new agent run record.
   *
   * Implementations should treat run.runId as the primary key and either
   * insert or upsert as appropriate for the underlying datastore.
   */
  createAgentRun(run: AgentRun): Promise<void>;

  /**
   * Update an existing agent run.
   *
   * If the run does not exist, implementations may choose to create it,
   * or they may treat this as a no-op. They should not throw for a
   * missing run unless that is explicitly documented.
   */
  updateAgentRun(runId: string, update: Partial<AgentRun>): Promise<void>;

  /**
   * Retrieve a single agent run by its identifier.
   */
  getAgentRun(runId: string): Promise<AgentRun | null>;

  /**
   * Persist a high-level agent event.
   *
   * This commonly comes from the event bus or from the audit hook wiring
   * in `persistence/audit-hooks.ts`.
   */
  logEvent(event: AgentEvent): Promise<void>;

  /**
   * Persist a single LLM usage record.
   */
  logLLMUsage(usage: LLMUsageRecord): Promise<void>;

  /**
   * Compute aggregate statistics for an agent.
   *
   * When agentId is omitted, implementations should compute a global
   * snapshot across all agents.
   */
  getStats(agentId?: string): Promise<AgentStats>;
}

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

/**
 * Convenience shape for adapters that want to accept a full AgentRunResult
 * and derive an AgentRun record from it.
 */
export interface AgentRunWithResult extends AgentRun {
  result?: AgentRunResult;
}

