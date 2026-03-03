import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent, Tool } from "../../src/index.js";
import type { ILLMClient, LLMRequest, LLMResponse, LLMStreamChunk } from "../../src/index.js";
import {
  MockLLM,
  AgentTestHarness,
  ToolTestKit,
  RecordingMiddleware,
  ReplayLLMClient,
  EvalDataset,
  AgentEvalSuite,
  containsMatch,
  RegressionDetector,
  SnapshotTester,
  SnapshotMismatchError,
} from "../../src/testing/index.js";

function textResponse(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "test-model",
    finishReason: "stop",
  };
}

function createTool(name: string, run: (args: Record<string, unknown>) => string): Tool {
  return new Tool({
    name,
    description: name,
    schema: { name, description: name, parameters: { type: "object", properties: {} } },
    execute: run,
  });
}

describe("testing utilities", () => {
  it("MockLLM can queue text/tool/stream responses", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("hello");
    llm.addToolCallResponse("greet", { name: "alice" });
    llm.addStreamResponse(["a", "b", "c"]);

    const first = await llm.call({ messages: [], model: "mock-model" });
    expect(first.content).toBe("hello");

    const second = await llm.call({ messages: [], model: "mock-model" });
    expect(second.toolCalls[0]?.name).toBe("greet");

    const chunks: string[] = [];
    for await (const chunk of llm.stream({ messages: [], model: "mock-model" })) {
      if (chunk.type === "text_delta") chunks.push(chunk.text);
    }
    expect(chunks.join("")).toBe("abc");
    expect(llm.getCallHistory()).toHaveLength(3);
  });

  it("AgentTestHarness tracks tool calls and output assertions", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("echo", { text: "hello" });
    llm.addTextResponse("done");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tool(createTool("echo", (args) => String(args["text"])))
      .build();

    const harness = new AgentTestHarness(agent);
    const result = await harness.run("say hello");
    expect(result.output).toBe("done");
    harness.assertToolCalled("echo", { text: "hello" });
    harness.assertToolNotCalled("missing");
    harness.assertOutputContains("done");
  });

  it("ToolTestKit supports mock return and call order", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("first", {});
    llm.addToolCallResponse("second", {});
    llm.addTextResponse("ok");

    const kit = new ToolTestKit();
    kit.mockTool("first", { returns: "one" });
    kit.mockTool("second", { returns: "two" });

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tools([createTool("first", () => "real-one"), createTool("second", () => "real-two")])
      .build();

    kit.attach(agent);
    const result = await agent.run("go");
    expect(result.output).toBe("ok");
    kit.assertCallOrder(["first", "second"]);
    expect(kit.getCalls("first")[0]?.result).toBe("one");
  });

  it("RecordingMiddleware + ReplayLLMClient records and replays", async () => {
    const recorder = new RecordingMiddleware();
    const req: LLMRequest = { messages: [{ role: "user", content: "hi" }], model: "mock-model" };
    const resp = textResponse("hello");
    await recorder.afterLLMCall(req, resp);
    await recorder.afterToolCall("echo", { text: "a" }, "a");

    const replay = ReplayLLMClient.fromRecording(recorder.recording);
    const replayed = await replay.call(req);
    expect(replayed.content).toBe("hello");
    await expect(replay.call(req)).rejects.toThrow("exhausted");
  });

  it("Eval suite and regression detector compare results", async () => {
    const agentA = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(new StaticLLM("answer alpha"))
      .build();
    const agentB = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(new StaticLLM("wrong"))
      .build();

    const dataset = new EvalDataset([{ input: "q", expectedOutput: "answer", expectedToolCalls: [] }]);
    const suite = new AgentEvalSuite({ metrics: [containsMatch], passThreshold: 0.9 });
    const baseline = await suite.run(agentA, dataset);
    const candidate = await suite.run(agentB, dataset);
    const detector = new RegressionDetector(0.01);
    const report = await detector.compare({ baseline, candidate });

    expect(report.passed).toBe(false);
    expect(report.candidatePassRate).toBeLessThan(report.baselinePassRate);
  });

  it("SnapshotTester writes and validates snapshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curio-snap-"));
    try {
      const tester = new SnapshotTester({ snapshotDir: dir });
      await tester.assertSnapshot("case-1", "hello");
      await tester.assertSnapshot("case-1", "hello");
      await expect(tester.assertSnapshot("case-1", "different")).rejects.toBeInstanceOf(
        SnapshotMismatchError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

class StaticLLM implements ILLMClient {
  constructor(private readonly output: string) {}

  async call(_request: LLMRequest): Promise<LLMResponse> {
    return textResponse(this.output);
  }

  async *stream(_request: LLMRequest): AsyncIterableIterator<LLMStreamChunk> {
    yield { type: "text_delta", text: this.output };
    yield { type: "done", finishReason: "stop" };
  }
}

