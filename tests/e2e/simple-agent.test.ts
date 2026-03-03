/**
 * E2E: Simple agent workflow
 *
 * Validates the most basic agent use case: single prompt → single response.
 * Treats the test like a user workflow, validating the full AgentRunResult contract.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";

describe("E2E: simple agent", () => {
  it("should complete a single-turn conversation", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Hello! I'm your helpful assistant.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are a friendly assistant.")
      .llmClient(llm)
      .build();

    const result = await agent.run("Hello!");

    // Validate full AgentRunResult contract
    expect(result.output).toBe("Hello! I'm your helpful assistant.");
    expect(result.messages.length).toBeGreaterThanOrEqual(2); // system + user + assistant
    expect(result.toolCalls).toHaveLength(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.iterations).toBeGreaterThanOrEqual(1);
    expect(result.runId).toBeTruthy();
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe("mock-model");
  });

  it("should handle empty input gracefully", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("I received an empty message.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are helpful.")
      .llmClient(llm)
      .build();

    const result = await agent.run("");
    expect(result.output).toBeTruthy();
  });

  it("should handle long input text", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("I processed your long message.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are helpful.")
      .llmClient(llm)
      .build();

    const longInput = "A".repeat(10000);
    const result = await agent.run(longInput);
    expect(result.output).toBeTruthy();
  });

  it("should run multiple independent conversations on the same agent", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("First reply.");
    llm.addTextResponse("Second reply.");
    llm.addTextResponse("Third reply.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are helpful.")
      .llmClient(llm)
      .build();

    const r1 = await agent.run("First.");
    const r2 = await agent.run("Second.");
    const r3 = await agent.run("Third.");

    expect(r1.output).toBe("First reply.");
    expect(r2.output).toBe("Second reply.");
    expect(r3.output).toBe("Third reply.");

    // Each run should have a unique runId
    expect(new Set([r1.runId, r2.runId, r3.runId]).size).toBe(3);
  });
});
