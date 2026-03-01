import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";

/**
 * A subject-predicate-object triple in the knowledge graph.
 */
export class Triple {
  readonly subject: string;
  readonly relation: string;
  readonly obj: string;
  readonly metadata?: Record<string, unknown>;

  constructor(subject: string, relation: string, obj: string, metadata?: Record<string, unknown>) {
    this.subject = subject;
    this.relation = relation;
    this.obj = obj;
    this.metadata = metadata;
  }

  toDict(): Record<string, unknown> {
    return {
      subject: this.subject,
      relation: this.relation,
      obj: this.obj,
      metadata: this.metadata ? { ...this.metadata } : undefined,
    };
  }

  static fromDict(data: Record<string, unknown>): Triple {
    return new Triple(
      data.subject as string,
      data.relation as string,
      data.obj as string,
      data.metadata as Record<string, unknown> | undefined,
    );
  }

  /** Synthetic ID for deduplication. */
  get id(): string {
    return `${this.subject}:${this.relation}:${this.obj}`;
  }
}

/**
 * Entity-relationship knowledge graph memory.
 * Stores facts as subject-predicate-object triples and supports
 * querying by entity, relation, or free-text substring matching.
 */
export class GraphMemory implements Memory {
  private _entities = new Map<string, Record<string, unknown>>();
  private _triples: Triple[] = [];
  private _bySubject = new Map<string, number[]>();
  private _byRelation = new Map<string, number[]>();
  private _byObject = new Map<string, number[]>();

  /** Register an entity with optional attributes. */
  async addEntity(entity: string, attributes?: Record<string, unknown>): Promise<void> {
    const existing = this._entities.get(entity);
    this._entities.set(entity, { ...existing, ...attributes });
  }

  /** Add a relationship between two entities. */
  async addRelation(entity1: string, relation: string, entity2: string): Promise<void> {
    const triple = new Triple(entity1, relation, entity2);
    const idx = this._triples.length;
    this._triples.push(triple);

    this._appendIndex(this._bySubject, entity1, idx);
    this._appendIndex(this._byRelation, relation, idx);
    this._appendIndex(this._byObject, entity2, idx);

    // Auto-register entities
    if (!this._entities.has(entity1)) this._entities.set(entity1, {});
    if (!this._entities.has(entity2)) this._entities.set(entity2, {});
  }

  /** Query triples matching a free-text query. */
  async query(queryStr: string, limit = 20): Promise<Triple[]> {
    const lower = queryStr.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);

    const matched: Array<{ triple: Triple; score: number }> = [];

    for (const triple of this._triples) {
      const text = `${triple.subject} ${triple.relation} ${triple.obj}`.toLowerCase();

      // Full query match
      let score = 0;
      if (text.includes(lower)) score += 1.0;

      // Individual term matches
      for (const term of terms) {
        if (text.includes(term)) score += 0.5;
      }

      if (score > 0) {
        matched.push({ triple, score });
      }
    }

    matched.sort((a, b) => b.score - a.score);
    return matched.slice(0, limit).map((m) => m.triple);
  }

  // ---------------------------------------------------------------------------
  // Memory interface
  // ---------------------------------------------------------------------------

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    // Extract triple from metadata or parse from content
    const subject = metadata?.subject as string | undefined;
    const relation = metadata?.relation as string | undefined;
    const obj = metadata?.object as string | undefined;

    if (subject && relation && obj) {
      await this.addRelation(subject, relation, obj);
      return `${subject}:${relation}:${obj}`;
    }

    // Parse from content: "subject relation object"
    const parts = content.split(/\s+/);
    if (parts.length >= 3) {
      const s = parts[0]!;
      const r = parts[1]!;
      const o = parts.slice(2).join(" ");
      await this.addRelation(s, r, o);
      return `${s}:${r}:${o}`;
    } else if (parts.length === 2) {
      await this.addRelation(parts[0]!, "related_to", parts[1]!);
      return `${parts[0]!}:related_to:${parts[1]!}`;
    } else {
      await this.addRelation(content, "is", "known");
      return `${content}:is:known`;
    }
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const triples = await this.query(query, limit);
    return triples.map(
      (t) =>
        new MemoryEntry({
          id: t.id,
          content: `${t.subject} ${t.relation} ${t.obj}`,
          metadata: t.metadata ?? {},
        }),
    );
  }

  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const triples = await this.query(query, 30);
    if (triples.length === 0) return "";

    const lines: string[] = ["[Knowledge Graph]"];
    let charBudget = maxTokens * 4;
    for (const t of triples) {
      const line = `- ${t.subject} --[${t.relation}]--> ${t.obj}`;
      if (charBudget - line.length < 0) break;
      charBudget -= line.length;
      lines.push(line);
    }
    return lines.join("\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    const triple = this._triples.find((t) => t.id === entryId);
    if (!triple) return undefined;
    return new MemoryEntry({
      id: triple.id,
      content: `${triple.subject} ${triple.relation} ${triple.obj}`,
      metadata: triple.metadata ?? {},
    });
  }

  async delete(entryId: string): Promise<boolean> {
    const idx = this._triples.findIndex((t) => t.id === entryId);
    if (idx < 0) return false;
    this._triples.splice(idx, 1);
    this._rebuildIndices();
    return true;
  }

  async clear(): Promise<void> {
    this._entities.clear();
    this._triples = [];
    this._bySubject.clear();
    this._byRelation.clear();
    this._byObject.clear();
  }

  async count(): Promise<number> {
    return this._triples.length;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private _appendIndex(map: Map<string, number[]>, key: string, idx: number): void {
    const arr = map.get(key);
    if (arr) {
      arr.push(idx);
    } else {
      map.set(key, [idx]);
    }
  }

  private _rebuildIndices(): void {
    this._bySubject.clear();
    this._byRelation.clear();
    this._byObject.clear();
    for (let i = 0; i < this._triples.length; i++) {
      const t = this._triples[i]!;
      this._appendIndex(this._bySubject, t.subject, i);
      this._appendIndex(this._byRelation, t.relation, i);
      this._appendIndex(this._byObject, t.obj, i);
    }
  }
}
