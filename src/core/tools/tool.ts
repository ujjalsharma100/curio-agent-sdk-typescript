/**
 * Tool definition — the core abstraction for agent capabilities.
 *
 * Tools are functions the agent can invoke. Each tool has a name, description,
 * JSON schema for parameters, configuration, and an execute function.
 *
 * Full implementation (createTool, decorators, schema generation) is in Phase 4.
 * This file defines the Tool class and ToolConfig used by the agent/builder/runtime.
 */

import type { ToolSchema } from "../../models/llm.js";

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

  constructor(params: {
    name: string;
    description: string;
    schema: ToolSchema;
    config?: ToolConfig;
    execute: ToolExecuteFn;
  }) {
    this.name = params.name;
    this.description = params.description;
    this.schema = params.schema;
    this.config = params.config ?? {};
    this._execute = params.execute;
  }

  /** Execute the tool with the given arguments. */
  async execute(args: Record<string, unknown>): Promise<string> {
    const result = this._execute(args);
    if (typeof result === "string") return result;
    return result;
  }

  /** Get the LLM-facing schema for this tool. */
  toLLMSchema(): ToolSchema {
    return this.schema;
  }
}
