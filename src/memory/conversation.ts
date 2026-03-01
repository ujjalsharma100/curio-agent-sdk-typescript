import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";

/**
 * Short-term sliding window memory of recent conversation turns.
 * Oldest entries are automatically evicted when capacity is reached.
 */
export class ConversationMemory implements Memory {
  private readonly maxEntries: number;
  private readonly _entries: MemoryEntry[] = [];
  private readonly _index = new Map<string, MemoryEntry>();

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const entry = new MemoryEntry({ content, metadata });

    // Evict oldest if at capacity
    if (this._entries.length >= this.maxEntries) {
      const oldest = this._entries.shift();
      if (oldest) this._index.delete(oldest.id);
    }

    this._entries.push(entry);
    this._index.set(entry.id, entry);
    return entry.id;
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const total = this._entries.length;

    const scored = this._entries.map((entry, idx) => {
      // Recency: most recent = 1.0
      const recencyScore = total > 1 ? idx / (total - 1) : 1.0;

      // Keyword relevance
      const contentLower = entry.content.toLowerCase();
      const hits = queryTerms.filter((t) => contentLower.includes(t)).length;
      const keywordScore = queryTerms.length > 0 ? hits / queryTerms.length : 0;

      const relevance = 0.5 * recencyScore + 0.5 * keywordScore;
      return { entry, relevance };
    });

    scored.sort((a, b) => b.relevance - a.relevance);

    return scored.slice(0, limit).map(({ entry, relevance }) => {
      return new MemoryEntry({
        ...entry,
        metadata: { ...entry.metadata },
        relevance,
      });
    });
  }

  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const results = await this.search(query, 20);
    if (results.length === 0) return "";

    const lines: string[] = ["[Conversation Memory]"];
    let charBudget = maxTokens * 4; // rough char estimate
    for (const entry of results) {
      const line = `- ${entry.content}`;
      if (charBudget - line.length < 0) break;
      charBudget -= line.length;
      lines.push(line);
    }
    return lines.join("\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    return this._index.get(entryId);
  }

  async delete(entryId: string): Promise<boolean> {
    const entry = this._index.get(entryId);
    if (!entry) return false;
    this._index.delete(entryId);
    const idx = this._entries.indexOf(entry);
    if (idx >= 0) this._entries.splice(idx, 1);
    return true;
  }

  async clear(): Promise<void> {
    this._entries.length = 0;
    this._index.clear();
  }

  async count(): Promise<number> {
    return this._entries.length;
  }

  /** Synchronous convenience: get the N most recent entries. */
  getRecent(n = 10): MemoryEntry[] {
    return this._entries.slice(-n);
  }
}
