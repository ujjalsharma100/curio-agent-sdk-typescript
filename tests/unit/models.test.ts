import { describe, it, expect } from "vitest";
import {
  emptyTokenUsage,
  addTokenUsage,
  getMessageText,
  createMessage,
  emptyMetrics,
  HookContext,
  HookEvent,
  EventType,
  createAgentEvent,
  CurioError,
  LLMError,
  LLMRateLimitError,
  LLMAuthenticationError,
  LLMProviderError,
  LLMTimeoutError,
  NoAvailableModelError,
  CostBudgetExceeded,
  ToolError,
  ToolNotFoundError,
  ToolExecutionError,
  ToolTimeoutError,
  ToolValidationError,
  StateError,
  SessionNotFoundError,
  ConfigurationError,
  CredentialError,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// LLM types
// ---------------------------------------------------------------------------

describe("TokenUsage", () => {
  it("should create empty token usage", () => {
    const usage = emptyTokenUsage();
    expect(usage.promptTokens).toBe(0);
    expect(usage.completionTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
    expect(usage.cacheReadTokens).toBeUndefined();
    expect(usage.cacheWriteTokens).toBeUndefined();
  });

  it("should add token usage", () => {
    const a = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    const b = { promptTokens: 200, completionTokens: 100, totalTokens: 300, cacheReadTokens: 10 };
    const result = addTokenUsage(a, b);
    expect(result.promptTokens).toBe(300);
    expect(result.completionTokens).toBe(150);
    expect(result.totalTokens).toBe(450);
    expect(result.cacheReadTokens).toBe(10);
  });

  it("should handle cache tokens in addition", () => {
    const a = { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheReadTokens: 3, cacheWriteTokens: 2 };
    const b = { promptTokens: 20, completionTokens: 10, totalTokens: 30, cacheReadTokens: 7, cacheWriteTokens: 8 };
    const result = addTokenUsage(a, b);
    expect(result.cacheReadTokens).toBe(10);
    expect(result.cacheWriteTokens).toBe(10);
  });
});

describe("Message helpers", () => {
  it("should get text from string content", () => {
    const msg = createMessage("user", "hello");
    expect(getMessageText(msg)).toBe("hello");
  });

  it("should get text from content parts", () => {
    const msg = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "hello " },
        { type: "image_url" as const, imageUrl: { url: "data:..." } },
        { type: "text" as const, text: "world" },
      ],
    };
    expect(getMessageText(msg)).toBe("hello world");
  });

  it("should create message with tool call", () => {
    const msg = createMessage("assistant", "I'll call a tool", {
      toolCalls: [{ id: "tc1", name: "greet", arguments: { name: "Alice" } }],
    });
    expect(msg.role).toBe("assistant");
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0]!.name).toBe("greet");
  });

  it("should create tool result message", () => {
    const msg = createMessage("tool", "result text", { toolCallId: "tc1" });
    expect(msg.role).toBe("tool");
    expect(msg.toolCallId).toBe("tc1");
  });
});

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

describe("AgentMetrics", () => {
  it("should create empty metrics", () => {
    const metrics = emptyMetrics();
    expect(metrics.totalTokens).toBe(0);
    expect(metrics.llmCalls).toBe(0);
    expect(metrics.toolCalls).toBe(0);
    expect(metrics.estimatedCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe("HookEvent constants", () => {
  it("should have all 16 hook events", () => {
    const events = Object.values(HookEvent);
    expect(events).toHaveLength(16);
    expect(events).toContain("agent.run.before");
    expect(events).toContain("agent.run.after");
    expect(events).toContain("agent.run.error");
    expect(events).toContain("llm.call.before");
    expect(events).toContain("tool.call.before");
    expect(events).toContain("memory.inject.before");
    expect(events).toContain("state.checkpoint.after");
  });
});

describe("HookContext", () => {
  it("should be mutable", () => {
    const ctx = new HookContext({
      event: "tool.call.before",
      data: { tool: "bash", args: { command: "ls" } },
      runId: "run-1",
      agentId: "agent-1",
      iteration: 3,
    });

    expect(ctx.event).toBe("tool.call.before");
    expect(ctx.cancelled).toBe(false);

    ctx.cancel();
    expect(ctx.cancelled).toBe(true);

    ctx.modify("args", { command: "pwd" });
    expect(ctx.data["args"]).toEqual({ command: "pwd" });
  });
});

describe("createAgentEvent", () => {
  it("should create an event with timestamp", () => {
    const before = new Date();
    const event = createAgentEvent(EventType.RUN_STARTED, { input: "hello" }, {
      runId: "r1",
      agentId: "a1",
      iteration: 0,
    });
    expect(event.type).toBe(EventType.RUN_STARTED);
    expect(event.data["input"]).toBe("hello");
    expect(event.runId).toBe("r1");
    expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe("Error hierarchy", () => {
  it("CurioError is instanceof Error", () => {
    const err = new CurioError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CurioError);
    expect(err.name).toBe("CurioError");
    expect(err.message).toBe("test");
  });

  it("LLMError extends CurioError", () => {
    const err = new LLMError("llm failed", { provider: "openai", model: "gpt-4o" });
    expect(err).toBeInstanceOf(CurioError);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.provider).toBe("openai");
    expect(err.model).toBe("gpt-4o");
    expect(err.name).toBe("LLMError");
  });

  it("LLMRateLimitError has retryAfter", () => {
    const err = new LLMRateLimitError("rate limited", { retryAfter: 30 });
    expect(err).toBeInstanceOf(LLMError);
    expect(err.retryAfter).toBe(30);
    expect(err.name).toBe("LLMRateLimitError");
  });

  it("LLMAuthenticationError", () => {
    const err = new LLMAuthenticationError("invalid key", { provider: "anthropic" });
    expect(err).toBeInstanceOf(LLMError);
    expect(err.name).toBe("LLMAuthenticationError");
  });

  it("LLMProviderError has statusCode", () => {
    const err = new LLMProviderError("server error", { statusCode: 500 });
    expect(err).toBeInstanceOf(LLMError);
    expect(err.statusCode).toBe(500);
  });

  it("LLMTimeoutError has timeoutMs", () => {
    const err = new LLMTimeoutError("timed out", { timeoutMs: 30000 });
    expect(err).toBeInstanceOf(LLMError);
    expect(err.timeoutMs).toBe(30000);
  });

  it("NoAvailableModelError", () => {
    const err = new NoAvailableModelError("no models");
    expect(err).toBeInstanceOf(LLMError);
  });

  it("CostBudgetExceeded has budget and actual", () => {
    const err = new CostBudgetExceeded("over budget", { budget: 1.0, actual: 1.5 });
    expect(err).toBeInstanceOf(LLMError);
    expect(err.budget).toBe(1.0);
    expect(err.actual).toBe(1.5);
  });

  it("ToolError has toolName", () => {
    const err = new ToolError("tool failed", { toolName: "bash" });
    expect(err).toBeInstanceOf(CurioError);
    expect(err.toolName).toBe("bash");
  });

  it("ToolNotFoundError", () => {
    const err = new ToolNotFoundError("not found", { toolName: "missing" });
    expect(err).toBeInstanceOf(ToolError);
    expect(err.toolName).toBe("missing");
  });

  it("ToolExecutionError has toolArgs", () => {
    const err = new ToolExecutionError("exec failed", {
      toolName: "bash",
      toolArgs: { command: "bad" },
    });
    expect(err).toBeInstanceOf(ToolError);
    expect(err.toolArgs).toEqual({ command: "bad" });
  });

  it("ToolTimeoutError has timeoutMs", () => {
    const err = new ToolTimeoutError("timeout", { toolName: "bash", timeoutMs: 60000 });
    expect(err).toBeInstanceOf(ToolError);
    expect(err.timeoutMs).toBe(60000);
  });

  it("ToolValidationError has validationErrors", () => {
    const err = new ToolValidationError("invalid", {
      toolName: "read",
      validationErrors: ["missing path"],
    });
    expect(err).toBeInstanceOf(ToolError);
    expect(err.validationErrors).toEqual(["missing path"]);
  });

  it("StateError, SessionNotFoundError, ConfigurationError, CredentialError", () => {
    expect(new StateError("state")).toBeInstanceOf(CurioError);
    expect(new SessionNotFoundError("not found", { sessionId: "s1" }).sessionId).toBe("s1");
    expect(new ConfigurationError("config")).toBeInstanceOf(CurioError);
    expect(new CredentialError("cred")).toBeInstanceOf(CurioError);
  });

  it("error cause chaining works", () => {
    const cause = new Error("root cause");
    const err = new LLMError("wrapped", { cause });
    expect(err.cause).toBe(cause);
  });
});
