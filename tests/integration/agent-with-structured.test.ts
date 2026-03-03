/**
 * Integration: Agent + Structured output
 *
 * Verifies that agents producing JSON/structured output work correctly.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";

describe("agent with structured output", () => {
  it("should return JSON structured output", async () => {
    const expected = { name: "Alice", age: 30, city: "NYC" };
    const llm = new MockLLM();
    llm.addTextResponse(JSON.stringify(expected));

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Always respond in JSON.")
      .llmClient(llm)
      .build();

    const result = await agent.run("Tell me about Alice.");
    const parsed = JSON.parse(result.output);
    expect(parsed).toEqual(expected);
  });

  it("should handle nested structured output", async () => {
    const data = {
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      total: 2,
    };
    const llm = new MockLLM();
    llm.addTextResponse(JSON.stringify(data));

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Return JSON arrays.")
      .llmClient(llm)
      .build();

    const result = await agent.run("List users.");
    const parsed = JSON.parse(result.output);
    expect(parsed.users).toHaveLength(2);
    expect(parsed.total).toBe(2);
  });

  it("should work when tool calls produce structured data", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "10/3" });
    llm.addTextResponse(JSON.stringify({ result: 3.333, rounded: 3 }));

    const { calculatorTool } = await import("../fixtures/tools.js");
    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Return JSON.")
      .llmClient(llm)
      .tool(calculatorTool)
      .build();

    const result = await agent.run("Divide 10 by 3.");
    const parsed = JSON.parse(result.output);
    expect(parsed.result).toBeCloseTo(3.333, 2);
  });

  it("should handle empty/minimal structured output", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("{}");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Return JSON.")
      .llmClient(llm)
      .build();

    const result = await agent.run("Empty.");
    expect(JSON.parse(result.output)).toEqual({});
  });
});
