import { z } from "zod";
import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";
import { KeyValueMemory } from "./key-value.js";
import { createTool, type Tool } from "../core/tools/tool.js";

/**
 * MemGPT/Letta-style self-editing memory.
 * Agent manages its own core (always-in-context) memory and
 * archival (searchable long-term) memory via tools.
 */
export class SelfEditingMemory implements Memory {
  private _coreMemoryText: string;
  readonly maxCoreChars: number;
  private readonly _archival: Memory;

  constructor(options?: { archival?: Memory; maxCoreChars?: number }) {
    this.maxCoreChars = options?.maxCoreChars ?? 2000;
    this._archival = options?.archival ?? new KeyValueMemory();
    this._coreMemoryText = "";
  }

  /** Get the current core memory text. */
  get coreMemory(): string {
    return this._coreMemoryText;
  }

  /** Get tools for the agent to manage memory. */
  getTools(): Tool[] {
    return [
      createTool({
        name: "core_memory_read",
        description: "Read the current contents of core memory (always in context).",
        parameters: z.object({}),
        execute: async () => {
          return this._coreMemoryText || "(empty)";
        },
      }),
      createTool({
        name: "core_memory_write",
        description: "Append text to core memory.",
        parameters: z.object({
          addition: z.string().describe("Text to append to core memory"),
        }),
        execute: async (args) => {
          const newText = this._coreMemoryText + args.addition;
          if (newText.length > this.maxCoreChars) {
            return `Error: would exceed core memory limit (${this.maxCoreChars} chars). Current: ${this._coreMemoryText.length}, addition: ${args.addition.length}`;
          }
          this._coreMemoryText = newText;
          return `Core memory updated. Length: ${this._coreMemoryText.length}/${this.maxCoreChars}`;
        },
      }),
      createTool({
        name: "core_memory_replace",
        description: "Replace a substring in core memory with new text.",
        parameters: z.object({
          old: z.string().describe("Exact substring to find"),
          new: z.string().describe("Replacement text"),
        }),
        execute: async (args) => {
          if (!this._coreMemoryText.includes(args.old)) {
            return `Error: substring not found in core memory: "${args.old}"`;
          }
          const updated = this._coreMemoryText.replace(args.old, args.new);
          if (updated.length > this.maxCoreChars) {
            return `Error: replacement would exceed core memory limit (${this.maxCoreChars} chars).`;
          }
          this._coreMemoryText = updated;
          return `Core memory updated. Length: ${this._coreMemoryText.length}/${this.maxCoreChars}`;
        },
      }),
      createTool({
        name: "archival_memory_search",
        description: "Search long-term archival memory.",
        parameters: z.object({
          query: z.string().describe("Search query"),
          limit: z.number().optional().describe("Max results (default 5)"),
        }),
        execute: async (args) => {
          const results = await this._archival.search(args.query, args.limit ?? 5);
          if (results.length === 0) return "No results found in archival memory.";
          return results.map((e, i) => `${i + 1}. [${e.id}] ${e.content}`).join("\n");
        },
      }),
      createTool({
        name: "archival_memory_insert",
        description: "Insert content into long-term archival memory.",
        parameters: z.object({
          content: z.string().describe("Content to store in archival memory"),
        }),
        execute: async (args) => {
          const id = await this._archival.add(args.content);
          return `Stored in archival memory with id: ${id}`;
        },
      }),
    ];
  }

  // ---------------------------------------------------------------------------
  // Memory interface (delegates to archival)
  // ---------------------------------------------------------------------------

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    return this._archival.add(content, metadata);
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    return this._archival.search(query, limit);
  }

  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const parts: string[] = [];

    // Core memory is always included
    if (this._coreMemoryText) {
      parts.push(`[Core Memory]\n${this._coreMemoryText}`);
    }

    // Include archival results within remaining budget
    const coreChars = parts.join("").length;
    const remainingTokens = Math.max(0, maxTokens - Math.ceil(coreChars / 4));

    if (remainingTokens > 100) {
      const archivalCtx = await this._archival.getContext(query, remainingTokens);
      if (archivalCtx) parts.push(archivalCtx);
    }

    return parts.join("\n\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    if (this._archival.get) return this._archival.get(entryId);
    return undefined;
  }

  async delete(entryId: string): Promise<boolean> {
    if (this._archival.delete) return this._archival.delete(entryId);
    return false;
  }

  async clear(): Promise<void> {
    this._coreMemoryText = "";
    if (this._archival.clear) await this._archival.clear();
  }

  async count(): Promise<number> {
    if (this._archival.count) return this._archival.count();
    return 0;
  }
}
