import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";

/**
 * Ephemeral in-context scratchpad for the current task.
 * All data is cleared between runs. Useful for task state,
 * goals, and intermediate results.
 */
export class WorkingMemory implements Memory {
  private readonly _store = new Map<string, string>();
  private readonly _meta = new Map<string, Record<string, unknown>>();

  /** Write a key-value pair to the scratchpad. */
  async write(key: string, value: string): Promise<void> {
    this._store.set(key, value);
  }

  /** Read a value by key. */
  async read(key: string): Promise<string | undefined> {
    return this._store.get(key);
  }

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const key = metadata?.key ? String(metadata.key) : `entry_${this._store.size}`;
    this._store.set(key, content);
    if (metadata) this._meta.set(key, metadata);
    return key;
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: MemoryEntry[] = [];

    for (const [key, value] of this._store) {
      const text = `${key} ${value}`.toLowerCase();
      const hits = queryTerms.filter((t) => text.includes(t)).length;
      const relevance = queryTerms.length > 0 ? hits / queryTerms.length : 0;

      results.push(
        new MemoryEntry({
          id: key,
          content: value,
          metadata: this._meta.get(key) ?? {},
          relevance,
        }),
      );
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
  }

  async getContext(_query: string, maxTokens = 2000): Promise<string> {
    if (this._store.size === 0) return "";

    const lines: string[] = ["[Working Memory]"];
    let charBudget = maxTokens * 4;
    for (const [key, value] of this._store) {
      const line = `- ${key}: ${value}`;
      if (charBudget - line.length < 0) break;
      charBudget -= line.length;
      lines.push(line);
    }
    return lines.join("\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    const value = this._store.get(entryId);
    if (value === undefined) return undefined;
    return new MemoryEntry({
      id: entryId,
      content: value,
      metadata: this._meta.get(entryId) ?? {},
    });
  }

  async delete(entryId: string): Promise<boolean> {
    const had = this._store.has(entryId);
    this._store.delete(entryId);
    this._meta.delete(entryId);
    return had;
  }

  async clear(): Promise<void> {
    this._store.clear();
    this._meta.clear();
  }

  async count(): Promise<number> {
    return this._store.size;
  }
}
