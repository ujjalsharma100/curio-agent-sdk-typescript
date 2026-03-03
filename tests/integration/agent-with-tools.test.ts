/**
 * Integration: Agent + Tool system
 *
 * Verifies that the agent correctly dispatches tool calls, collects results,
 * and feeds them back to the LLM for a final answer.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { calculatorTool, searchTool, failingTool } from "../fixtures/tools.js";

function buildAgent(llm: MockLLM, tools = [calculatorTool, searchTool]) {
  return Agent.builder()
    .model("mock-model")
    .systemPrompt("You are a helpful assistant with tools.")
    .llmClient(llm)
    .tools(tools)
    .maxIterations(10)
    .build();
}

describe("agent with tools", () => {
  it("should call a tool and return the final answer", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "2 + 2" });
    llm.addTextResponse("The answer is 4.");

    const agent = buildAgent(llm);
    const result = await agent.run("What is 2+2?");

    expect(result.output).toBe("The answer is 4.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe("calculator");
    expect(result.iterations).toBeGreaterThanOrEqual(1);
  });

  it("should handle multiple sequential tool calls", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "10 * 5" });
    llm.addToolCallResponse("search", { query: "population of Earth" });
    llm.addTextResponse("50 and ~8 billion.");

    const agent = buildAgent(llm);
    const result = await agent.run("Calculate 10*5 and search population.");

    expect(result.output).toBe("50 and ~8 billion.");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolName).toBe("calculator");
    expect(result.toolCalls[1].toolName).toBe("search");
  });

  it("should handle tool execution errors gracefully", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("failing_tool", { input: "test" });
    llm.addTextResponse("Sorry, the tool failed.");

    const agent = buildAgent(llm, [failingTool]);
    const result = await agent.run("Use the failing tool.");

    expect(result.output).toBe("Sorry, the tool failed.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toBeDefined();
  });

  it("should track token usage across tool-calling iterations", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "1 + 1" });
    llm.addTextResponse("Done.");

    const agent = buildAgent(llm);
    const result = await agent.run("Compute 1+1.");

    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
  });

  it("should respect maxIterations limit", async () => {
    const llm = new MockLLM();
    // Queue many tool calls but set maxIterations low
    for (let i = 0; i < 20; i++) {
      llm.addToolCallResponse("calculator", { expression: `${i}+1` });
    }

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tools([calculatorTool])
      .maxIterations(3)
      .build();

    const result = await agent.run("Keep calculating.");
    expect(result.iterations).toBeLessThanOrEqual(3);
  });
});
