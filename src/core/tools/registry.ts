/**
 * Tool registry — stores and looks up tools by name.
 *
 * Full implementation (validation, schema caching) is in Phase 4.
 * This provides the core registry used by agent/builder/runtime.
 */

import type { ToolSchema } from "../../models/llm.js";
import { ToolNotFoundError } from "../../models/errors.js";
import { Tool } from "./tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /** Register a tool. Throws if a tool with the same name already exists. */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Get a tool by name. Returns undefined if not found. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get a tool by name, throwing if not found. */
  getOrThrow(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(`Tool "${name}" not found in registry`, { toolName: name });
    }
    return tool;
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get all registered tools. */
  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  /** Get all tool names. */
  getNames(): string[] {
    return [...this.tools.keys()];
  }

  /** Get LLM-facing schemas for all registered tools. */
  getSchemas(): ToolSchema[] {
    return this.getAll().map((t) => t.toLLMSchema());
  }

  /** Number of registered tools. */
  get size(): number {
    return this.tools.size;
  }

  /** Iterate over registered tools. */
  [Symbol.iterator](): IterableIterator<Tool> {
    return this.tools.values();
  }
}
