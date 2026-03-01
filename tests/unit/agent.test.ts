import { describe, it, expect, vi } from "vitest";
import {
  Agent,
  AgentBuilder,
  Tool,
  ToolRegistry,
  ToolExecutor,
  ToolCallingLoop,
  HookRegistry,
  HookEvent,
  HookContext,
  Runtime,
  AgentState,
} from "../../src/index.js";
import type { ILLMClient } from "../../src/index.js";
import type { LLMRequest, LLMResponse, LLMStreamChunk } from "../../src/index.js";

// ---------------------------------------------------------------------------
// Mock LLM client
// ---------------------------------------------------------------------------

function createMockLLM(responses: LLMResponse[]): ILLMClient {
  let callIndex = 0;
  return {
    async call(_request: LLMRequest): Promise<LLMResponse> {
      const response = responses[callIndex];
      if (!response) throw new Error("No more mock responses");
      callIndex++;
      return response;
    },
    async *stream(_request: LLMRequest): AsyncIterableIterator<LLMStreamChunk> {
      const response = responses[callIndex];
      if (!response) throw new Error("No more mock responses");
      callIndex++;
      yield { type: "text_delta", text: response.content };
      yield { type: "done", finishReason: response.finishReason };
    },
  };
}

function textResponse(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "test-model",
    finishReason: "stop",
  };
}

function toolCallResponse(toolName: string, args: Record<string, unknown>): LLMResponse {
  return {
    content: "",
    toolCalls: [{ id: `tc_${toolName}`, name: toolName, arguments: args }],
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    model: "test-model",
    finishReason: "tool_calls",
  };
}

function makeTool(name: string, fn: (args: Record<string, unknown>) => string): Tool {
  return new Tool({
    name,
    description: `Test tool: ${name}`,
    schema: { name, description: `Test tool: ${name}`, parameters: { type: "object", properties: {} } },
    execute: fn,
  });
}

// ---------------------------------------------------------------------------
// Tool tests
// ---------------------------------------------------------------------------

describe("Tool", () => {
  it("should execute and return a result", async () => {
    const tool = makeTool("greet", (args) => `Hello, ${args["name"]}!`);
    const result = await tool.execute({ name: "Alice" });
    expect(result).toBe("Hello, Alice!");
  });

  it("should expose schema", () => {
    const tool = makeTool("test", () => "ok");
    expect(tool.toLLMSchema().name).toBe("test");
  });
});

describe("ToolRegistry", () => {
  it("should register and retrieve tools", () => {
    const reg = new ToolRegistry();
    const tool = makeTool("myTool", () => "ok");
    reg.register(tool);

    expect(reg.has("myTool")).toBe(true);
    expect(reg.get("myTool")).toBe(tool);
    expect(reg.size).toBe(1);
    expect(reg.getNames()).toEqual(["myTool"]);
  });

  it("should throw on duplicate registration", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("dup", () => "1"));
    expect(() => reg.register(makeTool("dup", () => "2"))).toThrow("already registered");
  });

  it("should return schemas", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("a", () => ""));
    reg.register(makeTool("b", () => ""));
    const schemas = reg.getSchemas();
    expect(schemas).toHaveLength(2);
    expect(schemas.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("getOrThrow should throw ToolNotFoundError", () => {
    const reg = new ToolRegistry();
    expect(() => reg.getOrThrow("missing")).toThrow("not found");
  });

  it("should be iterable", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("x", () => ""));
    reg.register(makeTool("y", () => ""));
    const names = [...reg].map((t) => t.name);
    expect(names).toEqual(["x", "y"]);
  });
});

describe("ToolExecutor", () => {
  it("should execute a tool call", async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("echo", (args) => `echo: ${args["msg"]}`));
    const executor = new ToolExecutor(reg);

    const result = await executor.executeTool({
      id: "tc1",
      name: "echo",
      arguments: { msg: "hello" },
    });
    expect(result.result).toBe("echo: hello");
    expect(result.error).toBeUndefined();
    expect(result.toolCallId).toBe("tc1");
    expect(result.toolName).toBe("echo");
  });

  it("should return error for missing tool", async () => {
    const reg = new ToolRegistry();
    const executor = new ToolExecutor(reg);

    const result = await executor.executeTool({
      id: "tc1",
      name: "missing",
      arguments: {},
    });
    expect(result.error).toContain("not found");
  });

  it("should handle tool execution errors", async () => {
    const reg = new ToolRegistry();
    reg.register(
      new Tool({
        name: "fail",
        description: "Always fails",
        schema: { name: "fail", description: "fail", parameters: {} },
        execute: () => {
          throw new Error("boom");
        },
      }),
    );
    const executor = new ToolExecutor(reg);

    const result = await executor.executeTool({ id: "tc1", name: "fail", arguments: {} });
    expect(result.error).toBe("boom");
  });

  it("should execute tools in parallel", async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("a", () => "result_a"));
    reg.register(makeTool("b", () => "result_b"));
    const executor = new ToolExecutor(reg);

    const results = await executor.executeParallel([
      { id: "tc1", name: "a", arguments: {} },
      { id: "tc2", name: "b", arguments: {} },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]!.result).toBe("result_a");
    expect(results[1]!.result).toBe("result_b");
  });
});

// ---------------------------------------------------------------------------
// HookRegistry tests
// ---------------------------------------------------------------------------

describe("HookRegistry", () => {
  it("should register and emit hooks", async () => {
    const hooks = new HookRegistry();
    const calls: string[] = [];

    hooks.on("test.event", async (ctx) => {
      calls.push("handler1");
    });
    hooks.on("test.event", async (ctx) => {
      calls.push("handler2");
    });

    await hooks.emit("test.event", new HookContext({ event: "test.event", data: {} }));
    expect(calls).toEqual(["handler1", "handler2"]);
  });

  it("should respect priority order", async () => {
    const hooks = new HookRegistry();
    const calls: number[] = [];

    hooks.on("evt", () => { calls.push(2); }, 200);
    hooks.on("evt", () => { calls.push(1); }, 100);
    hooks.on("evt", () => { calls.push(3); }, 300);

    await hooks.emit("evt", new HookContext({ event: "evt", data: {} }));
    expect(calls).toEqual([1, 2, 3]);
  });

  it("should stop on cancel", async () => {
    const hooks = new HookRegistry();
    const calls: string[] = [];

    hooks.on("evt", (ctx) => { calls.push("a"); ctx.cancel(); }, 1);
    hooks.on("evt", () => { calls.push("b"); }, 2);

    const ctx = new HookContext({ event: "evt", data: {} });
    await hooks.emit("evt", ctx);

    expect(calls).toEqual(["a"]);
    expect(ctx.cancelled).toBe(true);
  });

  it("should allow removing handlers", async () => {
    const hooks = new HookRegistry();
    const handler = vi.fn();
    hooks.on("evt", handler);
    hooks.off("evt", handler);

    await hooks.emit("evt", new HookContext({ event: "evt", data: {} }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("should report handler presence", () => {
    const hooks = new HookRegistry();
    expect(hooks.hasHandlers("evt")).toBe(false);
    hooks.on("evt", () => {});
    expect(hooks.hasHandlers("evt")).toBe(true);
    expect(hooks.handlerCount("evt")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AgentState tests
// ---------------------------------------------------------------------------

describe("AgentState", () => {
  it("should create with defaults", () => {
    const state = new AgentState({ model: "test" });
    expect(state.messages).toEqual([]);
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(50);
    expect(state.completed).toBe(false);
    expect(state.runId).toBeTruthy();
  });

  it("should track messages", () => {
    const state = new AgentState({ model: "test" });
    state.addMessage({ role: "user", content: "hello" });
    expect(state.messages).toHaveLength(1);
  });

  it("should accumulate usage", () => {
    const state = new AgentState({ model: "test" });
    state.addUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    state.addUsage({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
    expect(state.usage.totalTokens).toBe(45);
    expect(state.metrics.totalTokens).toBe(45);
  });

  it("should support extensions", () => {
    const state = new AgentState({ model: "test" });
    const ext = { phase: "planning", toDict: () => ({ phase: "planning" }) };
    state.setExtension("plan", ext);
    expect(state.getExtension("plan")).toBe(ext);
  });

  it("should serialize to checkpoint and back", () => {
    const state = new AgentState({ model: "test-model", maxIterations: 10 });
    state.addMessage({ role: "user", content: "hello" });
    state.iteration = 3;
    state.output = "done";
    state.completed = true;
    state.metadata.set("key", "value");

    const checkpoint = state.toCheckpoint();
    const restored = AgentState.fromCheckpoint(checkpoint);

    expect(restored.model).toBe("test-model");
    expect(restored.maxIterations).toBe(10);
    expect(restored.messages).toHaveLength(1);
    expect(restored.iteration).toBe(3);
    expect(restored.output).toBe("done");
    expect(restored.completed).toBe(true);
    expect(restored.metadata.get("key")).toBe("value");
  });

  it("should detect abort signal", () => {
    const ac = new AbortController();
    const state = new AgentState({ model: "test", signal: ac.signal });
    expect(state.aborted).toBe(false);
    ac.abort();
    expect(state.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ToolCallingLoop tests
// ---------------------------------------------------------------------------

describe("ToolCallingLoop", () => {
  it("should handle text-only response (no tools)", async () => {
    const llm = createMockLLM([textResponse("Hello!")]);
    const reg = new ToolRegistry();
    const executor = new ToolExecutor(reg);
    const hooks = new HookRegistry();
    const loop = new ToolCallingLoop(llm, executor, hooks);

    const state = new AgentState({
      messages: [{ role: "user", content: "hi" }],
      model: "test",
    });

    await loop.step(state);

    expect(state.completed).toBe(true);
    expect(state.output).toBe("Hello!");
    expect(state.iteration).toBe(1);
    expect(state.metrics.llmCalls).toBe(1);
  });

  it("should execute tool calls and continue", async () => {
    const llm = createMockLLM([
      toolCallResponse("greet", { name: "Bob" }),
      textResponse("I greeted Bob!"),
    ]);

    const reg = new ToolRegistry();
    reg.register(makeTool("greet", (args) => `Hello, ${args["name"]}!`));
    const executor = new ToolExecutor(reg);
    const hooks = new HookRegistry();
    const loop = new ToolCallingLoop(llm, executor, hooks);

    const state = new AgentState({
      messages: [{ role: "user", content: "greet Bob" }],
      toolSchemas: reg.getSchemas(),
      model: "test",
    });

    // First step: tool call
    await loop.step(state);
    expect(state.completed).toBe(false);
    expect(state.iteration).toBe(1);
    expect(state.toolCallRecords).toHaveLength(1);
    expect(state.toolCallRecords[0]!.result).toBe("Hello, Bob!");

    // Second step: text response
    await loop.step(state);
    expect(state.completed).toBe(true);
    expect(state.output).toBe("I greeted Bob!");
    expect(state.iteration).toBe(2);
  });

  it("shouldContinue returns false when completed", () => {
    const llm = createMockLLM([]);
    const reg = new ToolRegistry();
    const loop = new ToolCallingLoop(llm, new ToolExecutor(reg), new HookRegistry());

    const state = new AgentState({ model: "test" });
    expect(loop.shouldContinue(state)).toBe(true);

    state.completed = true;
    expect(loop.shouldContinue(state)).toBe(false);
  });

  it("shouldContinue returns false at max iterations", () => {
    const llm = createMockLLM([]);
    const reg = new ToolRegistry();
    const loop = new ToolCallingLoop(llm, new ToolExecutor(reg), new HookRegistry());

    const state = new AgentState({ model: "test", maxIterations: 3 });
    state.iteration = 3;
    expect(loop.shouldContinue(state)).toBe(false);
  });

  it("should fire hooks during execution", async () => {
    const llm = createMockLLM([
      toolCallResponse("echo", { msg: "test" }),
      textResponse("done"),
    ]);

    const reg = new ToolRegistry();
    reg.register(makeTool("echo", (args) => String(args["msg"])));
    const hooks = new HookRegistry();
    const firedEvents: string[] = [];

    hooks.on(HookEvent.AGENT_ITERATION_BEFORE, () => { firedEvents.push("iter.before"); });
    hooks.on(HookEvent.AGENT_ITERATION_AFTER, () => { firedEvents.push("iter.after"); });
    hooks.on(HookEvent.LLM_CALL_BEFORE, () => { firedEvents.push("llm.before"); });
    hooks.on(HookEvent.LLM_CALL_AFTER, () => { firedEvents.push("llm.after"); });
    hooks.on(HookEvent.TOOL_CALL_BEFORE, () => { firedEvents.push("tool.before"); });
    hooks.on(HookEvent.TOOL_CALL_AFTER, () => { firedEvents.push("tool.after"); });

    const executor = new ToolExecutor(reg, { hookRegistry: hooks });
    const loop = new ToolCallingLoop(llm, executor, hooks);
    const state = new AgentState({
      messages: [{ role: "user", content: "echo" }],
      toolSchemas: reg.getSchemas(),
      model: "test",
    });

    await loop.step(state); // tool call
    await loop.step(state); // text response

    expect(firedEvents).toEqual([
      "iter.before", "llm.before", "llm.after", "tool.before", "tool.after", "iter.after",
      "iter.before", "llm.before", "llm.after", "iter.after",
    ]);
  });

  it("should allow hooks to cancel tool calls", async () => {
    const llm = createMockLLM([
      toolCallResponse("dangerous", {}),
      textResponse("ok"),
    ]);

    const reg = new ToolRegistry();
    reg.register(makeTool("dangerous", () => "should not run"));
    const hooks = new HookRegistry();

    hooks.on(HookEvent.TOOL_CALL_BEFORE, (ctx) => {
      if (ctx.data["tool"] === "dangerous") ctx.cancel();
    });

    const executor = new ToolExecutor(reg, { hookRegistry: hooks });
    const loop = new ToolCallingLoop(llm, executor, hooks);
    const state = new AgentState({
      messages: [{ role: "user", content: "do it" }],
      toolSchemas: reg.getSchemas(),
      model: "test",
    });

    await loop.step(state);

    // Tool was cancelled by hook
    expect(state.toolCallRecords[0]!.error).toBe("Tool call cancelled by hook");
  });
});

// ---------------------------------------------------------------------------
// Runtime tests
// ---------------------------------------------------------------------------

describe("Runtime", () => {
  it("should create state with system prompt and user message", () => {
    const hooks = new HookRegistry();
    const toolReg = new ToolRegistry();
    const llm = createMockLLM([textResponse("hi")]);
    const loop = new ToolCallingLoop(llm, new ToolExecutor(toolReg), hooks);

    const runtime = new Runtime({
      loop,
      hooks,
      toolRegistry: toolReg,
      model: "test-model",
      systemPrompt: "You are helpful.",
      maxIterations: 10,
      timeout: 0,
      agentId: "agent-1",
    });

    const state = runtime.createState("Hello");
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]!.role).toBe("system");
    expect(state.messages[0]!.content).toBe("You are helpful.");
    expect(state.messages[1]!.role).toBe("user");
    expect(state.messages[1]!.content).toBe("Hello");
    expect(state.model).toBe("test-model");
  });

  it("should support dynamic system prompt", () => {
    const hooks = new HookRegistry();
    const toolReg = new ToolRegistry();
    const llm = createMockLLM([]);
    const loop = new ToolCallingLoop(llm, new ToolExecutor(toolReg), hooks);

    let counter = 0;
    const runtime = new Runtime({
      loop,
      hooks,
      toolRegistry: toolReg,
      model: "test",
      systemPrompt: () => `Prompt #${++counter}`,
      maxIterations: 10,
      timeout: 0,
      agentId: "agent-1",
    });

    const state1 = runtime.createState("a");
    const state2 = runtime.createState("b");
    expect(state1.messages[0]!.content).toBe("Prompt #1");
    expect(state2.messages[0]!.content).toBe("Prompt #2");
  });

  it("should run to completion", async () => {
    const hooks = new HookRegistry();
    const toolReg = new ToolRegistry();
    const llm = createMockLLM([textResponse("Result!")]);
    const loop = new ToolCallingLoop(llm, new ToolExecutor(toolReg), hooks);

    const runtime = new Runtime({
      loop,
      hooks,
      toolRegistry: toolReg,
      model: "test",
      systemPrompt: "Be helpful.",
      maxIterations: 10,
      timeout: 0,
      agentId: "agent-1",
    });

    const state = runtime.createState("Hi");
    const result = await runtime.runWithState(state);

    expect(result.output).toBe("Result!");
    expect(result.iterations).toBe(1);
    expect(result.usage.totalTokens).toBe(15);
    expect(result.model).toBe("test");
  });

  it("should run with tool calls", async () => {
    const hooks = new HookRegistry();
    const toolReg = new ToolRegistry();
    toolReg.register(makeTool("add", (args) => String(Number(args["a"]) + Number(args["b"]))));

    const llm = createMockLLM([
      toolCallResponse("add", { a: 2, b: 3 }),
      textResponse("The sum is 5"),
    ]);
    const loop = new ToolCallingLoop(llm, new ToolExecutor(toolReg), hooks);

    const runtime = new Runtime({
      loop,
      hooks,
      toolRegistry: toolReg,
      model: "test",
      systemPrompt: "You can do math.",
      maxIterations: 10,
      timeout: 0,
      agentId: "agent-1",
    });

    const state = runtime.createState("What is 2+3?");
    const result = await runtime.runWithState(state);

    expect(result.output).toBe("The sum is 5");
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.toolName).toBe("add");
    expect(result.toolCalls[0]!.result).toBe("5");
  });

  it("should fire run lifecycle hooks", async () => {
    const hooks = new HookRegistry();
    const fired: string[] = [];

    hooks.on(HookEvent.AGENT_RUN_BEFORE, () => { fired.push("run.before"); });
    hooks.on(HookEvent.AGENT_RUN_AFTER, () => { fired.push("run.after"); });

    const toolReg = new ToolRegistry();
    const llm = createMockLLM([textResponse("ok")]);
    const loop = new ToolCallingLoop(llm, new ToolExecutor(toolReg), hooks);

    const runtime = new Runtime({
      loop,
      hooks,
      toolRegistry: toolReg,
      model: "test",
      systemPrompt: "",
      maxIterations: 10,
      timeout: 0,
      agentId: "agent-1",
    });

    await runtime.runWithState(runtime.createState("hi"));
    expect(fired).toEqual(["run.before", "run.after"]);
  });

  it("should fire error hook on failure", async () => {
    const hooks = new HookRegistry();
    const errors: unknown[] = [];
    hooks.on(HookEvent.AGENT_RUN_ERROR, (ctx) => { errors.push(ctx.data["error"]); });

    const failingLLM: ILLMClient = {
      async call() { throw new Error("LLM exploded"); },
      async *stream() { throw new Error("LLM exploded"); },
    };

    const toolReg = new ToolRegistry();
    const loop = new ToolCallingLoop(failingLLM, new ToolExecutor(toolReg), hooks);

    const runtime = new Runtime({
      loop,
      hooks,
      toolRegistry: toolReg,
      model: "test",
      systemPrompt: "",
      maxIterations: 10,
      timeout: 0,
      agentId: "agent-1",
    });

    await expect(runtime.runWithState(runtime.createState("hi"))).rejects.toThrow("LLM exploded");
    expect(errors).toHaveLength(1);
  });

  it("should stream events", async () => {
    const hooks = new HookRegistry();
    const toolReg = new ToolRegistry();
    const llm = createMockLLM([textResponse("Streamed!")]);
    const loop = new ToolCallingLoop(llm, new ToolExecutor(toolReg), hooks);

    const runtime = new Runtime({
      loop,
      hooks,
      toolRegistry: toolReg,
      model: "test",
      systemPrompt: "",
      maxIterations: 10,
      timeout: 0,
      agentId: "agent-1",
    });

    const events = [];
    for await (const event of runtime.streamWithState(runtime.createState("hi"))) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("iteration_start");
    expect(types).toContain("text_delta");
    expect(types).toContain("iteration_end");
    expect(types).toContain("done");

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent?.type === "done" && doneEvent.result.output).toBe("Streamed!");
  });

  it("should handle max iterations", async () => {
    // LLM always returns tool calls — should stop at max iterations
    const infiniteToolCalls: ILLMClient = {
      async call(): Promise<LLMResponse> {
        return toolCallResponse("noop", {});
      },
      async *stream() { yield { type: "done" as const, finishReason: "stop" as const }; },
    };

    const hooks = new HookRegistry();
    const toolReg = new ToolRegistry();
    toolReg.register(makeTool("noop", () => "ok"));
    const loop = new ToolCallingLoop(infiniteToolCalls, new ToolExecutor(toolReg), hooks);

    const runtime = new Runtime({
      loop,
      hooks,
      toolRegistry: toolReg,
      model: "test",
      systemPrompt: "",
      maxIterations: 3,
      timeout: 0,
      agentId: "agent-1",
    });

    const result = await runtime.runWithState(runtime.createState("loop"));
    expect(result.iterations).toBe(3);
    expect(result.output).toBe("[Max iterations reached]");
  });
});

// ---------------------------------------------------------------------------
// Agent tests (builder + integration)
// ---------------------------------------------------------------------------

describe("Agent", () => {
  it("should be constructed via builder", () => {
    const llm = createMockLLM([textResponse("hi")]);

    const agent = Agent.builder()
      .model("test-model")
      .systemPrompt("Be helpful.")
      .llmClient(llm)
      .agentName("test-agent")
      .maxIterations(20)
      .build();

    expect(agent.model).toBe("test-model");
    expect(agent.agentName).toBe("test-agent");
    expect(agent.closed).toBe(false);
  });

  it("should run a simple conversation", async () => {
    const llm = createMockLLM([textResponse("Hello, world!")]);

    const agent = Agent.builder()
      .model("test")
      .systemPrompt("You are helpful.")
      .llmClient(llm)
      .build();

    const result = await agent.run("Say hello");
    expect(result.output).toBe("Hello, world!");
    expect(result.iterations).toBe(1);
  });

  it("should run with tools", async () => {
    const llm = createMockLLM([
      toolCallResponse("upper", { text: "hello" }),
      textResponse("HELLO"),
    ]);

    const agent = Agent.builder()
      .model("test")
      .systemPrompt("")
      .llmClient(llm)
      .tool(makeTool("upper", (args) => String(args["text"]).toUpperCase()))
      .build();

    const result = await agent.run("Uppercase hello");
    expect(result.output).toBe("HELLO");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toBe("HELLO");
  });

  it("should stream events", async () => {
    const llm = createMockLLM([textResponse("Streamed output")]);

    const agent = Agent.builder()
      .model("test")
      .systemPrompt("")
      .llmClient(llm)
      .build();

    const events = [];
    for await (const event of agent.astream("hi")) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("should support hooks via builder", async () => {
    const llm = createMockLLM([textResponse("ok")]);
    const hookCalls: string[] = [];

    const agent = Agent.builder()
      .model("test")
      .systemPrompt("")
      .llmClient(llm)
      .hook(HookEvent.AGENT_RUN_BEFORE, () => { hookCalls.push("before"); })
      .hook(HookEvent.AGENT_RUN_AFTER, () => { hookCalls.push("after"); })
      .build();

    await agent.run("test");
    expect(hookCalls).toEqual(["before", "after"]);
  });

  it("should throw after close", async () => {
    const llm = createMockLLM([textResponse("ok")]);
    const agent = Agent.builder().model("test").systemPrompt("").llmClient(llm).build();

    await agent.close();
    expect(agent.closed).toBe(true);
    await expect(agent.run("test")).rejects.toThrow("closed");
  });

  it("should expose tools", () => {
    const llm = createMockLLM([]);
    const t = makeTool("myTool", () => "");

    const agent = Agent.builder()
      .model("test")
      .systemPrompt("")
      .llmClient(llm)
      .tools([t])
      .build();

    expect(agent.tools).toHaveLength(1);
    expect(agent.tools[0]!.name).toBe("myTool");
  });

  it("builder should throw without LLM client", () => {
    expect(() =>
      Agent.builder().model("test").systemPrompt("").build(),
    ).toThrow("LLM client is required");
  });

  it("should support metadata", () => {
    const llm = createMockLLM([]);
    const agent = Agent.builder()
      .model("test")
      .systemPrompt("")
      .llmClient(llm)
      .metadata("env", "test")
      .build();

    expect(agent.metadata["env"]).toBe("test");
  });
});
