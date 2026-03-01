import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createTool,
  Tool,
  ToolRegistry,
  ToolExecutor,
  ToolSchemaDefinition,
  fromZod,
  ToolValidationError,
  HookRegistry,
  HookEvent,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// ToolSchemaDefinition / fromZod
// ---------------------------------------------------------------------------

describe("ToolSchemaDefinition / fromZod", () => {
  it("fromZod builds schema with validate and toLLMSchema", () => {
    const schema = z.object({
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10),
    });
    const def = fromZod("search", "Search the web", schema);
    expect(def.name).toBe("search");
    expect(def.description).toBe("Search the web");
    expect(def.parameters).toBeDefined();
    expect(def.toJsonSchema().type).toBe("object");
    expect(def.toJsonSchema().properties).toBeDefined();

    const llm = def.toLLMSchema();
    expect(llm.name).toBe("search");
    expect(llm.description).toBe("Search the web");
    expect(llm.parameters).toEqual(def.toJsonSchema());

    const validated = def.validate({ query: "test" });
    expect(validated.query).toBe("test");
    expect(validated.limit).toBe(10);
  });

  it("validate throws ToolValidationError on invalid input", () => {
    const schema = z.object({ name: z.string() });
    const def = fromZod("greet", "Greet", schema);
    expect(() => def.validate({})).toThrow(ToolValidationError);
    expect(() => def.validate({ name: 123 })).toThrow(ToolValidationError);
  });
});

// ---------------------------------------------------------------------------
// createTool
// ---------------------------------------------------------------------------

describe("createTool", () => {
  it("creates a Tool with Zod schema and validation", async () => {
    const greet = createTool({
      name: "greet",
      description: "Greet someone",
      parameters: z.object({ name: z.string() }),
      execute: ({ name }) => `Hello, ${name}!`,
    });
    expect(greet.name).toBe("greet");
    expect(greet.schema.name).toBe("greet");
    const result = await greet.execute({ name: "Alice" });
    expect(result).toBe("Hello, Alice!");
  });

  it("validates args before execute", async () => {
    const greet = createTool({
      name: "greet",
      description: "Greet",
      parameters: z.object({ name: z.string() }),
      execute: ({ name }) => `Hi ${name}`,
    });
    await expect(greet.execute({})).rejects.toThrow(ToolValidationError);
    await expect(greet.execute({ name: 1 } as unknown as Record<string, unknown>)).rejects.toThrow();
  });

  it("toLLMSchema returns schema for LLM", () => {
    const t = createTool({
      name: "add",
      description: "Add two numbers",
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: ({ a, b }) => String(a + b),
    });
    const llm = t.toLLMSchema();
    expect(llm.name).toBe("add");
    expect(llm.parameters.properties).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ToolRegistry (get returns Tool | undefined)
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  it("get returns undefined for unknown tool", () => {
    const reg = new ToolRegistry();
    expect(reg.get("missing")).toBeUndefined();
  });

  it("getAll and getSchemas return registered tools", () => {
    const reg = new ToolRegistry();
    const t = createTool({
      name: "x",
      description: "X",
      parameters: z.object({}),
      execute: () => "ok",
    });
    reg.register(t);
    expect(reg.getAll()).toHaveLength(1);
    expect(reg.getSchemas()).toHaveLength(1);
    expect(reg.getSchemas()[0]!.name).toBe("x");
  });

  it("is iterable", () => {
    const reg = new ToolRegistry();
    const t = createTool({ name: "a", description: "A", parameters: z.object({}), execute: () => "" });
    reg.register(t);
    const names = [...reg].map((tool) => tool.name);
    expect(names).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// ToolExecutor: cache and hooks
// ---------------------------------------------------------------------------

describe("ToolExecutor", () => {
  it("executeTool with hookRegistry emits before/after", async () => {
    const reg = new ToolRegistry();
    reg.register(
      createTool({
        name: "echo",
        description: "Echo",
        parameters: z.object({ x: z.string() }),
        execute: ({ x }) => x,
      }),
    );
    const hooks = new HookRegistry();
    const events: string[] = [];
    hooks.on(HookEvent.TOOL_CALL_BEFORE, () => events.push("before"));
    hooks.on(HookEvent.TOOL_CALL_AFTER, () => events.push("after"));
    const executor = new ToolExecutor(reg, { hookRegistry: hooks });

    const result = await executor.executeTool(
      { id: "1", name: "echo", arguments: { x: "hi" } },
      { runId: "r1" },
    );
    expect(result.result).toBe("hi");
    expect(events).toEqual(["before", "after"]);
  });

  it("caches result when tool has cacheTtl", async () => {
    const reg = new ToolRegistry();
    let callCount = 0;
    reg.register(
      new Tool({
        name: "count",
        description: "Count",
        schema: { name: "count", description: "Count", parameters: { type: "object", properties: {} } },
        config: { cacheTtl: 60_000 },
        execute: () => {
          callCount++;
          return String(callCount);
        },
      }),
    );
    const executor = new ToolExecutor(reg);
    const call = { id: "1", name: "count", arguments: {} };
    const r1 = await executor.executeTool(call);
    const r2 = await executor.executeTool(call);
    expect(r1.result).toBe("1");
    expect(r2.result).toBe("1"); // cached
    expect(callCount).toBe(1);
  });

  it("permission denied when permissionPolicy returns allowed: false", async () => {
    const reg = new ToolRegistry();
    reg.register(
      createTool({
        name: "restricted",
        description: "Restricted",
        parameters: z.object({}),
        execute: () => "ok",
      }),
    );
    const executor = new ToolExecutor(reg, {
      permissionPolicy: {
        async checkToolCall() {
          return { allowed: false, reason: "not allowed" };
        },
      },
    });
    const result = await executor.executeTool({ id: "1", name: "restricted", arguments: {} });
    expect(result.error).toContain("Permission denied");
    expect(result.result).toBe("");
  });
});
