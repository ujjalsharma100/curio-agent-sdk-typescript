import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";
import { generateShortId } from "../utils/hash.js";

/**
 * A temporal episode with importance scoring.
 */
export class Episode {
  readonly id: string;
  content: string;
  summary: string;
  metadata: Record<string, unknown>;
  readonly createdAt: Date;
  importance: number;

  constructor(params?: {
    id?: string;
    content?: string;
    summary?: string;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
    importance?: number;
  }) {
    this.id = params?.id ?? generateShortId();
    this.content = params?.content ?? "";
    this.summary = params?.summary ?? "";
    this.metadata = params?.metadata ?? {};
    this.createdAt = params?.createdAt ?? new Date();
    this.importance = params?.importance ?? 0.5;
  }

  toDict(): Record<string, unknown> {
    return {
      id: this.id,
      content: this.content,
      summary: this.summary,
      metadata: { ...this.metadata },
      createdAt: this.createdAt.toISOString(),
      importance: this.importance,
    };
  }

  static fromDict(data: Record<string, unknown>): Episode {
    return new Episode({
      id: data.id as string | undefined,
      content: data.content as string | undefined,
      summary: data.summary as string | undefined,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      createdAt: data.createdAt ? new Date(data.createdAt as string) : undefined,
      importance: (data.importance as number) ?? 0.5,
    });
  }
}

/**
 * Temporal episodic memory with decay and importance scoring.
 * Episodes are ranked by keyword relevance and importance,
 * with optional time-range filtering.
 */
export class EpisodicMemory implements Memory {
  private readonly maxEpisodes: number;
  private _episodes: Episode[] = [];
  private _index = new Map<string, Episode>();

  constructor(maxEpisodes = 500) {
    this.maxEpisodes = maxEpisodes;
  }

  /** Record an episode. */
  async recordEpisode(episode: Episode): Promise<string> {
    this._episodes.push(episode);
    this._index.set(episode.id, episode);
    this._evict();
    return episode.id;
  }

  /** Recall episodes matching a query, optionally filtered by time range. */
  async recall(
    query: string,
    limit = 10,
    timeRange?: [Date, Date],
  ): Promise<Episode[]> {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

    let candidates = this._episodes;
    if (timeRange) {
      const [start, end] = timeRange;
      candidates = candidates.filter(
        (ep) => ep.createdAt >= start && ep.createdAt <= end,
      );
    }

    const scored = candidates.map((ep) => {
      const text = `${ep.content} ${ep.summary}`.toLowerCase();
      const hits = queryTerms.filter((t) => text.includes(t)).length;
      const keywordRelevance = queryTerms.length > 0 ? hits / queryTerms.length : 0;
      const relevance = keywordRelevance * 0.7 + ep.importance * 0.3;
      return { episode: ep, relevance };
    });

    scored.sort((a, b) => {
      if (Math.abs(b.relevance - a.relevance) > 0.001) return b.relevance - a.relevance;
      return b.episode.createdAt.getTime() - a.episode.createdAt.getTime();
    });

    return scored.slice(0, limit).map((s) => s.episode);
  }

  // ---------------------------------------------------------------------------
  // Memory interface
  // ---------------------------------------------------------------------------

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const ep = new Episode({
      content,
      metadata,
      importance: (metadata?.importance as number) ?? 0.5,
    });
    return this.recordEpisode(ep);
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const episodes = await this.recall(query, limit);
    return episodes.map(
      (ep) =>
        new MemoryEntry({
          id: ep.id,
          content: ep.content,
          metadata: ep.metadata,
          relevance: 0, // recall doesn't expose relevance directly
          createdAt: ep.createdAt,
        }),
    );
  }

  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const episodes = await this.recall(query, 20);
    if (episodes.length === 0) return "";

    const lines: string[] = ["[Episodic Memory]"];
    let charBudget = maxTokens * 4;
    for (const ep of episodes) {
      const text = ep.summary || ep.content;
      const line = `- [${ep.createdAt.toISOString()}] ${text}`;
      if (charBudget - line.length < 0) break;
      charBudget -= line.length;
      lines.push(line);
    }
    return lines.join("\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    const ep = this._index.get(entryId);
    if (!ep) return undefined;
    return new MemoryEntry({
      id: ep.id,
      content: ep.content,
      metadata: ep.metadata,
      createdAt: ep.createdAt,
    });
  }

  async delete(entryId: string): Promise<boolean> {
    const ep = this._index.get(entryId);
    if (!ep) return false;
    this._index.delete(entryId);
    const idx = this._episodes.indexOf(ep);
    if (idx >= 0) this._episodes.splice(idx, 1);
    return true;
  }

  async clear(): Promise<void> {
    this._episodes = [];
    this._index.clear();
  }

  async count(): Promise<number> {
    return this._episodes.length;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private _evict(): void {
    if (this._episodes.length <= this.maxEpisodes) return;
    // Remove oldest episodes beyond capacity
    const toRemove = this._episodes.splice(0, this._episodes.length - this.maxEpisodes);
    for (const ep of toRemove) {
      this._index.delete(ep.id);
    }
  }
}
