/**
 * E2E: Resilient agent with fallback behavior
 *
 * Validates that the agent handles errors gracefully:
 * tool failures, max iterations, middleware errors, and recovery patterns.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import type { Middleware } from "../../src/middleware/base.js";
import { failingTool, calculatorTool } from "../fixtures/tools.js";

describe("E2E: resilient agent", () => {
  it("should recover from tool failure and provide a text answer", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("failing_tool", { input: "test" });
    llm.addTextResponse("The tool failed, but I can still answer: the result is 42.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("If tools fail, provide the best answer you can.")
      .llmClient(llm)
      .tool(failingTool)
      .maxIterations(5)
      .build();

    const result = await agent.run("Get me the answer.");

    expect(result.output).toContain("42");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toBeDefined();
  });

  it("should stop at max iterations and still return a result", async () => {
    const llm = new MockLLM();
    // Keep returning tool calls to exhaust iterations
    for (let i = 0; i < 10; i++) {
      llm.addToolCallResponse("calculator", { expression: `${i}+1` });
    }

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Keep calculating.")
      .llmClient(llm)
      .tool(calculatorTool)
      .maxIterations(3)
      .build();

    const result = await agent.run("Calculate forever.");

    // Should stop at max iterations
    expect(result.iterations).toBeLessThanOrEqual(3);
    // Should still have a result (even if truncated)
    expect(result).toBeDefined();
    expect(result.toolCalls.length).toBeGreaterThan(0);
  });

  it("should handle middleware that suppresses errors", async () => {
    const suppressMw: Middleware = {
      name: "suppressor",
      async onError(_error, _ctx) {
        return null; // suppress the error
      },
    };

    const llm = new MockLLM();
    llm.addTextResponse("Recovered.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([suppressMw])
      .build();

    // Should not throw even if there were internal errors
    const result = await agent.run("Test.");
    expect(result.output).toBeTruthy();
  });

  it("should produce valid run results even with minimal interaction", async () => {
    const llm = new MockLLM();
    // Default response when queue is empty
    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Be brief.")
      .llmClient(llm)
      .maxIterations(1)
      .build();

    const result = await agent.run("Hi.");

    // Even with default "I'm done." response, result should be valid
    expect(result.output).toBeTruthy();
    expect(result.runId).toBeTruthy();
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe("mock-model");
    expect(result.usage).toBeDefined();
  });

  it("should handle agent close/reopen pattern", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Response 1.");
    llm.addTextResponse("Response 2.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .build();

    // First run
    const r1 = await agent.run("First.");
    expect(r1.output).toBe("Response 1.");

    // Close
    await agent.close();
    expect(agent.closed).toBe(true);

    // Should reject after close
    await expect(agent.run("After close.")).rejects.toThrow("closed");
  });
});
