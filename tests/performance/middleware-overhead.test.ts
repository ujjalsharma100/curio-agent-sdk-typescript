import { describe, it, expect } from "vitest";
import type { LLMRequest, LLMResponse, TokenUsage } from "../../src/models/llm.js";
import { MiddlewarePipeline, type Middleware } from "../../src/middleware/base.js";
import { HookRegistry } from "../../src/core/events/hooks.js";
import { HookContext } from "../../src/models/events.js";

function makeRequest(): LLMRequest {
  return {
    messages: [
      {
        role: "user",
        content: "test",
      },
    ],
    model: "test-model",
  };
}

function makeResponse(): LLMResponse {
  return {
    content: "ok",
    toolCalls: [],
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    } as TokenUsage,
    model: "test-model",
    finishReason: "stop",
  };
}

class NoOpMiddleware implements Middleware {
  readonly name = "noop";

  async beforeLLMCall(request: LLMRequest): Promise<LLMRequest> {
    return request;
  }

  async afterLLMCall(_request: LLMRequest, response: LLMResponse): Promise<LLMResponse> {
    return response;
  }
}

class CountingMiddleware implements Middleware {
  readonly name = "counter";
  beforeCount = 0;
  afterCount = 0;

  async beforeLLMCall(request: LLMRequest): Promise<LLMRequest> {
    this.beforeCount += 1;
    return request;
  }

  async afterLLMCall(_request: LLMRequest, response: LLMResponse): Promise<LLMResponse> {
    this.afterCount += 1;
    return response;
  }
}

describe("Performance: Middleware pipeline and hooks", () => {
  it("runs 1000 middleware pipeline passes with 5 middleware in under 3000ms", async () => {
    const middleware: Middleware[] = Array.from({ length: 5 }, () => new NoOpMiddleware());
    const pipeline = new MiddlewarePipeline(middleware);

    const req = makeRequest();
    const res = makeResponse();

    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const outReq = await pipeline.runBeforeLLMCall(req);
      const outRes = await pipeline.runAfterLLMCall(outReq, res);
      expect(outRes).toBeDefined();
    }
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(3000);
  });

  it("emits 10000 hooks in under 3000ms", async () => {
    const registry = new HookRegistry();
    let callCount = 0;

    const handler = async (ctx: HookContext): Promise<HookContext> => {
      callCount += 1;
      return ctx;
    };

    for (let i = 0; i < 5; i++) {
      registry.on("test.event", handler);
    }

    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const ctx = new HookContext({ event: "test.event", data: { i } });
      await registry.emit("test.event", ctx);
    }
    const elapsedMs = performance.now() - start;

    expect(callCount).toBe(50000);
    expect(elapsedMs).toBeLessThan(3000);
  });

  it("accurately counts middleware invocations at scale", async () => {
    const counter = new CountingMiddleware();
    const pipeline = new MiddlewarePipeline([counter]);

    const req = makeRequest();
    const res = makeResponse();

    const iterations = 5000;
    for (let i = 0; i < iterations; i++) {
      const outReq = await pipeline.runBeforeLLMCall(req);
      await pipeline.runAfterLLMCall(outReq, res);
    }

    expect(counter.beforeCount).toBe(iterations);
    expect(counter.afterCount).toBe(iterations);
  });
});

