/**
 * E2E: Coding agent with file read/write and code execution
 *
 * Validates a coding-like agent workflow using fake file and code tools.
 * All file operations use in-memory fakes — no actual filesystem access.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { fakeFileReadTool, fakeFileWriteTool, codeExecuteTool } from "../fixtures/tools.js";

describe("E2E: coding agent", () => {
  it("should read a file, process it, and write output", async () => {
    const written = new Map<string, string>();
    const readTool = fakeFileReadTool({
      "src/hello.ts": 'export function hello() { return "hello world"; }',
    });
    const writeTool = fakeFileWriteTool(written);

    const llm = new MockLLM();
    // Step 1: Read the file
    llm.addToolCallResponse("read_file", { path: "src/hello.ts" });
    // Step 2: Write the modified file
    llm.addToolCallResponse("write_file", {
      path: "src/hello.ts",
      content: 'export function hello() { return "Hello, World!"; }',
    });
    llm.addTextResponse("I've updated the hello function to capitalize the greeting.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are a coding assistant. Read files, modify them, and write back.")
      .llmClient(llm)
      .tools([readTool, writeTool])
      .maxIterations(10)
      .build();

    const result = await agent.run("Update hello.ts to capitalize the greeting.");

    expect(result.output).toContain("updated");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolName).toBe("read_file");
    expect(result.toolCalls[1].toolName).toBe("write_file");
    expect(written.get("src/hello.ts")).toContain("Hello, World!");
  });

  it("should execute code and report results", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("execute_code", {
      language: "python",
      code: "print(2 + 2)",
    });
    llm.addTextResponse("The code ran successfully and printed 4.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You can execute code.")
      .llmClient(llm)
      .tool(codeExecuteTool)
      .maxIterations(5)
      .build();

    const result = await agent.run("Run a Python script that prints 2+2.");

    expect(result.output).toContain("4");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe("execute_code");
  });

  it("should handle file not found gracefully", async () => {
    const readTool = fakeFileReadTool({});

    const llm = new MockLLM();
    llm.addToolCallResponse("read_file", { path: "nonexistent.ts" });
    llm.addTextResponse("The file was not found. Please check the path.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Handle errors.")
      .llmClient(llm)
      .tool(readTool)
      .maxIterations(5)
      .build();

    const result = await agent.run("Read nonexistent.ts.");

    expect(result.output).toContain("not found");
    expect(result.toolCalls[0].result).toContain("not found");
  });

  it("should do a multi-step coding workflow: read, execute, write", async () => {
    const written = new Map<string, string>();
    const readTool = fakeFileReadTool({
      "data.json": '{"count": 5}',
    });
    const writeTool = fakeFileWriteTool(written);

    const llm = new MockLLM();
    // Read
    llm.addToolCallResponse("read_file", { path: "data.json" });
    // Execute code
    llm.addToolCallResponse("execute_code", {
      language: "javascript",
      code: "JSON.parse('{\"count\":5}').count * 2",
    });
    // Write result
    llm.addToolCallResponse("write_file", {
      path: "result.json",
      content: '{"count": 10}',
    });
    llm.addTextResponse("Done. Read data.json, doubled the count, wrote result.json.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are a coding agent.")
      .llmClient(llm)
      .tools([readTool, writeTool, codeExecuteTool])
      .maxIterations(10)
      .build();

    const result = await agent.run("Read data.json, double the count, save to result.json.");

    expect(result.toolCalls).toHaveLength(3);
    expect(written.has("result.json")).toBe(true);
    expect(written.get("result.json")).toContain("10");
  });
});
