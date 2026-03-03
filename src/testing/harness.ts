import type { AgentRunResult } from "../models/agent.js";
import type { Agent } from "../core/agent/agent.js";
import { HookEvent } from "../models/events.js";
import type { HookContext } from "../models/events.js";
import { ToolTestKit } from "./toolkit.js";

export class AgentTestHarness {
  private readonly agent: Agent;
  private readonly _toolCalls: [string, Record<string, unknown>][] = [];
  private _lastResult?: AgentRunResult;

  constructor(agent: Agent, toolKit?: ToolTestKit) {
    this.agent = agent;
    this.agent.hookRegistry.on(HookEvent.TOOL_CALL_BEFORE, this.onToolCall);

    if (toolKit) {
      toolKit.attach(agent);
    }
  }

  async run(input: string): Promise<AgentRunResult> {
    this._toolCalls.length = 0;
    const result = await this.agent.run(input);
    this._lastResult = result;
    return result;
  }

  get toolCalls(): [string, Record<string, unknown>][] {
    return [...this._toolCalls];
  }

  assertToolCalled(name: string, args?: Record<string, unknown>): void {
    const calls = this._toolCalls.filter(([toolName]) => toolName === name);
    if (calls.length === 0) {
      throw new Error(`Expected tool "${name}" to be called, but it was not.`);
    }
    if (!args) return;

    const hasMatch = calls.some(([, callArgs]) =>
      Object.entries(args).every(([key, value]) => callArgs[key] === value),
    );
    if (!hasMatch) {
      throw new Error(
        `Expected tool "${name}" to be called with args ${JSON.stringify(args)}, ` +
          `but saw ${JSON.stringify(calls.map(([, callArgs]) => callArgs))}.`,
      );
    }
  }

  assertToolNotCalled(name: string): void {
    if (this._toolCalls.some(([toolName]) => toolName === name)) {
      throw new Error(`Expected tool "${name}" to not be called, but it was.`);
    }
  }

  assertOutputContains(text: string): void {
    const output = this._lastResult?.output ?? "";
    if (!output.includes(text)) {
      throw new Error(`Expected output to contain "${text}", got "${output}".`);
    }
  }

  private onToolCall = (ctx: HookContext): void => {
    const toolName = (ctx.data["toolName"] ?? ctx.data["tool"] ?? "") as string;
    const args = (ctx.data["args"] ?? {}) as Record<string, unknown>;
    this._toolCalls.push([toolName, { ...args }]);
  };
}

