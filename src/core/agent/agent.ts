/**
 * Agent — the top-level user-facing class.
 *
 * An Agent wraps a Runtime and provides the main API for running conversations:
 * - agent.run(input) — run to completion
 * - agent.arun(input, options) — async run with options
 * - agent.astream(input, options) — streaming async iterator
 *
 * Agents are created via the fluent builder API:
 * ```typescript
 * const agent = Agent.builder()
 *   .model("anthropic:claude-sonnet-4-6")
 *   .llmClient(myClient)
 *   .systemPrompt("You are helpful.")
 *   .tools([readFile, writeFile])
 *   .build();
 *
 * const result = await agent.run("Read package.json");
 * ```
 */

import type { AgentRunResult, RunOptions } from "../../models/agent.js";
import type { StreamEvent } from "../../models/events.js";
import { Runtime } from "./runtime.js";
import { AgentBuilder } from "./builder.js";
import { ToolRegistry } from "../tools/registry.js";
import { HookRegistry } from "../events/hooks.js";
import type { Tool } from "../tools/tool.js";
import type { SessionManager } from "../state/session.js";

/** Parameters for direct Agent construction (used by the builder). */
export interface AgentParams {
  runtime: Runtime;
  agentId: string;
  agentName: string;
  model: string;
  toolRegistry: ToolRegistry;
  hookRegistry: HookRegistry;
  metadata?: Record<string, unknown>;
  sessionManager?: SessionManager;
  subagents?: Map<string, Agent>;
}

export class Agent {
  /** The runtime that executes runs. */
  readonly runtime: Runtime;
  /** Unique agent identifier. */
  readonly agentId: string;
  /** Human-readable agent name. */
  readonly agentName: string;
  /** The model string this agent uses. */
  readonly model: string;

  private readonly _toolRegistry: ToolRegistry;
  private readonly _hookRegistry: HookRegistry;
  private readonly _metadata: Record<string, unknown>;
  private _sessionManager?: SessionManager;
  private readonly _subagents: Map<string, Agent>;
  private _closed = false;

  constructor(params: AgentParams) {
    this.runtime = params.runtime;
    this.agentId = params.agentId;
    this.agentName = params.agentName;
    this.model = params.model;
    this._toolRegistry = params.toolRegistry;
    this._hookRegistry = params.hookRegistry;
    this._metadata = params.metadata ?? {};
    this._sessionManager = params.sessionManager;
    this._subagents = params.subagents ?? new Map<string, Agent>();
  }

  // ── Static builder ───────────────────────────────────────────────────────

  /** Create a new AgentBuilder for fluent construction. */
  static builder(): AgentBuilder {
    return new AgentBuilder();
  }

  // ── Properties ───────────────────────────────────────────────────────────

  /** Get all registered tools. */
  get tools(): Tool[] {
    return this._toolRegistry.getAll();
  }

  /** Get the tool registry. */
  get toolRegistry(): ToolRegistry {
    return this._toolRegistry;
  }

  /** Get the hook registry. */
  get hookRegistry(): HookRegistry {
    return this._hookRegistry;
  }

  /** Get the session manager used for conversation persistence, if any. */
  get sessionManager(): SessionManager | undefined {
    return this._sessionManager;
  }

  /**
   * Set the session manager used for conversation persistence.
   *
   * This is primarily intended for CLI and framework integrations that
   * want to attach a SessionManager after the agent has been constructed.
   */
  set sessionManager(manager: SessionManager | undefined) {
    this._sessionManager = manager;
  }

  /** Get agent metadata. */
  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  /** Get a read-only view of registered subagents. */
  get subagents(): ReadonlyMap<string, Agent> {
    return this._subagents;
  }

  /** Whether this agent has been closed. */
  get closed(): boolean {
    return this._closed;
  }

  // ── Execution ────────────────────────────────────────────────────────────

  /**
   * Run the agent to completion with the given input.
   * This is the simplest API — equivalent to `await agent.arun(input)`.
   */
  async run(input: string, options?: RunOptions): Promise<AgentRunResult> {
    return this.arun(input, options);
  }

  /**
   * Run the agent to completion with full options.
   * @param input - The user's input message.
   * @param options - Run options (session, signal, timeout, etc.).
   * @returns The complete run result.
   */
  async arun(input: string, options?: RunOptions): Promise<AgentRunResult> {
    this.ensureNotClosed();
    let runOptions = options;
    if (options?.sessionId && this._sessionManager) {
      const history = await this._sessionManager.getMessages(options.sessionId);
      runOptions = { ...options, initialMessages: history };
    }
    const state = this.runtime.createState(input, runOptions);
    const result = await this.runtime.runWithState(state);
    // Persist new messages to session for multi-turn continuity
    if (options?.sessionId && this._sessionManager && runOptions?.initialMessages != null) {
      const startIndex = 1 + runOptions.initialMessages.length; // after system + history
      for (let i = startIndex; i < state.messages.length; i++) {
        const msg = state.messages[i];
        if (msg) await this._sessionManager.addMessage(options.sessionId, msg);
      }
    }
    return result;
  }

  /**
   * Run the agent with streaming, yielding events as they occur.
   * @param input - The user's input message.
   * @param options - Run options.
   * @returns An async iterator of StreamEvents.
   *
   * @example
   * ```typescript
   * for await (const event of agent.astream("Hello")) {
   *   switch (event.type) {
   *     case "text_delta": process.stdout.write(event.text); break;
   *     case "tool_call_start": console.log(`\nCalling ${event.toolName}...`); break;
   *     case "done": console.log(`\nDone in ${event.result.duration}ms`); break;
   *   }
   * }
   * ```
   */
  async *astream(input: string, options?: RunOptions): AsyncIterableIterator<StreamEvent> {
    this.ensureNotClosed();
    const state = this.runtime.createState(input, options);
    yield* this.runtime.streamWithState(state);
  }

  // ── Subagents ──────────────────────────────────────────────────────────────

  /**
   * Spawn a named subagent and run it to completion.
   *
   * Subagents are built at agent construction time from the registered
   * SubagentConfig entries on the builder. They share the same underlying
   * hooks, middleware, and (by default) model, but can have distinct system
   * prompts and tools.
   */
  async spawnSubagent(
    name: string,
    input: string,
    options?: RunOptions,
  ): Promise<AgentRunResult> {
    this.ensureNotClosed();
    const subagent = this._subagents.get(name);
    if (!subagent) {
      throw new Error(`Subagent "${name}" is not registered on this agent`);
    }
    return subagent.arun(input, options);
  }

  /**
   * Spawn a named subagent and stream events as they occur.
   */
  async *spawnSubagentStream(
    name: string,
    input: string,
    options?: RunOptions,
  ): AsyncIterableIterator<StreamEvent> {
    this.ensureNotClosed();
    const subagent = this._subagents.get(name);
    if (!subagent) {
      throw new Error(`Subagent "${name}" is not registered on this agent`);
    }
    yield* subagent.astream(input, options);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Close the agent and release any resources. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
  }

  /** Support `await using agent = Agent.builder().build()` */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private ensureNotClosed(): void {
    if (this._closed) {
      throw new Error("Agent has been closed and cannot accept new runs");
    }
  }
}
