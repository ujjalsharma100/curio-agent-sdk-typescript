/**
 * Tool definition — the core abstraction for agent capabilities.
 *
 * Tools are functions the agent can invoke. Each tool has a name, description,
 * JSON schema for parameters, configuration, and an execute function.
 * Use createTool() to build tools from Zod schemas, or the @tool() decorator
 * for class methods.
 */

import type { ToolSchema } from "../../models/llm.js";
import { fromZod } from "./schema.js";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Tool configuration
// ---------------------------------------------------------------------------

/** Per-tool configuration options. */
export interface ToolConfig {
  /** Timeout for tool execution in milliseconds. Default: 120000 (2 min). */
  timeout?: number;
  /** Number of retries on failure. Default: 0. */
  maxRetries?: number;
  /** Whether to ask for user confirmation before executing. Default: false. */
  requireConfirmation?: boolean;
  /** Cache TTL in milliseconds. 0 = no caching. Default: 0. */
  cacheTtl?: number;
  /** Whether the tool is idempotent (safe to retry/cache). Default: false. */
  idempotent?: boolean;
}

// ---------------------------------------------------------------------------
// Tool execute function type
// ---------------------------------------------------------------------------

/** The function signature for a tool's execute method. */
export type ToolExecuteFn = (args: Record<string, unknown>) => string | Promise<string>;

/** Optional validator run before execute; receives args and returns validated args. */
export type ToolValidateFn = (args: Record<string, unknown>) => Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tool class
// ---------------------------------------------------------------------------

/** A tool that an agent can invoke. */
export class Tool {
  readonly name: string;
  readonly description: string;
  readonly schema: ToolSchema;
  readonly config: ToolConfig;
  private readonly _execute: ToolExecuteFn;
  private readonly _validate?: ToolValidateFn;

  constructor(params: {
    name: string;
    description: string;
    schema: ToolSchema;
    config?: ToolConfig;
    execute: ToolExecuteFn;
    /** Optional validator; if set, execute() runs this before the execute function. */
    validate?: ToolValidateFn;
  }) {
    this.name = params.name;
    this.description = params.description;
    this.schema = params.schema;
    this.config = params.config ?? {};
    this._execute = params.execute;
    this._validate = params.validate;
  }

  /** Execute the tool with the given arguments. Validates first if a validator is set. */
  async execute(args: Record<string, unknown>): Promise<string> {
    const validated = this._validate ? this._validate(args) : args;
    const result = this._execute(validated);
    if (typeof result === "string") return result;
    return result;
  }

  /** Get the LLM-facing schema for this tool. */
  toLLMSchema(): ToolSchema {
    return this.schema;
  }
}

// ---------------------------------------------------------------------------
// createTool (replaces Python @tool decorator)
// ---------------------------------------------------------------------------

/** Options for createTool. */
export interface CreateToolOptions<T extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  /** Zod schema for parameters; used for validation and JSON Schema for the LLM. */
  parameters: z.ZodType<T>;
  config?: ToolConfig;
  execute: (args: T) => string | Promise<string>;
}

/**
 * Create a Tool from a Zod schema and execute function.
 * Validates arguments with the schema before execution.
 */
export function createTool<T extends Record<string, unknown>>(options: CreateToolOptions<T>): Tool {
  const definition = fromZod(options.name, options.description, options.parameters as z.ZodType<Record<string, unknown>>);
  const validate = (args: Record<string, unknown>) => definition.validate(args) as T;
  return new Tool({
    name: options.name,
    description: options.description,
    schema: definition.toLLMSchema(),
    config: options.config,
    execute: options.execute as ToolExecuteFn,
    validate,
  });
}

// ---------------------------------------------------------------------------
// @tool() decorator
// ---------------------------------------------------------------------------

const TOOL_META = Symbol.for("curio.tool.meta");

/** Metadata stored on a method by the @tool() decorator. */
export interface ToolMethodMeta {
  config?: ToolConfig;
}

/**
 * Decorator to mark a class method as a tool. Use with createToolsFromInstance()
 * to collect Tool instances from an object. The method name becomes the tool name;
 * pass config via @tool({ timeout: 5000 }).
 */
export function tool(options?: Partial<ToolConfig>): MethodDecorator {
  return (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const meta: ToolMethodMeta = { config: options };
    (descriptor as unknown as Record<symbol, ToolMethodMeta>)[TOOL_META] = meta;
    return descriptor;
  };
}

/** Get the tool metadata from a method, if it was decorated with @tool(). */
export function getToolMeta(descriptor: PropertyDescriptor): ToolMethodMeta | undefined {
  return (descriptor as unknown as Record<symbol, ToolMethodMeta>)[TOOL_META];
}

/**
 * Build Tool instances from an object whose methods are decorated with @tool().
 * Each method becomes a tool with name = method name, empty parameter schema,
 * and execute = the bound method. For typed schemas use createTool() instead.
 */
export function createToolsFromInstance(instance: object): Tool[] {
  const tools: Tool[] = [];
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance), key);
    if (!desc || typeof desc.value !== "function") continue;
    const meta = getToolMeta(desc);
    if (!meta) continue;
    const method = desc.value as (args: Record<string, unknown>) => string | Promise<string>;
    const name = String(key);
    tools.push(
      new Tool({
        name,
        description: `Execute ${name}`,
        schema: { name, description: `Execute ${name}`, parameters: { type: "object", properties: {} } },
        config: meta.config,
        execute: method.bind(instance),
      }),
    );
  }
  return tools;
}
