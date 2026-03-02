/**
 * Agent-level data types — run results, metrics, and configuration.
 */

import type { Message, TokenUsage, ToolCall } from "./llm.js";

// ---------------------------------------------------------------------------
// Agent run result
// ---------------------------------------------------------------------------

/** Record of a single tool invocation during an agent run. */
export interface ToolCallRecord {
  toolName: string;
  arguments: Record<string, unknown>;
  result: string;
  error?: string;
  duration: number;
  iteration: number;
}

/** The complete result of an agent run. */
export interface AgentRunResult {
  /** The final text output from the agent. */
  output: string;
  /** The full message history of the run. */
  messages: Message[];
  /** All tool calls made during the run. */
  toolCalls: ToolCallRecord[];
  /** Aggregated token usage across all LLM calls. */
  usage: TokenUsage;
  /** Number of loop iterations executed. */
  iterations: number;
  /** Unique identifier for this run. */
  runId: string;
  /** Wall-clock duration in milliseconds. */
  duration: number;
  /** The model used for this run. */
  model: string;
  /** Arbitrary metadata attached to the result. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent metrics
// ---------------------------------------------------------------------------

/** Real-time metrics tracked during an agent run. */
export interface AgentMetrics {
  /** Total tokens consumed (prompt + completion). */
  totalTokens: number;
  /** Total prompt tokens. */
  promptTokens: number;
  /** Total completion tokens. */
  completionTokens: number;
  /** Number of LLM calls made. */
  llmCalls: number;
  /** Number of tool calls made. */
  toolCalls: number;
  /** Total estimated cost in USD. */
  estimatedCost: number;
  /** Wall-clock time spent in LLM calls (ms). */
  llmLatency: number;
  /** Wall-clock time spent in tool execution (ms). */
  toolLatency: number;
}

/** Create empty metrics. */
export function emptyMetrics(): AgentMetrics {
  return {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    llmCalls: 0,
    toolCalls: 0,
    estimatedCost: 0,
    llmLatency: 0,
    toolLatency: 0,
  };
}

// ---------------------------------------------------------------------------
// Agent configuration types
// ---------------------------------------------------------------------------

/** Options passed to a single agent run. */
export interface RunOptions {
  /** Session ID for multi-turn conversation persistence. */
  sessionId?: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Override the max iterations for this run. */
  maxIterations?: number;
  /** Override the timeout for this run (ms). */
  timeout?: number;
  /** Arbitrary metadata attached to this run. */
  metadata?: Record<string, unknown>;
  /** Pre-loaded session messages (used when sessionId is set to build conversation context). */
  initialMessages?: Message[];
}

/** Identity information for an agent. */
export interface AgentIdentity {
  /** Unique agent ID (auto-generated if not provided). */
  agentId: string;
  /** Human-readable agent name. */
  agentName: string;
}

// (Subagent configuration now lives in core/extensions/subagent.ts and is
// re-exported via the core extensions barrel and top-level index.)
