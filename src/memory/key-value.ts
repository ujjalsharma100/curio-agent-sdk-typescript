import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";

/**
 * Simple key-value store for named facts.
 * Keys are used both as entry IDs and for direct lookup.
 */
export class KeyValueMemory implements Memory {
  private readonly _store = new Map<string, MemoryEntry>();

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const entry = new MemoryEntry({ content, metadata });
    this._store.set(entry.id, entry);
    return entry.id;
  }

  /** Set a key-value pair explicitly. */
  async set(key: string, value: string, metadata?: Record<string, unknown>): Promise<string> {
    const existing = this._store.get(key);
    if (existing) {
      existing.content = value;
      existing.metadata = metadata ?? existing.metadata;
      existing.updatedAt = new Date();
      return key;
    }
    const entry = new MemoryEntry({ id: key, content: value, metadata });
    this._store.set(key, entry);
    return key;
  }

  /** Get value by key. */
  async getValue(key: string): Promise<string | undefined> {
    return this._store.get(key)?.content;
  }

  /** Get all keys. */
  keys(): string[] {
    return [...this._store.keys()];
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored: Array<{ entry: MemoryEntry; relevance: number }> = [];

    for (const [key, entry] of this._store) {
      const keyLower = key.toLowerCase();
      const contentLower = entry.content.toLowerCase();

      let hits = 0;
      let exactKeyMatch = false;

      for (const term of queryTerms) {
        if (keyLower.includes(term) || contentLower.includes(term)) hits++;
        if (keyLower === term) exactKeyMatch = true;
      }

      if (hits === 0) continue;

      let relevance = queryTerms.length > 0 ? hits / queryTerms.length : 0;
      if (exactKeyMatch) relevance += 0.5;

      scored.push({
        entry: new MemoryEntry({ ...entry, metadata: { ...entry.metadata }, relevance }),
        relevance,
      });
    }

    scored.sort((a, b) => b.relevance - a.relevance);
    return scored.slice(0, limit).map((s) => s.entry);
  }

  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const results = await this.search(query, 20);
    if (results.length === 0) return "";

    const lines: string[] = ["[Stored Facts]"];
    let charBudget = maxTokens * 4;
    for (const entry of results) {
      const line = `- ${entry.id}: ${entry.content}`;
      if (charBudget - line.length < 0) break;
      charBudget -= line.length;
      lines.push(line);
    }
    return lines.join("\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    return this._store.get(entryId);
  }

  async delete(entryId: string): Promise<boolean> {
    return this._store.delete(entryId);
  }

  async clear(): Promise<void> {
    this._store.clear();
  }

  async count(): Promise<number> {
    return this._store.size;
  }
}
