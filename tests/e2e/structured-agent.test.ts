/**
 * E2E: Structured output agent
 *
 * Validates agents that produce structured (JSON) output as their final result.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { calculatorTool } from "../fixtures/tools.js";

describe("E2E: structured output agent", () => {
  it("should produce valid JSON output for a data extraction task", async () => {
    const expected = {
      name: "Alice Johnson",
      age: 28,
      email: "alice@example.com",
      skills: ["TypeScript", "Python", "Rust"],
    };

    const llm = new MockLLM();
    llm.addTextResponse(JSON.stringify(expected));

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Extract structured data. Always respond with valid JSON.")
      .llmClient(llm)
      .build();

    const result = await agent.run("Extract info about Alice Johnson, age 28, email alice@example.com, skilled in TypeScript, Python, and Rust.");

    const parsed = JSON.parse(result.output);
    expect(parsed.name).toBe("Alice Johnson");
    expect(parsed.age).toBe(28);
    expect(parsed.skills).toContain("TypeScript");
    expect(parsed.skills).toHaveLength(3);
  });

  it("should produce structured output after tool usage", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "365 * 24" });
    llm.addTextResponse(
      JSON.stringify({
        calculation: "365 * 24",
        result: 8760,
        unit: "hours",
        description: "Hours in a year",
      }),
    );

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Use tools then respond with structured JSON.")
      .llmClient(llm)
      .tool(calculatorTool)
      .maxIterations(5)
      .build();

    const result = await agent.run("How many hours in a year? Give me structured JSON.");

    const parsed = JSON.parse(result.output);
    expect(parsed.result).toBe(8760);
    expect(parsed.unit).toBe("hours");
    expect(result.toolCalls).toHaveLength(1);
  });

  it("should handle array-type structured output", async () => {
    const items = [
      { id: 1, name: "Item A", price: 9.99 },
      { id: 2, name: "Item B", price: 19.99 },
      { id: 3, name: "Item C", price: 29.99 },
    ];

    const llm = new MockLLM();
    llm.addTextResponse(JSON.stringify(items));

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Return JSON arrays.")
      .llmClient(llm)
      .build();

    const result = await agent.run("List 3 items with prices.");
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].name).toBe("Item A");
  });

  it("should handle nested structured output", async () => {
    const nested = {
      company: "Acme Corp",
      departments: [
        {
          name: "Engineering",
          headcount: 50,
          teams: ["Frontend", "Backend", "Infrastructure"],
        },
        {
          name: "Product",
          headcount: 15,
          teams: ["Design", "PM"],
        },
      ],
      totalEmployees: 65,
    };

    const llm = new MockLLM();
    llm.addTextResponse(JSON.stringify(nested));

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Return nested JSON.")
      .llmClient(llm)
      .build();

    const result = await agent.run("Describe Acme Corp's structure.");
    const parsed = JSON.parse(result.output);
    expect(parsed.company).toBe("Acme Corp");
    expect(parsed.departments).toHaveLength(2);
    expect(parsed.departments[0].teams).toContain("Frontend");
    expect(parsed.totalEmployees).toBe(65);
  });
});
