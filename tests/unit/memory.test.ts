import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { MemoryEntry } from "../../src/memory/base.js";
import { ConversationMemory } from "../../src/memory/conversation.js";
import { KeyValueMemory } from "../../src/memory/key-value.js";
import { WorkingMemory } from "../../src/memory/working.js";
import { EpisodicMemory, Episode } from "../../src/memory/episodic.js";
import { GraphMemory, Triple } from "../../src/memory/graph.js";
import { CompositeMemory } from "../../src/memory/composite.js";
import { SelfEditingMemory } from "../../src/memory/self-editing.js";
import { VectorMemory } from "../../src/memory/vector.js";
import { FileMemory } from "../../src/memory/file.js";
import { MemoryManager } from "../../src/memory/manager.js";
import {
  DefaultInjection,
  UserMessageInjection,
  NoInjection,
  DefaultSave,
  SaveEverythingStrategy,
  NoSave,
  PerIterationSave,
  DefaultQuery,
  KeywordQuery,
  AdaptiveTokenQuery,
  type MemorySaveStrategy,
} from "../../src/memory/strategies.js";
import {
  importanceScore,
  decayScore,
  combinedRelevance,
} from "../../src/memory/policies.js";
import { AgentState } from "../../src/core/state/state.js";

// ---------------------------------------------------------------------------
// MemoryEntry
// ---------------------------------------------------------------------------
describe("MemoryEntry", () => {
  it("creates with defaults", () => {
    const entry = new MemoryEntry();
    expect(entry.id).toBeTruthy();
    expect(entry.content).toBe("");
    expect(entry.relevance).toBe(0.0);
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it("round-trips through toDict/fromDict", () => {
    const entry = new MemoryEntry({ content: "hello", metadata: { key: "val" } });
    const dict = entry.toDict();
    const restored = MemoryEntry.fromDict(dict);
    expect(restored.content).toBe("hello");
    expect(restored.metadata.key).toBe("val");
    expect(restored.id).toBe(entry.id);
  });
});

// ---------------------------------------------------------------------------
// ConversationMemory
// ---------------------------------------------------------------------------
describe("ConversationMemory", () => {
  let mem: ConversationMemory;

  beforeEach(() => {
    mem = new ConversationMemory(5);
  });

  it("adds and retrieves entries", async () => {
    const id = await mem.add("test message");
    expect(id).toBeTruthy();
    const entry = await mem.get!(id);
    expect(entry?.content).toBe("test message");
  });

  it("evicts oldest on overflow", async () => {
    for (let i = 0; i < 7; i++) {
      await mem.add(`msg ${i}`);
    }
    expect(await mem.count!()).toBe(5);
    // oldest (msg 0, msg 1) should be gone
    const recent = mem.getRecent(5);
    expect(recent[0]?.content).toBe("msg 2");
  });

  it("searches by recency and keywords", async () => {
    await mem.add("the quick brown fox");
    await mem.add("lazy dog sleeps");
    await mem.add("quick fox jumps");
    const results = await mem.search("quick fox");
    expect(results[0]?.content).toContain("quick");
  });

  it("returns context string", async () => {
    await mem.add("hello world");
    const ctx = await mem.getContext("hello");
    expect(ctx).toContain("[Conversation Memory]");
    expect(ctx).toContain("hello world");
  });

  it("deletes entries", async () => {
    const id = await mem.add("to delete");
    expect(await mem.delete!(id)).toBe(true);
    expect(await mem.count!()).toBe(0);
  });

  it("clears all entries", async () => {
    await mem.add("a");
    await mem.add("b");
    await mem.clear!();
    expect(await mem.count!()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// KeyValueMemory
// ---------------------------------------------------------------------------
describe("KeyValueMemory", () => {
  let mem: KeyValueMemory;

  beforeEach(() => {
    mem = new KeyValueMemory();
  });

  it("sets and gets values", async () => {
    await mem.set("name", "Alice");
    expect(await mem.getValue("name")).toBe("Alice");
  });

  it("updates existing keys", async () => {
    await mem.set("name", "Alice");
    await mem.set("name", "Bob");
    expect(await mem.getValue("name")).toBe("Bob");
    expect(mem.keys()).toEqual(["name"]);
  });

  it("searches by key and content", async () => {
    await mem.set("color", "blue sky");
    await mem.set("food", "pizza");
    const results = await mem.search("color");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content).toBe("blue sky");
  });

  it("boosts exact key matches", async () => {
    await mem.set("test", "value1");
    await mem.add("test content", {});
    const results = await mem.search("test");
    // The one with key "test" should rank higher
    expect(results[0]?.id).toBe("test");
  });

  it("returns context", async () => {
    await mem.set("k1", "v1");
    const ctx = await mem.getContext("k1");
    expect(ctx).toContain("[Stored Facts]");
  });
});

// ---------------------------------------------------------------------------
// WorkingMemory
// ---------------------------------------------------------------------------
describe("WorkingMemory", () => {
  let mem: WorkingMemory;

  beforeEach(() => {
    mem = new WorkingMemory();
  });

  it("writes and reads", async () => {
    await mem.write("goal", "solve the puzzle");
    expect(await mem.read("goal")).toBe("solve the puzzle");
  });

  it("returns all entries in context regardless of query", async () => {
    await mem.write("a", "1");
    await mem.write("b", "2");
    const ctx = await mem.getContext("irrelevant");
    expect(ctx).toContain("[Working Memory]");
    expect(ctx).toContain("a: 1");
    expect(ctx).toContain("b: 2");
  });

  it("clears everything", async () => {
    await mem.write("x", "y");
    await mem.clear!();
    expect(await mem.count!()).toBe(0);
    expect(await mem.read("x")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EpisodicMemory
// ---------------------------------------------------------------------------
describe("EpisodicMemory", () => {
  let mem: EpisodicMemory;

  beforeEach(() => {
    mem = new EpisodicMemory(10);
  });

  it("records and recalls episodes", async () => {
    const ep = new Episode({ content: "user asked about weather", importance: 0.8 });
    const id = await mem.recordEpisode(ep);
    const results = await mem.recall("weather");
    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe(id);
  });

  it("ranks by importance and keyword", async () => {
    await mem.add("low importance item", { importance: 0.1 });
    await mem.add("high importance item", { importance: 0.9 });
    const results = await mem.recall("item", 2);
    expect(results.length).toBe(2);
    // Higher importance should rank first (both match keywords equally)
    expect(results[0]?.importance).toBe(0.9);
  });

  it("filters by time range", async () => {
    const old = new Episode({ content: "old event", createdAt: new Date("2020-01-01") });
    const recent = new Episode({ content: "recent event", createdAt: new Date("2025-06-01") });
    await mem.recordEpisode(old);
    await mem.recordEpisode(recent);

    const results = await mem.recall("event", 10, [new Date("2024-01-01"), new Date("2026-01-01")]);
    expect(results.length).toBe(1);
    expect(results[0]?.content).toBe("recent event");
  });

  it("evicts oldest beyond capacity", async () => {
    const smallMem = new EpisodicMemory(3);
    for (let i = 0; i < 5; i++) {
      await smallMem.add(`ep ${i}`);
    }
    expect(await smallMem.count!()).toBe(3);
  });

  it("Episode round-trips through toDict/fromDict", () => {
    const ep = new Episode({ content: "test", importance: 0.7, summary: "s" });
    const dict = ep.toDict();
    const restored = Episode.fromDict(dict);
    expect(restored.content).toBe("test");
    expect(restored.importance).toBe(0.7);
    expect(restored.summary).toBe("s");
  });
});

// ---------------------------------------------------------------------------
// GraphMemory
// ---------------------------------------------------------------------------
describe("GraphMemory", () => {
  let mem: GraphMemory;

  beforeEach(() => {
    mem = new GraphMemory();
  });

  it("adds entities and relations", async () => {
    await mem.addEntity("Alice", { type: "person" });
    await mem.addRelation("Alice", "knows", "Bob");
    expect(await mem.count!()).toBe(1);
  });

  it("queries triples", async () => {
    await mem.addRelation("Alice", "knows", "Bob");
    await mem.addRelation("Bob", "works_at", "Acme");
    const results = await mem.query("Alice");
    expect(results.length).toBe(1);
    expect(results[0]?.subject).toBe("Alice");
  });

  it("adds via content parsing", async () => {
    await mem.add("Paris capital France");
    const results = await mem.query("Paris");
    expect(results.length).toBe(1);
    expect(results[0]?.subject).toBe("Paris");
    expect(results[0]?.relation).toBe("capital");
  });

  it("adds via metadata", async () => {
    await mem.add("", { subject: "Earth", relation: "orbits", object: "Sun" });
    const results = await mem.query("Earth");
    expect(results.length).toBe(1);
    expect(results[0]?.obj).toBe("Sun");
  });

  it("Triple round-trips", () => {
    const t = new Triple("A", "rel", "B", { note: "test" });
    const dict = t.toDict();
    const restored = Triple.fromDict(dict);
    expect(restored.subject).toBe("A");
    expect(restored.id).toBe("A:rel:B");
  });

  it("returns graph context", async () => {
    await mem.addRelation("X", "links", "Y");
    const ctx = await mem.getContext("X");
    expect(ctx).toContain("[Knowledge Graph]");
    expect(ctx).toContain("X --[links]--> Y");
  });
});

// ---------------------------------------------------------------------------
// CompositeMemory
// ---------------------------------------------------------------------------
describe("CompositeMemory", () => {
  it("routes adds to all backends", async () => {
    const conv = new ConversationMemory();
    const kv = new KeyValueMemory();
    const composite = new CompositeMemory({ conv, kv });

    await composite.add("shared fact");
    expect(await conv.count!()).toBe(1);
    expect(await kv.count!()).toBe(1);
  });

  it("respects memory_targets metadata", async () => {
    const conv = new ConversationMemory();
    const kv = new KeyValueMemory();
    const composite = new CompositeMemory({ conv, kv });

    await composite.add("only conv", { memoryTargets: ["conv"] });
    expect(await conv.count!()).toBe(1);
    expect(await kv.count!()).toBe(0);
  });

  it("merges search results", async () => {
    const conv = new ConversationMemory();
    const kv = new KeyValueMemory();
    const composite = new CompositeMemory({ conv, kv });

    await conv.add("hello from conv");
    await kv.add("hello from kv");
    const results = await composite.search("hello");
    expect(results.length).toBe(2);
  });

  it("deduplicates search by content", async () => {
    const m1 = new ConversationMemory();
    const m2 = new ConversationMemory();
    const composite = new CompositeMemory({ m1, m2 });

    // Same content in both
    await composite.add("duplicate");
    const results = await composite.search("duplicate");
    expect(results.length).toBe(1);
  });

  it("gets specific sub-memory", () => {
    const conv = new ConversationMemory();
    const composite = new CompositeMemory({ conv });
    expect(composite.getMemory("conv")).toBe(conv);
  });

  it("counts across all backends", async () => {
    const m1 = new ConversationMemory();
    const m2 = new KeyValueMemory();
    const composite = new CompositeMemory({ m1, m2 });
    await m1.add("a");
    await m2.add("b");
    expect(await composite.count!()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SelfEditingMemory
// ---------------------------------------------------------------------------
describe("SelfEditingMemory", () => {
  let mem: SelfEditingMemory;

  beforeEach(() => {
    mem = new SelfEditingMemory({ maxCoreChars: 100 });
  });

  it("starts with empty core memory", () => {
    expect(mem.coreMemory).toBe("");
  });

  it("provides tools", () => {
    const tools = mem.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("core_memory_read");
    expect(names).toContain("core_memory_write");
    expect(names).toContain("core_memory_replace");
    expect(names).toContain("archival_memory_search");
    expect(names).toContain("archival_memory_insert");
  });

  it("core write and read via tools", async () => {
    const tools = mem.getTools();
    const write = tools.find((t) => t.name === "core_memory_write")!;
    const read = tools.find((t) => t.name === "core_memory_read")!;

    await write.execute({ addition: "User likes cats." });
    const result = await read.execute({});
    expect(result).toContain("User likes cats.");
  });

  it("core replace via tools", async () => {
    const tools = mem.getTools();
    const write = tools.find((t) => t.name === "core_memory_write")!;
    const replace = tools.find((t) => t.name === "core_memory_replace")!;

    await write.execute({ addition: "User likes cats." });
    await replace.execute({ old: "cats", new: "dogs" });
    expect(mem.coreMemory).toBe("User likes dogs.");
  });

  it("enforces core memory char limit", async () => {
    const tools = mem.getTools();
    const write = tools.find((t) => t.name === "core_memory_write")!;
    const result = await write.execute({ addition: "x".repeat(200) });
    expect(result).toContain("exceed");
  });

  it("archival insert and search via tools", async () => {
    const tools = mem.getTools();
    const insert = tools.find((t) => t.name === "archival_memory_insert")!;
    const search = tools.find((t) => t.name === "archival_memory_search")!;

    await insert.execute({ content: "important fact about TypeScript" });
    const result = await search.execute({ query: "TypeScript" });
    expect(result).toContain("TypeScript");
  });

  it("includes core memory in context", async () => {
    const tools = mem.getTools();
    const write = tools.find((t) => t.name === "core_memory_write")!;
    await write.execute({ addition: "Core info." });

    const ctx = await mem.getContext("anything");
    expect(ctx).toContain("[Core Memory]");
    expect(ctx).toContain("Core info.");
  });
});

// ---------------------------------------------------------------------------
// VectorMemory (with simple hash embedding fallback)
// ---------------------------------------------------------------------------
describe("VectorMemory", () => {
  let mem: VectorMemory;

  // Use simple deterministic embedding for testing
  const simpleEmbed = async (texts: string[]): Promise<number[][]> => {
    return texts.map((t) => {
      const vec = new Array(8).fill(0);
      for (let i = 0; i < t.length; i++) {
        vec[i % 8]! += t.charCodeAt(i) / 256;
      }
      return vec as number[];
    });
  };

  beforeEach(() => {
    mem = new VectorMemory({ embeddingFn: simpleEmbed });
  });

  it("adds and searches", async () => {
    await mem.startup();
    await mem.add("TypeScript is great");
    await mem.add("Python is versatile");
    const results = await mem.search("TypeScript", 1);
    expect(results.length).toBe(1);
    expect(results[0]?.content).toContain("TypeScript");
    await mem.shutdown();
  });

  it("batch add", async () => {
    await mem.startup();
    const ids = await mem.addBatch([
      { content: "first" },
      { content: "second" },
      { content: "third" },
    ]);
    expect(ids.length).toBe(3);
    expect(await mem.count!()).toBe(3);
    await mem.shutdown();
  });

  it("deletes and clears", async () => {
    await mem.startup();
    const id = await mem.add("to delete");
    expect(await mem.delete!(id)).toBe(true);
    expect(await mem.count!()).toBe(0);
    await mem.shutdown();
  });

  it("returns context with relevance scores", async () => {
    await mem.startup();
    await mem.add("contextual data");
    const ctx = await mem.getContext("contextual");
    expect(ctx).toContain("[Relevant Memories]");
    expect(ctx).toContain("relevance:");
    await mem.shutdown();
  });
});

// ---------------------------------------------------------------------------
// FileMemory
// ---------------------------------------------------------------------------
describe("FileMemory", () => {
  let mem: FileMemory;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "curio-test-"));
    mem = new FileMemory({ memoryDir: tmpDir });
    await mem.startup();
  });

  afterEach(async () => {
    await mem.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("adds and retrieves from disk", async () => {
    const id = await mem.add("persisted data");
    const entry = await mem.get!(id);
    expect(entry?.content).toBe("persisted data");
  });

  it("survives restart", async () => {
    const id = await mem.add("survive restart");
    await mem.shutdown();

    const mem2 = new FileMemory({ memoryDir: tmpDir });
    await mem2.startup();
    const entry = await mem2.get!(id);
    expect(entry?.content).toBe("survive restart");
    await mem2.shutdown();
  });

  it("searches files by keywords", async () => {
    await mem.add("alpha beta");
    await mem.add("gamma delta");
    const results = await mem.search("alpha");
    expect(results.length).toBe(1);
    expect(results[0]?.content).toBe("alpha beta");
  });

  it("deletes entries from disk", async () => {
    const id = await mem.add("temp");
    expect(await mem.delete!(id)).toBe(true);
    expect(await mem.count!()).toBe(0);
  });

  it("clears all entries", async () => {
    await mem.add("a");
    await mem.add("b");
    await mem.clear!();
    expect(await mem.count!()).toBe(0);
  });

  it("namespace scoping", async () => {
    await mem.shutdown();
    const nsDir = tmpDir;
    const nsMem = new FileMemory({ memoryDir: nsDir, namespace: "project1" });
    await nsMem.startup();
    await nsMem.add("scoped data");
    expect(await nsMem.count!()).toBe(1);
    await nsMem.shutdown();

    // Root should not see namespace entries
    const rootMem = new FileMemory({ memoryDir: nsDir });
    await rootMem.startup();
    expect(await rootMem.count!()).toBe(0);
    await rootMem.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------
describe("Strategies", () => {
  describe("Injection strategies", () => {
    it("DefaultInjection inserts system message", async () => {
      const conv = new ConversationMemory();
      await conv.add("relevant info about cats");
      const strategy = new DefaultInjection();
      const state = new AgentState({
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Tell me about cats" },
        ],
      });
      await strategy.inject(state, conv, "cats");
      expect(state.messages.length).toBe(3);
      expect(state.messages[1]?.role).toBe("system");
      expect(state.messages[1]?.content).toContain("cats");
    });

    it("UserMessageInjection appends to last user message", async () => {
      const conv = new ConversationMemory();
      await conv.add("memory about dogs");
      const strategy = new UserMessageInjection();
      const state = new AgentState({
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "Tell me about dogs" },
        ],
      });
      await strategy.inject(state, conv, "dogs");
      expect(state.messages.length).toBe(2);
      expect((state.messages[1]?.content as string)).toContain("Context from memory:");
    });

    it("NoInjection does nothing", async () => {
      const strategy = new NoInjection();
      const state = new AgentState({
        messages: [{ role: "user", content: "hi" }],
      });
      await strategy.inject(state, new ConversationMemory(), "hi");
      expect(state.messages.length).toBe(1);
    });
  });

  describe("Save strategies", () => {
    it("DefaultSave stores input and output", async () => {
      const mem = new ConversationMemory();
      const strategy = new DefaultSave();
      const state = new AgentState({});
      await strategy.onRunEnd(mem, "user says hi", "assistant says hello", state);
      expect(await mem.count!()).toBe(2);
    });

    it("SaveEverythingStrategy also saves tool results", async () => {
      const mem = new ConversationMemory();
      const strategy = new SaveEverythingStrategy();
      const state = new AgentState({});
      await strategy.onToolResult!(mem, "search", { q: "test" }, "found it", state);
      expect(await mem.count!()).toBe(1);
      const entries = await mem.search("search");
      expect(entries[0]?.content).toContain("Tool 'search'");
    });

    it("PerIterationSave saves iteration snapshots", async () => {
      const mem = new ConversationMemory();
      const strategy = new PerIterationSave();
      const state = new AgentState({
        messages: [{ role: "assistant", content: "iteration output" }],
      });
      await strategy.onIteration!(mem, state, 1);
      expect(await mem.count!()).toBe(1);
    });

    it("NoSave has no methods", () => {
      const strategy = new NoSave() as MemorySaveStrategy;
      expect(strategy.onRunEnd).toBeUndefined();
    });
  });

  describe("Query strategies", () => {
    it("DefaultQuery returns raw input", async () => {
      const strategy = new DefaultQuery(3000);
      const state = new AgentState({});
      expect(await strategy.buildQuery("hello world")).toBe("hello world");
      expect(strategy.maxTokens()).toBe(3000);
    });

    it("KeywordQuery strips stop words", async () => {
      const strategy = new KeywordQuery();
      const state = new AgentState({});
      const query = await strategy.buildQuery("what is the weather in Paris");
      const words = query.split(/\s+/);
      expect(words).not.toContain("what");
      expect(words).not.toContain("the");
      expect(words).not.toContain("is");
      expect(words).toContain("weather");
      expect(words).toContain("paris");
    });

    it("AdaptiveTokenQuery decreases budget with messages", () => {
      const strategy = new AdaptiveTokenQuery({
        baseTokens: 4000,
        minTokens: 500,
        decayPerMessage: 100,
      });
      const shortState = new AgentState({ messages: [] });
      const longState = new AgentState({
        messages: Array(30).fill({ role: "user" as const, content: "" }),
      });
      expect(strategy.maxTokens(shortState)).toBe(4000);
      expect(strategy.maxTokens(longState)).toBe(1000);
    });
  });
});

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------
describe("MemoryManager", () => {
  it("provides agent tools", () => {
    const manager = new MemoryManager({ memory: new ConversationMemory() });
    const tools = manager.getTools();
    expect(tools.length).toBe(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain("save_to_memory");
    expect(names).toContain("search_memory");
    expect(names).toContain("forget_memory");
  });

  it("injects memory into state", async () => {
    const mem = new ConversationMemory();
    await mem.add("remembered fact about TypeScript");
    const manager = new MemoryManager({ memory: mem });
    const state = new AgentState({
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Tell me about TypeScript" },
      ],
    });
    await manager.inject(state, "TypeScript");
    // Should have injected a memory system message
    expect(state.messages.length).toBe(3);
  });

  it("delegates lifecycle to Component memory", async () => {
    const vectorMem = new VectorMemory({
      embeddingFn: async (texts) => texts.map(() => [1, 0, 0]),
    });
    const manager = new MemoryManager({ memory: vectorMem });
    await manager.startup();
    expect(manager.initialized).toBe(true);
    await manager.shutdown();
  });

  it("save_to_memory tool stores entries", async () => {
    const mem = new ConversationMemory();
    const manager = new MemoryManager({ memory: mem });
    const tool = manager.getTools().find((t) => t.name === "save_to_memory")!;
    const result = await tool.execute({ content: "important info", tags: "test,info" });
    expect(result).toContain("Saved to memory");
    expect(await mem.count!()).toBe(1);
  });

  it("search_memory tool searches", async () => {
    const mem = new ConversationMemory();
    await mem.add("TypeScript is great");
    const manager = new MemoryManager({ memory: mem });
    const tool = manager.getTools().find((t) => t.name === "search_memory")!;
    const result = await tool.execute({ query: "TypeScript" });
    expect(result).toContain("TypeScript");
  });

  it("forget_memory tool deletes", async () => {
    const mem = new ConversationMemory();
    const id = await mem.add("temp");
    const manager = new MemoryManager({ memory: mem });
    const tool = manager.getTools().find((t) => t.name === "forget_memory")!;
    const result = await tool.execute({ entryId: id });
    expect(result).toContain("Deleted");
    expect(await mem.count!()).toBe(0);
  });

  it("onRunEnd delegates to save strategy", async () => {
    const mem = new ConversationMemory();
    const manager = new MemoryManager({ memory: mem }); // DefaultSave
    const state = new AgentState({});
    await manager.onRunEnd("input", "output", state);
    expect(await mem.count!()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------
describe("Policies", () => {
  it("importanceScore reads from metadata", () => {
    const entry = new MemoryEntry({ metadata: { importance: 0.8 } });
    expect(importanceScore(entry)).toBe(0.8);
  });

  it("importanceScore clamps to [0, 1]", () => {
    const entry = new MemoryEntry({ metadata: { importance: 5.0 } });
    expect(importanceScore(entry)).toBe(1.0);
  });

  it("importanceScore returns default", () => {
    const entry = new MemoryEntry();
    expect(importanceScore(entry, 0.3)).toBe(0.3);
  });

  it("decayScore returns 1.0 for now", () => {
    const now = new Date();
    const entry = new MemoryEntry({ createdAt: now });
    expect(decayScore(entry, { now })).toBeCloseTo(1.0, 2);
  });

  it("decayScore decays over time", () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const entry = new MemoryEntry({ createdAt: thirtyDaysAgo });
    // With 30-day half-life, score at 30 days ≈ 0.5
    expect(decayScore(entry, { now, halfLifeDays: 30 })).toBeCloseTo(0.5, 1);
  });

  it("combinedRelevance blends scores", () => {
    const entry = new MemoryEntry({ metadata: { importance: 1.0 } });
    const score = combinedRelevance(1.0, entry, { now: entry.createdAt });
    // With base=1.0, importance=1.0, decay≈1.0: weighted sum ≈ 1.0
    expect(score).toBeCloseTo(1.0, 1);
  });
});
