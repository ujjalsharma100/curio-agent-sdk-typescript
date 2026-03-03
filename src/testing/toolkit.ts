import type { Agent } from "../core/agent/agent.js";
import type { Tool } from "../core/tools/tool.js";

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
}

interface ToolMock {
  returns?: string;
  sideEffect?: ((args: Record<string, unknown>) => string | Promise<string>) | Error;
}

export class ToolTestKit {
  private readonly mocks = new Map<string, ToolMock>();
  private readonly callLog: ToolCallRecord[] = [];
  private readonly originals = new Map<Tool, (args: Record<string, unknown>) => Promise<string>>();

  attach(agent: Agent): void {
    for (const tool of agent.tools) {
      if (this.originals.has(tool)) continue;

      const originalExecute = tool.execute.bind(tool);
      this.originals.set(tool, originalExecute);

      (tool as unknown as { execute: (args: Record<string, unknown>) => Promise<string> }).execute = async (
        args: Record<string, unknown>,
      ): Promise<string> => {
        const mock = this.mocks.get(tool.name);

        if (mock) {
          try {
            if (mock.sideEffect instanceof Error) {
              throw mock.sideEffect;
            }
            const value =
              typeof mock.sideEffect === "function"
                ? await mock.sideEffect(args)
                : (mock.returns ?? "");
            this.callLog.push({ name: tool.name, args: { ...args }, result: value });
            return value;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.callLog.push({ name: tool.name, args: { ...args }, error: message });
            throw error;
          }
        }

        try {
          const result = await originalExecute(args);
          this.callLog.push({ name: tool.name, args: { ...args }, result });
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.callLog.push({ name: tool.name, args: { ...args }, error: message });
          throw error;
        }
      };
    }
  }

  detach(): void {
    for (const [tool, original] of this.originals.entries()) {
      (tool as unknown as { execute: (args: Record<string, unknown>) => Promise<string> }).execute = original;
    }
    this.originals.clear();
  }

  mockTool(
    name: string,
    options: {
      returns?: string;
      sideEffect?: ((args: Record<string, unknown>) => string | Promise<string>) | Error;
    },
  ): void {
    this.mocks.set(name, { returns: options.returns, sideEffect: options.sideEffect });
  }

  clearMocks(): void {
    this.mocks.clear();
  }

  clearCalls(): void {
    this.callLog.length = 0;
  }

  get calls(): ToolCallRecord[] {
    return [...this.callLog];
  }

  getCalls(name: string): ToolCallRecord[] {
    return this.callLog.filter((call) => call.name === name);
  }

  assertToolCalled(name: string, expectedArgs?: Record<string, unknown>): void {
    const calls = this.getCalls(name);
    if (calls.length === 0) {
      throw new Error(`Expected tool "${name}" to be called, but it was not.`);
    }
    if (!expectedArgs) return;

    const hasMatch = calls.some((call) =>
      Object.entries(expectedArgs).every(([key, value]) => call.args[key] === value),
    );
    if (!hasMatch) {
      throw new Error(
        `Expected tool "${name}" to be called with args ${JSON.stringify(expectedArgs)}, ` +
          `but saw ${JSON.stringify(calls.map((c) => c.args))}.`,
      );
    }
  }

  assertToolNotCalled(name: string): void {
    if (this.callLog.some((call) => call.name === name)) {
      throw new Error(`Expected tool "${name}" to not be called, but it was.`);
    }
  }

  assertCallOrder(expectedOrder: string[]): void {
    const actual = this.callLog.map((call) => call.name);
    if (expectedOrder.length === 0) return;

    let i = 0;
    for (const name of actual) {
      if (name === expectedOrder[i]) i++;
      if (i === expectedOrder.length) return;
    }

    throw new Error(
      `Expected call order subsequence ${JSON.stringify(expectedOrder)} not found in ${JSON.stringify(actual)}.`,
    );
  }
}

