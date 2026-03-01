/**
 * Agent runtime — orchestrates a single agent run.
 *
 * The runtime creates state, runs the agent loop, manages hooks, memory,
 * and state persistence. It is the engine behind Agent.run() / Agent.astream().
 */

import type { Message } from "../../models/llm.js";
import type { AgentRunResult, RunOptions } from "../../models/agent.js";
import type { StreamEvent } from "../../models/events.js";
import { HookContext, HookEvent } from "../../models/events.js";
import { AgentState } from "../state/state.js";
import type { AgentLoop } from "../loops/base.js";
import { HookRegistry } from "../events/hooks.js";
import { ToolRegistry } from "../tools/registry.js";

/** Configuration for the runtime. */
export interface RuntimeConfig {
  /** The agent loop implementation. */
  loop: AgentLoop;
  /** Hook registry for lifecycle events. */
  hooks: HookRegistry;
  /** Tool registry for schema retrieval. */
  toolRegistry: ToolRegistry;
  /** Default model string (e.g., "anthropic:claude-sonnet-4-6"). */
  model: string;
  /** System prompt (or function returning one). */
  systemPrompt: string | (() => string);
  /** Maximum loop iterations per run. */
  maxIterations: number;
  /** Run timeout in milliseconds. 0 = no timeout. */
  timeout: number;
  /** Agent identity. */
  agentId: string;
}

export class Runtime {
  private readonly config: RuntimeConfig;

  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  /** Create initial state for a run. */
  createState(input: string, options?: RunOptions): AgentState {
    const systemPrompt =
      typeof this.config.systemPrompt === "function"
        ? this.config.systemPrompt()
        : this.config.systemPrompt;

    const messages: Message[] = [];

    // System message
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    // User message
    messages.push({ role: "user", content: input });

    const state = new AgentState({
      messages,
      toolSchemas: this.config.toolRegistry.getSchemas(),
      maxIterations: options?.maxIterations ?? this.config.maxIterations,
      model: this.config.model,
      agentId: this.config.agentId,
      signal: options?.signal,
    });

    // Attach run metadata
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        state.metadata.set(k, v);
      }
    }

    return state;
  }

  /** Run the agent loop to completion, returning the result. */
  async runWithState(state: AgentState): Promise<AgentRunResult> {
    const startTime = Date.now();

    // Emit agent.run.before
    const beforeCtx = new HookContext({
      event: HookEvent.AGENT_RUN_BEFORE,
      data: { input: state.messages[state.messages.length - 1]?.content ?? "" },
      runId: state.runId,
      agentId: this.config.agentId,
      iteration: 0,
    });
    await this.config.hooks.emit(HookEvent.AGENT_RUN_BEFORE, beforeCtx);

    if (beforeCtx.cancelled) {
      return this.buildResult(state, startTime);
    }

    // Set up timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = state.metadata.get("timeout") as number | undefined ?? this.config.timeout;

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        // We can't directly abort since there's no shared signal,
        // but we mark state as completed to stop the loop
        state.completed = true;
        state.output = "[Run timed out]";
      }, timeout);
    }

    try {
      // Run the loop
      while (this.config.loop.shouldContinue(state)) {
        await this.config.loop.step(state);
      }

      // If we hit max iterations without completing
      if (!state.completed && state.iteration >= state.maxIterations) {
        state.completed = true;
        if (!state.output) {
          state.output = "[Max iterations reached]";
        }
      }

      // Emit agent.run.after
      const result = this.buildResult(state, startTime);
      await this.config.hooks.emit(
        HookEvent.AGENT_RUN_AFTER,
        new HookContext({
          event: HookEvent.AGENT_RUN_AFTER,
          data: { result },
          runId: state.runId,
          agentId: this.config.agentId,
          iteration: state.iteration,
        }),
      );

      return result;
    } catch (err) {
      // Emit agent.run.error
      await this.config.hooks.emit(
        HookEvent.AGENT_RUN_ERROR,
        new HookContext({
          event: HookEvent.AGENT_RUN_ERROR,
          data: { error: err },
          runId: state.runId,
          agentId: this.config.agentId,
          iteration: state.iteration,
        }),
      );
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /** Run the agent loop, yielding stream events. */
  async *streamWithState(state: AgentState): AsyncIterableIterator<StreamEvent> {
    const startTime = Date.now();

    // Emit agent.run.before
    await this.config.hooks.emit(
      HookEvent.AGENT_RUN_BEFORE,
      new HookContext({
        event: HookEvent.AGENT_RUN_BEFORE,
        data: { input: state.messages[state.messages.length - 1]?.content ?? "" },
        runId: state.runId,
        agentId: this.config.agentId,
        iteration: 0,
      }),
    );

    try {
      const useStreamStep = typeof this.config.loop.streamStep === "function";

      while (this.config.loop.shouldContinue(state)) {
        yield { type: "iteration_start", iteration: state.iteration };

        if (useStreamStep) {
          for await (const event of this.config.loop.streamStep!(state)) {
            yield event;
          }
        } else {
          await this.config.loop.step(state);

          // Yield text delta if there's new content from the last assistant message
          const lastMsg = state.messages[state.messages.length - 1];
          if (lastMsg?.role === "assistant" && typeof lastMsg.content === "string" && lastMsg.content) {
            yield { type: "text_delta", text: lastMsg.content };
          }

          // Yield tool call events from the current iteration's tool call records
          const currentIterRecords = state.toolCallRecords.filter(
            (r) => r.iteration === state.iteration - 1,
          );
          for (const record of currentIterRecords) {
            yield {
              type: "tool_call_start",
              toolName: record.toolName,
              toolCallId: `tc_${record.toolName}_${state.iteration}`,
              arguments: record.arguments,
            };
            yield {
              type: "tool_call_end",
              toolName: record.toolName,
              toolCallId: `tc_${record.toolName}_${state.iteration}`,
              result: record.result,
              error: record.error,
              duration: record.duration,
            };
          }

          yield { type: "iteration_end", iteration: state.iteration - 1 };
        }
      }

      // Handle max iterations
      if (!state.completed && state.iteration >= state.maxIterations) {
        state.completed = true;
        if (!state.output) state.output = "[Max iterations reached]";
      }

      const result = this.buildResult(state, startTime);

      // Emit agent.run.after
      await this.config.hooks.emit(
        HookEvent.AGENT_RUN_AFTER,
        new HookContext({
          event: HookEvent.AGENT_RUN_AFTER,
          data: { result },
          runId: state.runId,
          agentId: this.config.agentId,
          iteration: state.iteration,
        }),
      );

      yield { type: "done", result };
    } catch (err) {
      // Emit agent.run.error
      await this.config.hooks.emit(
        HookEvent.AGENT_RUN_ERROR,
        new HookContext({
          event: HookEvent.AGENT_RUN_ERROR,
          data: { error: err },
          runId: state.runId,
          agentId: this.config.agentId,
          iteration: state.iteration,
        }),
      );
      yield { type: "error", error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  /** Build the final run result from state. */
  private buildResult(state: AgentState, startTime: number): AgentRunResult {
    return {
      output: state.output,
      messages: state.messages,
      toolCalls: state.toolCallRecords,
      usage: state.usage,
      iterations: state.iteration,
      runId: state.runId,
      duration: Date.now() - startTime,
      model: state.model,
    };
  }
}
