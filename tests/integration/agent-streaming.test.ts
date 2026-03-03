/**
 * Integration: Agent streaming
 *
 * Verifies that agent.astream() produces the correct sequence of StreamEvents.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import type { StreamEvent } from "../../src/models/events.js";
import { calculatorTool } from "../fixtures/tools.js";

async function collectEvents(agent: Agent, input: string): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of agent.astream(input)) {
    events.push(event);
  }
  return events;
}

describe("agent streaming", () => {
  it("should emit text_delta and done events for text responses", async () => {
    const llm = new MockLLM();
    llm.addStreamResponse(["Hello", " world", "!"]);

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .build();

    const events = await collectEvents(agent, "Hi.");
    const textDeltas = events.filter((e) => e.type === "text_delta");
    const doneEvents = events.filter((e) => e.type === "done");

    expect(textDeltas.length).toBeGreaterThanOrEqual(1);
    expect(doneEvents).toHaveLength(1);

    if (doneEvents[0].type === "done") {
      expect(doneEvents[0].result.output).toBeTruthy();
    }
  });

  it("should emit tool_call events during streaming", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "2+2" });
    llm.addStreamResponse(["The answer is 4."]);

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tool(calculatorTool)
      .build();

    const events = await collectEvents(agent, "What is 2+2?");
    const toolStarts = events.filter((e) => e.type === "tool_call_start");
    const toolEnds = events.filter((e) => e.type === "tool_call_end");

    expect(toolStarts.length).toBeGreaterThanOrEqual(1);
    expect(toolEnds.length).toBeGreaterThanOrEqual(1);
  });

  it("should emit iteration events", async () => {
    const llm = new MockLLM();
    llm.addStreamResponse(["Done."]);

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .build();

    const events = await collectEvents(agent, "Test.");
    const iterStarts = events.filter((e) => e.type === "iteration_start");
    const iterEnds = events.filter((e) => e.type === "iteration_end");

    expect(iterStarts.length).toBeGreaterThanOrEqual(1);
    expect(iterEnds.length).toBeGreaterThanOrEqual(1);
  });

  it("should include complete result in the done event", async () => {
    const llm = new MockLLM();
    llm.addStreamResponse(["Final answer."]);

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .build();

    const events = await collectEvents(agent, "Answer.");
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.result.runId).toBeTruthy();
      expect(done.result.duration).toBeGreaterThanOrEqual(0);
      expect(done.result.model).toBe("mock-model");
    }
  });
});
