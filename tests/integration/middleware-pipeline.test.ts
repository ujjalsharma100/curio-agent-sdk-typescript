/**
 * Integration: Middleware pipeline ordering and composition
 *
 * Verifies that the MiddlewarePipeline composes multiple middleware correctly
 * for both LLM and tool call interception.
 */
import { describe, it, expect } from "vitest";
import { MiddlewarePipeline, type Middleware } from "../../src/middleware/base.js";
import type { LLMRequest, LLMResponse } from "../../src/models/llm.js";

function fakeRequest(model = "mock"): LLMRequest {
  return { messages: [{ role: "user", content: "test" }], model };
}

function fakeResponse(content = "ok"): LLMResponse {
  return {
    content,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "mock",
    finishReason: "stop",
  };
}

describe("middleware pipeline", () => {
  it("should run beforeLLMCall in order", async () => {
    const order: string[] = [];
    const mw1: Middleware = {
      name: "a",
      async beforeLLMCall(req) {
        order.push("a");
        return req;
      },
    };
    const mw2: Middleware = {
      name: "b",
      async beforeLLMCall(req) {
        order.push("b");
        return req;
      },
    };

    const pipeline = new MiddlewarePipeline([mw1, mw2]);
    await pipeline.runBeforeLLMCall(fakeRequest());
    expect(order).toEqual(["a", "b"]);
  });

  it("should allow middleware to modify the request", async () => {
    const mw: Middleware = {
      name: "modifier",
      async beforeLLMCall(req) {
        return { ...req, temperature: 0.5 };
      },
    };

    const pipeline = new MiddlewarePipeline([mw]);
    const modified = await pipeline.runBeforeLLMCall(fakeRequest());
    expect(modified.temperature).toBe(0.5);
  });

  it("should allow middleware to modify the response", async () => {
    const mw: Middleware = {
      name: "modifier",
      async afterLLMCall(_req, res) {
        return { ...res, content: res.content + " [modified]" };
      },
    };

    const pipeline = new MiddlewarePipeline([mw]);
    const modified = await pipeline.runAfterLLMCall(fakeRequest(), fakeResponse("hello"));
    expect(modified.content).toBe("hello [modified]");
  });

  it("should run beforeToolCall and afterToolCall", async () => {
    const calls: string[] = [];
    const mw: Middleware = {
      name: "tool-tracker",
      async beforeToolCall(toolName, args) {
        calls.push(`before:${toolName}`);
        return { toolName, args };
      },
      async afterToolCall(toolName, _args, result) {
        calls.push(`after:${toolName}`);
        return result;
      },
    };

    const pipeline = new MiddlewarePipeline([mw]);
    await pipeline.runBeforeToolCall("calc", { x: 1 });
    await pipeline.runAfterToolCall("calc", { x: 1 }, "result");

    expect(calls).toEqual(["before:calc", "after:calc"]);
  });

  it("should propagate middleware errors", async () => {
    const mw: Middleware = {
      name: "boom",
      async beforeLLMCall() {
        throw new Error("middleware error");
      },
    };

    const pipeline = new MiddlewarePipeline([mw]);
    await expect(pipeline.runBeforeLLMCall(fakeRequest())).rejects.toThrow("middleware error");
  });

  it("should handle onError middleware", async () => {
    const errors: string[] = [];
    const mw: Middleware = {
      name: "error-handler",
      async onError(error, _ctx) {
        errors.push(error.message);
        return error;
      },
    };

    const pipeline = new MiddlewarePipeline([mw]);
    const result = await pipeline.runOnError(new Error("test error"), { phase: "test" });
    expect(result).toBeInstanceOf(Error);
    expect(errors).toEqual(["test error"]);
  });

  it("should suppress errors when onError returns null", async () => {
    const mw: Middleware = {
      name: "suppressor",
      async onError() {
        return null;
      },
    };

    const pipeline = new MiddlewarePipeline([mw]);
    const result = await pipeline.runOnError(new Error("suppressed"), {});
    expect(result).toBeNull();
  });
});
