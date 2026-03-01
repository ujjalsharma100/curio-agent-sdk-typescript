/**
 * Tool-calling loop — the standard agent loop pattern.
 *
 * 1. Call LLM with current messages + tool schemas
 * 2. If LLM returns tool calls → execute them (in parallel when enabled) → add results → loop
 * 3. If LLM returns text only → done
 *
 * Supports structured output (responseFormat when no tools), max iterations,
 * and stream delegation via streamStep() for real-time events.
 */

import type { AgentLoop } from "./base.js";
import type { ILLMClient } from "../llm/client.js";
import type { AgentState } from "../state/state.js";
import type {
  Message,
  ToolCall,
  ToolResult,
  LLMRequest,
  LLMStreamChunk,
  ResponseFormat,
} from "../../models/llm.js";
import type { StreamEvent } from "../../models/events.js";
import { ToolExecutor } from "../tools/executor.js";
import { HookRegistry } from "../events/hooks.js";
import { HookContext, HookEvent } from "../../models/events.js";

/** Options for the tool-calling loop (parallel execution, structured output, etc.). */
export interface ToolCallingLoopOptions {
  /** Execute multiple tool calls in parallel when the LLM returns more than one. Default: true. */
  parallelToolCalls?: boolean;
  /** When set and no tools are registered, request structured JSON output from the LLM. */
  responseFormat?: ResponseFormat;
  /** Max tokens for each LLM call. */
  maxTokens?: number;
  /** Temperature for each LLM call. */
  temperature?: number;
}

export class ToolCallingLoop implements AgentLoop {
  private readonly parallelToolCalls: boolean;
  private readonly responseFormat?: ResponseFormat;
  private readonly maxTokens?: number;
  private readonly temperature?: number;

  constructor(
    private readonly llmClient: ILLMClient,
    private readonly toolExecutor: ToolExecutor,
    private readonly hooks: HookRegistry,
    options: ToolCallingLoopOptions = {},
  ) {
    this.parallelToolCalls = options.parallelToolCalls ?? true;
    this.responseFormat = options.responseFormat;
    this.maxTokens = options.maxTokens;
    this.temperature = options.temperature;
  }

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

    // Build LLM request (responseFormat only when no tools — providers often disallow both)
    const request: LLMRequest = {
      messages: state.messages,
      model: state.model,
      tools: state.toolSchemas.length > 0 ? state.toolSchemas : undefined,
      ...(this.maxTokens !== undefined && { maxTokens: this.maxTokens }),
      ...(this.temperature !== undefined && { temperature: this.temperature }),
      ...(state.toolSchemas.length === 0 && this.responseFormat && { responseFormat: this.responseFormat }),
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

    // Execute tool calls (parallel when enabled and more than one)
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

  /** Execute tool calls (parallel when parallelToolCalls and count > 1). */
  private async executeToolCalls(
    state: AgentState,
    toolCalls: ToolCall[],
  ): Promise<ToolResult[]> {
    const execContext = { runId: state.runId, agentId: state.agentId };
    for (let i = 0; i < toolCalls.length; i++) state.metrics.toolCalls++;

    if (this.parallelToolCalls && toolCalls.length > 1) {
      return this.toolExecutor.executeParallel(toolCalls, execContext);
    }
    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      results.push(await this.toolExecutor.executeTool(call, execContext));
    }
    return results;
  }

  /**
   * Run a single step with streaming: yields events as the LLM streams and as tools run.
   * Use this when the runtime is in streaming mode for real-time delegation.
   */
  async *streamStep(state: AgentState): AsyncIterableIterator<StreamEvent> {
    if (state.aborted) {
      state.completed = true;
      return;
    }

    const iterCtx = new HookContext({
      event: HookEvent.AGENT_ITERATION_BEFORE,
      data: { iteration: state.iteration },
      runId: state.runId,
      iteration: state.iteration,
    });
    await this.hooks.emit(HookEvent.AGENT_ITERATION_BEFORE, iterCtx);
    if (iterCtx.cancelled) {
      state.completed = true;
      return;
    }

    const request: LLMRequest = {
      messages: state.messages,
      model: state.model,
      tools: state.toolSchemas.length > 0 ? state.toolSchemas : undefined,
      ...(this.maxTokens !== undefined && { maxTokens: this.maxTokens }),
      ...(this.temperature !== undefined && { temperature: this.temperature }),
      ...(state.toolSchemas.length === 0 && this.responseFormat && { responseFormat: this.responseFormat }),
    };

    const llmBeforeCtx = new HookContext({
      event: HookEvent.LLM_CALL_BEFORE,
      data: { request },
      runId: state.runId,
      iteration: state.iteration,
    });
    await this.hooks.emit(HookEvent.LLM_CALL_BEFORE, llmBeforeCtx);
    if (llmBeforeCtx.cancelled) {
      state.completed = true;
      return;
    }

    let fullText = "";
    const toolCallBuffers = new Map<string, { id: string; name: string; args: string }>();
    const toolCallOrder: string[] = [];
    let usageFromStream: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};

    try {
      for await (const chunk of this.llmClient.stream(request)) {
        const ev = chunk as LLMStreamChunk;
        if (ev.type === "text_delta" && ev.text) {
          fullText += ev.text;
          yield { type: "text_delta", text: ev.text };
        } else if (ev.type === "tool_call_delta" && ev.toolCall) {
          const id = ev.toolCall.id;
          let buf = toolCallBuffers.get(id);
          if (!buf) {
            buf = { id, name: "", args: "" };
            toolCallBuffers.set(id, buf);
            toolCallOrder.push(id);
            if (ev.toolCall.name) {
              yield {
                type: "tool_call_start",
                toolName: ev.toolCall.name,
                toolCallId: id,
                arguments: {},
              };
            }
          }
          if (ev.toolCall.name) buf.name = ev.toolCall.name;
          if (ev.toolCall.arguments !== undefined) {
            const arg = ev.toolCall.arguments;
            buf.args += typeof arg === "string" ? arg : JSON.stringify(arg);
          }
        } else if (ev.type === "thinking_delta" && ev.text) {
          yield { type: "thinking", text: ev.text };
        } else if (ev.type === "usage" && ev.usage) {
          usageFromStream = ev.usage;
        }
        // ev.type === "done" with finishReason can be used for future logic
      }
    } catch (err) {
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

    const assembledToolCalls: ToolCall[] = [];
    for (const id of toolCallOrder) {
      const buf = toolCallBuffers.get(id);
      if (!buf) continue;
      let args: Record<string, unknown> = {};
      if (buf.args) {
        try {
          args = JSON.parse(buf.args) as Record<string, unknown>;
        } catch {
          args = { raw: buf.args };
        }
      }
      assembledToolCalls.push({ id: buf.id, name: buf.name || "unknown", arguments: args });
    }

    if (usageFromStream.promptTokens !== undefined || usageFromStream.completionTokens !== undefined) {
      state.addUsage({
        promptTokens: usageFromStream.promptTokens ?? 0,
        completionTokens: usageFromStream.completionTokens ?? 0,
        totalTokens: usageFromStream.totalTokens ?? (usageFromStream.promptTokens ?? 0) + (usageFromStream.completionTokens ?? 0),
      });
    }

    const assistantMsg: Message = {
      role: "assistant",
      content: fullText,
      ...(assembledToolCalls.length > 0 && { toolCalls: assembledToolCalls }),
    };
    state.addMessage(assistantMsg);

    if (assembledToolCalls.length === 0) {
      state.output = fullText;
      state.completed = true;
      state.iteration++;
      await this.hooks.emit(
        HookEvent.AGENT_ITERATION_AFTER,
        new HookContext({
          event: HookEvent.AGENT_ITERATION_AFTER,
          data: { iteration: state.iteration - 1, completed: true },
          runId: state.runId,
          iteration: state.iteration - 1,
        }),
      );
      yield { type: "iteration_end", iteration: state.iteration - 1 };
      return;
    }

    const execContext = { runId: state.runId, agentId: state.agentId };
    const toolResults = this.parallelToolCalls && assembledToolCalls.length > 1
      ? await this.toolExecutor.executeParallel(assembledToolCalls, execContext)
      : await Promise.all(assembledToolCalls.map((c) => this.toolExecutor.executeTool(c, execContext)));

    for (let i = 0; i < toolResults.length; i++) {
      const result = toolResults[i];
      const call = assembledToolCalls[i];
      if (!result || !call) continue;
      state.addMessage({
        role: "tool",
        content: result.error ?? result.result,
        toolCallId: result.toolCallId,
        name: result.toolName,
      });
      state.toolCallRecords.push({
        toolName: result.toolName,
        arguments: call.arguments,
        result: result.result,
        error: result.error,
        duration: result.duration ?? 0,
        iteration: state.iteration,
      });
      yield {
        type: "tool_call_end",
        toolName: result.toolName,
        toolCallId: result.toolCallId,
        result: result.result,
        error: result.error,
        duration: result.duration ?? 0,
      };
    }

    state.iteration++;
    await this.hooks.emit(
      HookEvent.AGENT_ITERATION_AFTER,
      new HookContext({
        event: HookEvent.AGENT_ITERATION_AFTER,
        data: { iteration: state.iteration - 1, completed: false, toolCalls: assembledToolCalls.length },
        runId: state.runId,
        iteration: state.iteration - 1,
      }),
    );
    yield { type: "iteration_end", iteration: state.iteration - 1 };
  }
}
