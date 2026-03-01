/**
 * Session and conversation management.
 *
 * Provides persistent conversation sessions with history management,
 * session persistence, and optional conversation branching.
 */

import type { Message } from "../../models/llm.js";
import {
  serializeMessage,
  deserializeMessage,
  type SerializedMessage,
} from "./checkpoint.js";

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** A persistent conversation session (metadata and identity). */
export interface Session {
  id: string;
  agentId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Update the updatedAt timestamp of a session. */
export function touchSession(session: Session): void {
  (session as { updatedAt: Date }).updatedAt = new Date();
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

/** Abstract backend for persisting sessions and their messages. */
export interface SessionStore {
  /** Create a new session for the given agent. */
  create(agentId: string, metadata?: Record<string, unknown>): Promise<Session>;

  /** Get a session by ID. Returns null if not found. */
  get(sessionId: string): Promise<Session | null>;

  /** List sessions for an agent (most recent first). */
  list(agentId?: string, limit?: number): Promise<Session[]>;

  /** Delete a session and its message history. Returns true if deleted. */
  delete(sessionId: string): Promise<boolean>;

  /** Append a message to the session's conversation history. */
  addMessage(sessionId: string, message: Message): Promise<void>;

  /** Get the most recent messages for a session (oldest first, up to limit). */
  getMessages(sessionId: string, limit?: number): Promise<Message[]>;
}

// ---------------------------------------------------------------------------
// InMemorySessionStore
// ---------------------------------------------------------------------------

/** In-memory session store; sessions and messages are lost when the process exits. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Map<string, SerializedMessage[]>();

  async create(
    agentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<Session> {
    const id = crypto.randomUUID?.() ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date();
    const session: Session = {
      id,
      agentId,
      metadata: metadata ? { ...metadata } : {},
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    this.messages.set(id, []);
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async list(agentId?: string, limit = 50): Promise<Session[]> {
    let list = Array.from(this.sessions.values());
    if (agentId != null) {
      list = list.filter((s) => s.agentId === agentId);
    }
    list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return list.slice(0, limit);
  }

  async delete(sessionId: string): Promise<boolean> {
    const had = this.sessions.has(sessionId);
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
    return had;
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    const list = this.messages.get(sessionId);
    if (!list) return;
    list.push(serializeMessage(message));
    const session = this.sessions.get(sessionId);
    if (session) touchSession(session);
  }

  async getMessages(sessionId: string, limit = 50): Promise<Message[]> {
    const list = this.messages.get(sessionId) ?? [];
    const slice = limit ? list.slice(-limit) : list;
    return slice.map((m) => deserializeMessage(m));
  }
}

// ---------------------------------------------------------------------------
// FileSessionStore
// ---------------------------------------------------------------------------

/** File-based session store; one directory per session, messages in a JSON file. */
export class FileSessionStore implements SessionStore {
  private readonly baseDir: string;

  constructor(directory: string) {
    this.baseDir = directory;
  }

  private sessionPath(sessionId: string): string {
    const safe = sessionId.replace(/\//g, "_").replace(/\\/g, "_");
    return `${this.baseDir}/${safe}`;
  }

  private metaPath(sessionId: string): string {
    return `${this.sessionPath(sessionId)}/meta.json`;
  }

  private messagesPath(sessionId: string): string {
    return `${this.sessionPath(sessionId)}/messages.json`;
  }

  async create(
    agentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<Session> {
    const id = crypto.randomUUID?.() ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date();
    const session: Session = {
      id,
      agentId,
      metadata: metadata ? { ...metadata } : {},
      createdAt: now,
      updatedAt: now,
    };
    const fs = await import("node:fs/promises");
    const dir = this.sessionPath(id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.metaPath(id),
      JSON.stringify({
        ...session,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      }),
      "utf8",
    );
    await fs.writeFile(this.messagesPath(id), "[]", "utf8");
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    const fs = await import("node:fs/promises");
    try {
      const raw = await fs.readFile(this.metaPath(sessionId), "utf8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      return {
        id: data.id as string,
        agentId: data.agentId as string,
        metadata: (data.metadata as Record<string, unknown>) ?? {},
        createdAt: new Date(data.createdAt as string),
        updatedAt: new Date(data.updatedAt as string),
      };
    } catch {
      return null;
    }
  }

  async list(agentId?: string, limit = 50): Promise<Session[]> {
    const fs = await import("node:fs/promises");
    let names: string[];
    try {
      names = await fs.readdir(this.baseDir);
    } catch {
      return [];
    }
    const sessions: Session[] = [];
    for (const name of names) {
      const session = await this.get(name);
      if (session && (agentId == null || session.agentId === agentId)) {
        sessions.push(session);
      }
    }
    sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return sessions.slice(0, limit);
  }

  async delete(sessionId: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    const dir = this.sessionPath(sessionId);
    try {
      await fs.rm(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = this.messagesPath(sessionId);
    let list: SerializedMessage[];
    try {
      const raw = await fs.readFile(path, "utf8");
      list = JSON.parse(raw) as SerializedMessage[];
    } catch {
      list = [];
    }
    list.push(serializeMessage(message));
    await fs.writeFile(path, JSON.stringify(list), "utf8");
    const session = await this.get(sessionId);
    if (session) {
      touchSession(session);
      await fs.writeFile(
        this.metaPath(sessionId),
        JSON.stringify({
          ...session,
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
        }),
        "utf8",
      );
    }
  }

  async getMessages(sessionId: string, limit = 50): Promise<Message[]> {
    const fs = await import("node:fs/promises");
    try {
      const raw = await fs.readFile(this.messagesPath(sessionId), "utf8");
      const list = JSON.parse(raw) as SerializedMessage[];
      const slice = limit ? list.slice(-limit) : list;
      return slice.map((m) => deserializeMessage(m));
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/** Manages conversation sessions with a pluggable store. */
export class SessionManager {
  constructor(private readonly store: SessionStore) {}

  /** The underlying session store. */
  getStore(): SessionStore {
    return this.store;
  }

  /** Create a new session for the given agent. */
  async create(agentId: string, metadata?: Record<string, unknown>): Promise<Session> {
    return this.store.create(agentId, metadata);
  }

  /** Get a session by ID. Throws if not found. */
  async get(sessionId: string): Promise<Session> {
    const session = await this.store.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  /** List sessions for an agent (most recent first). */
  async listSessions(agentId?: string, limit = 50): Promise<Session[]> {
    return this.store.list(agentId, limit);
  }

  /** Delete a session and its message history. */
  async delete(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  /** Append a message to a session's conversation history. */
  async addMessage(sessionId: string, message: Message): Promise<void> {
    await this.store.addMessage(sessionId, message);
  }

  /** Get the most recent messages for a session (oldest first). */
  async getMessages(sessionId: string, limit = 50): Promise<Message[]> {
    return this.store.getMessages(sessionId, limit);
  }
}
