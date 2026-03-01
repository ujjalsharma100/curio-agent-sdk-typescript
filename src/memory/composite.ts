import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";

/**
 * Combines multiple memory backends into a unified interface.
 * Routes adds to all (or targeted) backends, merges search results.
 */
export class CompositeMemory implements Memory {
  private readonly _memories: Map<string, Memory>;

  constructor(memories: Record<string, Memory>) {
    this._memories = new Map(Object.entries(memories));
  }

  /** Get a specific sub-memory by name. */
  getMemory(name: string): Memory | undefined {
    return this._memories.get(name);
  }

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const targets = metadata?.memoryTargets as string[] | undefined;
    let lastId = "";

    for (const [name, memory] of this._memories) {
      if (targets && !targets.includes(name)) continue;
      const meta: Record<string, unknown> = { ...metadata, _sourceMemory: name };
      delete meta.memoryTargets;
      lastId = await memory.add(content, meta);
    }
    return lastId;
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const allResults: MemoryEntry[] = [];
    const seen = new Set<string>();

    for (const [name, memory] of this._memories) {
      const results = await memory.search(query, limit);
      for (const entry of results) {
        // Deduplicate by content
        if (seen.has(entry.content)) continue;
        seen.add(entry.content);
        entry.metadata._sourceMemory = name;
        allResults.push(entry);
      }
    }

    allResults.sort((a, b) => b.relevance - a.relevance);
    return allResults.slice(0, limit);
  }

  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const memories = [...this._memories.values()];
    const perMemoryBudget = Math.floor(maxTokens / Math.max(memories.length, 1));

    const parts: string[] = [];
    for (const memory of memories) {
      const ctx = await memory.getContext(query, perMemoryBudget);
      if (ctx) parts.push(ctx);
    }
    return parts.join("\n\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    for (const memory of this._memories.values()) {
      if (memory.get) {
        const entry = await memory.get(entryId);
        if (entry) return entry;
      }
    }
    return undefined;
  }

  async delete(entryId: string): Promise<boolean> {
    let deleted = false;
    for (const memory of this._memories.values()) {
      if (memory.delete) {
        const ok = await memory.delete(entryId);
        if (ok) deleted = true;
      }
    }
    return deleted;
  }

  async clear(): Promise<void> {
    for (const memory of this._memories.values()) {
      if (memory.clear) await memory.clear();
    }
  }

  async count(): Promise<number> {
    let total = 0;
    for (const memory of this._memories.values()) {
      if (memory.count) total += await memory.count();
    }
    return total;
  }
}
