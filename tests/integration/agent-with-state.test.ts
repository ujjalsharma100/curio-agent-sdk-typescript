/**
 * Integration: Agent + State management
 *
 * Verifies state tracking, iteration counts, and run metadata.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { calculatorTool } from "../fixtures/tools.js";

describe("agent with state", () => {
  it("should track iteration count in run result", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "1+1" });
    llm.addTextResponse("2");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tool(calculatorTool)
      .maxIterations(10)
      .build();

    const result = await agent.run("Calculate 1+1.");
    expect(result.iterations).toBeGreaterThanOrEqual(2);
  });

  it("should include runId and duration in results", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Done.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .build();

    const result = await agent.run("Hello.");
    expect(result.runId).toBeTruthy();
    expect(typeof result.runId).toBe("string");
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe("mock-model");
  });

  it("should track tool call records with details", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "5*5" });
    llm.addTextResponse("25.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tool(calculatorTool)
      .build();

    const result = await agent.run("5 times 5?");
    expect(result.toolCalls).toHaveLength(1);
    const tc = result.toolCalls[0];
    expect(tc.toolName).toBe("calculator");
    expect(tc.arguments).toEqual({ expression: "5*5" });
    expect(tc.result).toBeTruthy();
    expect(tc.duration).toBeGreaterThanOrEqual(0);
  });

  it("should prevent runs on a closed agent", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Hi.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .build();

    await agent.close();
    await expect(agent.run("Hello")).rejects.toThrow("closed");
  });
});
