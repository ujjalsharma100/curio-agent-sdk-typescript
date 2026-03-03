/**
 * E2E: Tool-using agent workflow
 *
 * Validates an agent that uses tools to answer user questions.
 * Treats each test as a user workflow with deterministic MockLLM responses.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { calculatorTool, searchTool, formatterTool, echoTool } from "../fixtures/tools.js";

describe("E2E: tool agent", () => {
  it("should use a single tool to answer a question", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "15 * 4" });
    llm.addTextResponse("15 multiplied by 4 equals 60.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You can use tools to help answer questions.")
      .llmClient(llm)
      .tools([calculatorTool, searchTool])
      .maxIterations(10)
      .build();

    const result = await agent.run("What is 15 times 4?");

    expect(result.output).toContain("60");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe("calculator");
    expect(result.toolCalls[0].result).toContain("60");
  });

  it("should use multiple tools in sequence", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("search", { query: "capital of France" });
    llm.addToolCallResponse("formatter", { text: "paris", style: "title" });
    llm.addTextResponse("The capital of France is Paris.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Use tools as needed.")
      .llmClient(llm)
      .tools([searchTool, formatterTool])
      .maxIterations(10)
      .build();

    const result = await agent.run("What is the capital of France? Format it nicely.");

    expect(result.output).toContain("Paris");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolName).toBe("search");
    expect(result.toolCalls[1].toolName).toBe("formatter");
  });

  it("should handle tool that returns results used in final answer", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("echo", { text: "Hello, World!" });
    llm.addTextResponse("The tool echoed: Hello, World!");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Use the echo tool.")
      .llmClient(llm)
      .tool(echoTool)
      .maxIterations(5)
      .build();

    const result = await agent.run("Echo 'Hello, World!'");

    expect(result.output).toContain("Hello, World!");
    expect(result.toolCalls[0].result).toBe("Hello, World!");
  });

  it("should recover from tool errors and provide a meaningful response", async () => {
    const { failingTool } = await import("../fixtures/tools.js");
    const llm = new MockLLM();
    llm.addToolCallResponse("failing_tool", { input: "test" });
    llm.addTextResponse("I encountered an error with that tool, but I can still help.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Handle errors gracefully.")
      .llmClient(llm)
      .tool(failingTool)
      .maxIterations(5)
      .build();

    const result = await agent.run("Use the failing tool.");

    expect(result.output).toBeTruthy();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toBeDefined();
  });
});
