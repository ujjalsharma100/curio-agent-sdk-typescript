/**
 * Integration: Agent + Middleware pipeline
 *
 * Verifies that middleware intercepts LLM and tool calls when attached to an agent.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import type { Middleware } from "../../src/middleware/base.js";
import type { LLMRequest, LLMResponse } from "../../src/models/llm.js";
import { calculatorTool } from "../fixtures/tools.js";

/** Simple counting middleware for testing. */
class CountingMiddleware implements Middleware {
  readonly name = "counting";
  llmBefore = 0;
  llmAfter = 0;
  toolBefore = 0;
  toolAfter = 0;

  async beforeLLMCall(request: LLMRequest): Promise<LLMRequest> {
    this.llmBefore++;
    return request;
  }

  async afterLLMCall(_req: LLMRequest, response: LLMResponse): Promise<LLMResponse> {
    this.llmAfter++;
    return response;
  }

  async beforeToolCall(toolName: string, args: Record<string, unknown>) {
    this.toolBefore++;
    return { toolName, args };
  }

  async afterToolCall(_toolName: string, _args: Record<string, unknown>, result: string) {
    this.toolAfter++;
    return result;
  }
}

describe("agent with middleware", () => {
  it("should run middleware on LLM calls", async () => {
    const counter = new CountingMiddleware();
    const llm = new MockLLM();
    llm.addTextResponse("Hi.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([counter])
      .build();

    await agent.run("Hello.");

    expect(counter.llmBefore).toBeGreaterThanOrEqual(1);
    expect(counter.llmAfter).toBeGreaterThanOrEqual(1);
  });

  it("should run middleware on tool calls", async () => {
    const counter = new CountingMiddleware();
    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "1+1" });
    llm.addTextResponse("2.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .tool(calculatorTool)
      .middleware([counter])
      .build();

    await agent.run("Compute 1+1.");

    expect(counter.toolBefore).toBeGreaterThanOrEqual(1);
    expect(counter.toolAfter).toBeGreaterThanOrEqual(1);
  });

  it("should chain multiple middleware in order", async () => {
    const order: string[] = [];

    const mw1: Middleware = {
      name: "first",
      async beforeLLMCall(req) {
        order.push("first-before");
        return req;
      },
      async afterLLMCall(_req, res) {
        order.push("first-after");
        return res;
      },
    };
    const mw2: Middleware = {
      name: "second",
      async beforeLLMCall(req) {
        order.push("second-before");
        return req;
      },
      async afterLLMCall(_req, res) {
        order.push("second-after");
        return res;
      },
    };

    const llm = new MockLLM();
    llm.addTextResponse("Done.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([mw1, mw2])
      .build();

    await agent.run("Test.");

    expect(order).toEqual(["first-before", "second-before", "first-after", "second-after"]);
  });

  it("should handle middleware errors by propagating them", async () => {
    const failingMw: Middleware = {
      name: "failing",
      async beforeLLMCall() {
        throw new Error("Middleware boom");
      },
    };

    const llm = new MockLLM();
    llm.addTextResponse("Won't reach.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([failingMw])
      .build();

    await expect(agent.run("Test.")).rejects.toThrow("Middleware boom");
  });
});
