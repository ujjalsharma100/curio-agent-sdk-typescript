/**
 * Event types — for hooks, streaming, and the event bus.
 */

import type { AgentRunResult } from "./agent.js";

// ---------------------------------------------------------------------------
// Hook event types (string enum for the hook registry)
// ---------------------------------------------------------------------------

/** All built-in hook event names. */
export const HookEvent = {
  // Agent lifecycle
  AGENT_RUN_BEFORE: "agent.run.before",
  AGENT_RUN_AFTER: "agent.run.after",
  AGENT_RUN_ERROR: "agent.run.error",

  // Loop iterations
  AGENT_ITERATION_BEFORE: "agent.iteration.before",
  AGENT_ITERATION_AFTER: "agent.iteration.after",

  // LLM calls
  LLM_CALL_BEFORE: "llm.call.before",
  LLM_CALL_AFTER: "llm.call.after",
  LLM_CALL_ERROR: "llm.call.error",

  // Tool calls
  TOOL_CALL_BEFORE: "tool.call.before",
  TOOL_CALL_AFTER: "tool.call.after",
  TOOL_CALL_ERROR: "tool.call.error",

  // Memory
  MEMORY_INJECT_BEFORE: "memory.inject.before",
  MEMORY_SAVE_BEFORE: "memory.save.before",
  MEMORY_QUERY_BEFORE: "memory.query.before",

  // State
  STATE_CHECKPOINT_BEFORE: "state.checkpoint.before",
  STATE_CHECKPOINT_AFTER: "state.checkpoint.after",
} as const;

export type HookEventName = (typeof HookEvent)[keyof typeof HookEvent];

// ---------------------------------------------------------------------------
// Hook context (mutable, passed to hook handlers)
// ---------------------------------------------------------------------------

/** Mutable context passed to hook handlers. Handlers can cancel or modify data. */
export class HookContext {
  readonly event: string;
  readonly data: Record<string, unknown>;
  readonly runId?: string;
  readonly agentId?: string;
  readonly iteration?: number;
  private _cancelled = false;

  constructor(params: {
    event: string;
    data: Record<string, unknown>;
    runId?: string;
    agentId?: string;
    iteration?: number;
  }) {
    this.event = params.event;
    this.data = { ...params.data };
    this.runId = params.runId;
    this.agentId = params.agentId;
    this.iteration = params.iteration;
  }

  /** Cancel the operation that triggered this hook. */
  cancel(): void {
    this._cancelled = true;
  }

  /** Whether cancel() has been called. */
  get cancelled(): boolean {
    return this._cancelled;
  }

  /** Modify a data field. Use to alter tool arguments, LLM requests, etc. */
  modify(key: string, value: unknown): void {
    this.data[key] = value;
  }
}

/** A hook handler function. */
export type HookHandler = (ctx: HookContext) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Agent event (for the event bus / legacy callbacks)
// ---------------------------------------------------------------------------

/** Enum of high-level event types for the event bus. */
export enum EventType {
  RUN_STARTED = "run.started",
  RUN_COMPLETED = "run.completed",
  RUN_ERROR = "run.error",
  ITERATION_STARTED = "iteration.started",
  ITERATION_COMPLETED = "iteration.completed",
  LLM_CALL_STARTED = "llm.call.started",
  LLM_CALL_COMPLETED = "llm.call.completed",
  LLM_CALL_ERROR = "llm.call.error",
  TOOL_CALL_STARTED = "tool.call.started",
  TOOL_CALL_COMPLETED = "tool.call.completed",
  TOOL_CALL_ERROR = "tool.call.error",
}

/** A discrete event emitted by the agent during execution. */
export interface AgentEvent {
  type: EventType;
  timestamp: Date;
  data: Record<string, unknown>;
  runId: string;
  agentId: string;
  iteration: number;
}

/** Create an AgentEvent with defaults. */
export function createAgentEvent(
  type: EventType,
  data: Record<string, unknown>,
  context: { runId: string; agentId: string; iteration: number },
): AgentEvent {
  return {
    type,
    timestamp: new Date(),
    data,
    runId: context.runId,
    agentId: context.agentId,
    iteration: context.iteration,
  };
}

// ---------------------------------------------------------------------------
// Stream events (discriminated union for agent.astream())
// ---------------------------------------------------------------------------

/** Events yielded by agent.astream() — discriminated union on `type`. */
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; toolName: string; toolCallId: string; arguments: Record<string, unknown> }
  | { type: "tool_call_end"; toolName: string; toolCallId: string; result: string; error?: string; duration: number }
  | { type: "thinking"; text: string }
  | { type: "iteration_start"; iteration: number }
  | { type: "iteration_end"; iteration: number }
  | { type: "error"; error: Error }
  | { type: "done"; result: AgentRunResult };

// ---------------------------------------------------------------------------
// Event bus types
// ---------------------------------------------------------------------------

/** Handler for event bus subscriptions. */
export type EventBusHandler = (event: AgentEvent) => void | Promise<void>;

/** Unsubscribe function returned by event bus subscribe(). */
export type Unsubscribe = () => void;
