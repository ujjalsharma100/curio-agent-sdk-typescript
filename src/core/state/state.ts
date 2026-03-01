/**
 * Agent state — mutable context passed through the agent loop.
 *
 * The state holds the conversation history, tool schemas, iteration count,
 * metrics, and extensible metadata. It is created per-run and passed to
 * every component (loop, hooks, middleware, memory).
 */

import type { Message, ToolSchema, TokenUsage } from "../../models/llm.js";
import type { AgentMetrics, ToolCallRecord } from "../../models/agent.js";
import { emptyMetrics } from "../../models/agent.js";
import { emptyTokenUsage, addTokenUsage } from "../../models/llm.js";
import { generateId } from "../../utils/hash.js";

// ---------------------------------------------------------------------------
// State extension protocol
// ---------------------------------------------------------------------------

/** Interface for state extensions (plan mode, custom data, etc.). */
export interface StateExtension {
  toDict(): Record<string, unknown>;
}

/** Factory to deserialize a state extension from a dict. */
export type StateExtensionFactory = (data: Record<string, unknown>) => StateExtension;

// ---------------------------------------------------------------------------
// Agent state
// ---------------------------------------------------------------------------

export class AgentState {
  /** Full message history for this run. */
  messages: Message[];

  /** Tool schemas available to the LLM. */
  toolSchemas: ToolSchema[];

  /** Current loop iteration (0-indexed). */
  iteration: number;

  /** Maximum iterations allowed. */
  maxIterations: number;

  /** Unique run identifier. */
  readonly runId: string;

  /** Optional agent identifier (set by runtime for hook context). */
  agentId?: string;

  /** Aggregate token usage across all LLM calls in this run. */
  usage: TokenUsage;

  /** Real-time metrics. */
  metrics: AgentMetrics;

  /** Tool call records for the run result. */
  toolCallRecords: ToolCallRecord[];

  /** Arbitrary metadata. */
  metadata: Map<string, unknown>;

  /** Typed state extensions (plan mode, etc.). */
  private extensions: Map<string, StateExtension>;

  /** State transition history (phase name -> monotonic timestamp). */
  private transitionHistory: [string, number][] = [];

  /** Current phase name. */
  currentPhase = "";

  /** Whether the run has been completed (final answer produced). */
  completed: boolean;

  /** The final output text, set when the run completes. */
  output: string;

  /** The model being used for this run. */
  model: string;

  /** Abort signal for cancellation. */
  signal?: AbortSignal;

  constructor(params: {
    messages?: Message[];
    toolSchemas?: ToolSchema[];
    maxIterations?: number;
    runId?: string;
    agentId?: string;
    model?: string;
    signal?: AbortSignal;
  }) {
    this.messages = params.messages ?? [];
    this.toolSchemas = params.toolSchemas ?? [];
    this.iteration = 0;
    this.maxIterations = params.maxIterations ?? 50;
    this.runId = params.runId ?? generateId();
    this.agentId = params.agentId;
    this.usage = emptyTokenUsage();
    this.metrics = emptyMetrics();
    this.toolCallRecords = [];
    this.metadata = new Map();
    this.extensions = new Map();
    this.completed = false;
    this.output = "";
    this.model = params.model ?? "";
    this.signal = params.signal;
  }

  /** Add a message to the conversation history. */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /** Accumulate token usage from an LLM call. */
  addUsage(usage: TokenUsage): void {
    this.usage = addTokenUsage(this.usage, usage);
    this.metrics.promptTokens = this.usage.promptTokens;
    this.metrics.completionTokens = this.usage.completionTokens;
    this.metrics.totalTokens = this.usage.totalTokens;
  }

  /** Get a typed state extension. */
  getExtension<T extends StateExtension>(key: string): T | undefined {
    return this.extensions.get(key) as T | undefined;
  }

  /** Set a state extension. */
  setExtension(key: string, extension: StateExtension): void {
    this.extensions.set(key, extension);
  }

  /** Record a state transition (e.g. planning -> executing). */
  recordTransition(phase: string): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.transitionHistory.push([phase, now]);
    this.currentPhase = phase;
  }

  /** Return the list of (phase_name, monotonic_timestamp) transitions. */
  getTransitionHistory(): [string, number][] {
    return [...this.transitionHistory];
  }

  /** Restore transition history (e.g. after loading from checkpoint). */
  setTransitionHistory(history: [string, number][]): void {
    this.transitionHistory = [...history];
    const last = history[history.length - 1];
    this.currentPhase = last ? last[0] : "";
  }

  /** Serialize extensions for checkpoint. Keys are extension keys; values are toDict() payloads. */
  getExtensionsForCheckpoint(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, ext] of this.extensions) {
      try {
        out[key] = { ...ext.toDict() };
      } catch {
        // Skip extensions that fail to serialize
      }
    }
    return out;
  }

  /** Restore extensions from checkpoint data using the given factories. */
  setExtensionsFromCheckpoint(
    data: Record<string, Record<string, unknown>>,
    factories: Map<string, StateExtensionFactory>,
  ): void {
    for (const [key, payload] of Object.entries(data)) {
      const factory = factories.get(key);
      if (factory) {
        try {
          this.setExtension(key, factory(payload));
        } catch {
          // Skip extensions that fail to deserialize
        }
      }
    }
  }

  /** Check if the run should be aborted. */
  get aborted(): boolean {
    return this.signal?.aborted ?? false;
  }

  /** Serialize state to a checkpoint-compatible object. */
  toCheckpoint(): Record<string, unknown> {
    const extensionData: Record<string, Record<string, unknown>> = {};
    for (const [key, ext] of this.extensions) {
      extensionData[key] = ext.toDict();
    }

    return {
      messages: this.messages,
      toolSchemas: this.toolSchemas,
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      runId: this.runId,
      usage: this.usage,
      metrics: this.metrics,
      toolCallRecords: this.toolCallRecords,
      metadata: Object.fromEntries(this.metadata),
      extensions: extensionData,
      completed: this.completed,
      output: this.output,
      model: this.model,
    };
  }

  /** Restore state from a checkpoint object. */
  static fromCheckpoint(
    data: Record<string, unknown>,
    extensionFactories?: Map<string, StateExtensionFactory>,
  ): AgentState {
    const state = new AgentState({
      messages: data["messages"] as Message[],
      toolSchemas: data["toolSchemas"] as ToolSchema[],
      maxIterations: data["maxIterations"] as number,
      runId: data["runId"] as string,
      model: data["model"] as string,
    });

    state.iteration = data["iteration"] as number;
    state.usage = data["usage"] as TokenUsage;
    state.metrics = data["metrics"] as AgentMetrics;
    state.toolCallRecords = data["toolCallRecords"] as ToolCallRecord[];
    state.completed = data["completed"] as boolean;
    state.output = data["output"] as string;

    const metadataObj = data["metadata"] as Record<string, unknown> | undefined;
    if (metadataObj) {
      for (const [k, v] of Object.entries(metadataObj)) {
        state.metadata.set(k, v);
      }
    }

    const extensionData = data["extensions"] as Record<string, Record<string, unknown>> | undefined;
    if (extensionData && extensionFactories) {
      for (const [key, extData] of Object.entries(extensionData)) {
        const factory = extensionFactories.get(key);
        if (factory) {
          state.setExtension(key, factory(extData));
        }
      }
    }

    return state;
  }
}
