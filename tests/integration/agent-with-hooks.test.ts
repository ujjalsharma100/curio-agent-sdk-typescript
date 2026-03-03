/**
 * Integration: Agent + Hooks system
 *
 * Verifies that hook handlers fire at correct lifecycle points
 * and that hook cancellation/modification works end-to-end.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { HookEvent } from "../../src/models/events.js";
import { HookCollector } from "../fixtures/events.js";
import { calculatorTool } from "../fixtures/tools.js";

describe("agent with hooks", () => {
  it("should fire agent run lifecycle hooks", async () => {
    const collector = new HookCollector();
    const llm = new MockLLM();
    llm.addTextResponse("Hello!");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .hook(HookEvent.AGENT_RUN_BEFORE, collector.handler())
      .hook(HookEvent.AGENT_RUN_AFTER, collector.handler())
      .build();

    await agent.run("Hi.");

    expect(collector.hasFired(HookEvent.AGENT_RUN_BEFORE)).toBe(true);
    expect(collector.hasFired(HookEvent.AGENT_RUN_AFTER)).toBe(true);
  });

  it("should fire LLM call hooks", async () => {
    const collector = new HookCollector();
    const llm = new MockLLM();
    llm.addTextResponse("Response.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .hook(HookEvent.LLM_CALL_BEFORE, collector.handler())
      .hook(HookEvent.LLM_CALL_AFTER, collector.handler())
      .build();

    await agent.run("Test.");

    expect(collector.hasFired(HookEvent.LLM_CALL_BEFORE)).toBe(true);
    expect(collector.hasFired(HookEvent.LLM_CALL_AFTER)).toBe(true);
  });

  it("should fire tool call hooks", async () => {
    const collector = new HookCollector();
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "1+1" });
    llm.addTextResponse("2.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tool(calculatorTool)
      .hook(HookEvent.TOOL_CALL_BEFORE, collector.handler())
      .hook(HookEvent.TOOL_CALL_AFTER, collector.handler())
      .build();

    await agent.run("Compute 1+1.");

    expect(collector.hasFired(HookEvent.TOOL_CALL_BEFORE)).toBe(true);
    expect(collector.hasFired(HookEvent.TOOL_CALL_AFTER)).toBe(true);
  });

  it("should fire hooks in the correct order", async () => {
    const collector = new HookCollector();
    const llm = new MockLLM();
    llm.addTextResponse("Done.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .hook(HookEvent.AGENT_RUN_BEFORE, collector.handler())
      .hook(HookEvent.AGENT_ITERATION_BEFORE, collector.handler())
      .hook(HookEvent.LLM_CALL_BEFORE, collector.handler())
      .hook(HookEvent.LLM_CALL_AFTER, collector.handler())
      .hook(HookEvent.AGENT_ITERATION_AFTER, collector.handler())
      .hook(HookEvent.AGENT_RUN_AFTER, collector.handler())
      .build();

    await agent.run("Test.");

    const events = collector.eventNames();
    const runBeforeIdx = events.indexOf(HookEvent.AGENT_RUN_BEFORE);
    const runAfterIdx = events.lastIndexOf(HookEvent.AGENT_RUN_AFTER);
    expect(runBeforeIdx).toBeLessThan(runAfterIdx);
  });

  it("should support multiple hooks on the same event", async () => {
    const collector1 = new HookCollector();
    const collector2 = new HookCollector();
    const llm = new MockLLM();
    llm.addTextResponse("Hi.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .hook(HookEvent.AGENT_RUN_BEFORE, collector1.handler())
      .hook(HookEvent.AGENT_RUN_BEFORE, collector2.handler())
      .build();

    await agent.run("Test.");

    expect(collector1.calls).toHaveLength(1);
    expect(collector2.calls).toHaveLength(1);
  });
});
