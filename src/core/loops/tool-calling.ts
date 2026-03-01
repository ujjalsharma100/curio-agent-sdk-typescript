/**
 * Tool-calling loop — the standard agent loop pattern.
 *
 * 1. Call LLM with current messages + tool schemas
 * 2. If LLM returns tool calls → execute them → add results → loop
 * 3. If LLM returns text only → done
 */

import type { AgentLoop } from "./base.js";
import type { ILLMClient } from "../llm/client.js";
import type { AgentState } from "../state/state.js";
import type { Message, ToolCall, ToolResult, LLMRequest } from "../../models/llm.js";
import { ToolExecutor } from "../tools/executor.js";
import { HookRegistry } from "../events/hooks.js";
import { HookContext, HookEvent } from "../../models/events.js";

export class ToolCallingLoop implements AgentLoop {
  constructor(
    private readonly llmClient: ILLMClient,
    private readonly toolExecutor: ToolExecutor,
    private readonly hooks: HookRegistry,
  ) {}

  async step(state: AgentState): Promise<AgentState> {
    // Check abort
    if (state.aborted) {
      state.completed = true;
      return state;
    }

    // Emit iteration.before hook
    const iterCtx = new HookContext({
      event: HookEvent.AGENT_ITERATION_BEFORE,
      data: { iteration: state.iteration },
      runId: state.runId,
      iteration: state.iteration,
    });
    await this.hooks.emit(HookEvent.AGENT_ITERATION_BEFORE, iterCtx);
    if (iterCtx.cancelled) {
      state.completed = true;
      return state;
    }

    // Build LLM request
    const request: LLMRequest = {
      messages: state.messages,
      model: state.model,
      tools: state.toolSchemas.length > 0 ? state.toolSchemas : undefined,
    };

    // Emit llm.call.before hook
    const llmBeforeCtx = new HookContext({
      event: HookEvent.LLM_CALL_BEFORE,
      data: { request },
      runId: state.runId,
      iteration: state.iteration,
    });
    await this.hooks.emit(HookEvent.LLM_CALL_BEFORE, llmBeforeCtx);
    if (llmBeforeCtx.cancelled) {
      state.completed = true;
      return state;
    }

    // Call LLM
    const llmStart = Date.now();
    let response;
    try {
      response = await this.llmClient.call(request);
    } catch (err) {
      // Emit llm.call.error hook
      await this.hooks.emit(
        HookEvent.LLM_CALL_ERROR,
        new HookContext({
          event: HookEvent.LLM_CALL_ERROR,
          data: { error: err, request },
          runId: state.runId,
          iteration: state.iteration,
        }),
      );
      throw err;
    }
    const llmDuration = Date.now() - llmStart;

    // Track usage
    state.addUsage(response.usage);
    state.metrics.llmCalls++;
    state.metrics.llmLatency += llmDuration;

    // Emit llm.call.after hook
    await this.hooks.emit(
      HookEvent.LLM_CALL_AFTER,
      new HookContext({
        event: HookEvent.LLM_CALL_AFTER,
        data: { request, response, duration: llmDuration },
        runId: state.runId,
        iteration: state.iteration,
      }),
    );

    // Build assistant message
    const assistantMsg: Message = {
      role: "assistant",
      content: response.content,
      ...(response.toolCalls.length > 0 && { toolCalls: response.toolCalls }),
    };
    state.addMessage(assistantMsg);

    // If no tool calls, we're done
    if (response.toolCalls.length === 0) {
      state.output = response.content;
      state.completed = true;
      state.iteration++;

      // Emit iteration.after
      await this.hooks.emit(
        HookEvent.AGENT_ITERATION_AFTER,
        new HookContext({
          event: HookEvent.AGENT_ITERATION_AFTER,
          data: { iteration: state.iteration - 1, completed: true },
          runId: state.runId,
          iteration: state.iteration - 1,
        }),
      );

      return state;
    }

    // Execute tool calls
    const toolStart = Date.now();
    const toolResults = await this.executeToolCalls(state, response.toolCalls);
    state.metrics.toolLatency += Date.now() - toolStart;

    // Add tool result messages
    for (const result of toolResults) {
      const toolMsg: Message = {
        role: "tool",
        content: result.error ?? result.result,
        toolCallId: result.toolCallId,
        name: result.toolName,
      };
      state.addMessage(toolMsg);

      // Track tool call record
      state.toolCallRecords.push({
        toolName: result.toolName,
        arguments: response.toolCalls.find((tc) => tc.id === result.toolCallId)?.arguments ?? {},
        result: result.result,
        error: result.error,
        duration: result.duration ?? 0,
        iteration: state.iteration,
      });
    }

    state.iteration++;

    // Emit iteration.after
    await this.hooks.emit(
      HookEvent.AGENT_ITERATION_AFTER,
      new HookContext({
        event: HookEvent.AGENT_ITERATION_AFTER,
        data: {
          iteration: state.iteration - 1,
          completed: false,
          toolCalls: response.toolCalls.length,
        },
        runId: state.runId,
        iteration: state.iteration - 1,
      }),
    );

    return state;
  }

  shouldContinue(state: AgentState): boolean {
    if (state.completed) return false;
    if (state.aborted) return false;
    if (state.iteration >= state.maxIterations) return false;
    return true;
  }

  /** Execute tool calls (executor emits tool.call.before/after/error when hookRegistry is set). */
  private async executeToolCalls(
    state: AgentState,
    toolCalls: ToolCall[],
  ) {
    const execContext = { runId: state.runId, agentId: state.agentId };
    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      state.metrics.toolCalls++;
      const toolResult = await this.toolExecutor.executeTool(call, execContext);
      results.push(toolResult);
    }
    return results;
  }
}
