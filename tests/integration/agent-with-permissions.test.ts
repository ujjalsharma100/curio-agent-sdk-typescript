/**
 * Integration: Agent + Permission policies
 *
 * Verifies that permission policies gate tool execution correctly.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { AllowAll, AllowReadsAskWrites } from "../../src/core/security/permissions.js";
import type { PermissionPolicy, PermissionResult, PermissionContext } from "../../src/core/security/permissions.js";
import { calculatorTool, searchTool } from "../fixtures/tools.js";

describe("agent with permissions", () => {
  it("should allow tool calls with AllowAll policy", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "3+3" });
    llm.addTextResponse("6.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tool(calculatorTool)
      .permissions(new AllowAll())
      .maxIterations(5)
      .build();

    const result = await agent.run("3+3?");
    expect(result.output).toBe("6.");
    expect(result.toolCalls).toHaveLength(1);
  });

  it("should deny tool calls with a blocking policy", async () => {
    const denyAll: PermissionPolicy = {
      async checkToolCall(): Promise<PermissionResult> {
        return { allowed: false, reason: "Denied by policy" };
      },
    };

    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "1+1" });
    llm.addTextResponse("Tool was denied.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tool(calculatorTool)
      .permissions(denyAll)
      .maxIterations(5)
      .build();

    const result = await agent.run("Calculate 1+1.");
    // Tool should have been denied; the agent should recover with a text response
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toBeDefined();
  });

  it("should flag write-like tools for confirmation with AllowReadsAskWrites", async () => {
    const policy = new AllowReadsAskWrites();
    // "search" is a read-like tool
    const readResult = await policy.checkToolCall("search", {}, {});
    expect(readResult.allowed).toBe(true);
    expect(readResult.requireConfirmation).toBeFalsy();

    // "write" is a write-like tool (word boundary match)
    const writeResult = await policy.checkToolCall("write", {}, {});
    expect(writeResult.allowed).toBe(true);
    expect(writeResult.requireConfirmation).toBe(true);
  });

  it("should work with a selective policy allowing only specific tools", async () => {
    const selectivePolicy: PermissionPolicy = {
      async checkToolCall(
        toolName: string,
        _args: Record<string, unknown>,
        _ctx: PermissionContext,
      ): Promise<PermissionResult> {
        if (toolName === "calculator") return { allowed: true };
        return { allowed: false, reason: `Tool ${toolName} not allowed` };
      },
    };

    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "2*2" });
    llm.addTextResponse("4.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tools([calculatorTool, searchTool])
      .permissions(selectivePolicy)
      .maxIterations(5)
      .build();

    const result = await agent.run("What is 2*2?");
    expect(result.output).toBe("4.");
  });
});
