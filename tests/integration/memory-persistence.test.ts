/**
 * Integration: Memory persistence and retrieval
 *
 * Verifies that memory backends persist, search, and manage entries correctly.
 */
import { describe, it, expect } from "vitest";
import { ConversationMemory } from "../../src/memory/conversation.js";
import { KeyValueMemory } from "../../src/memory/key-value.js";
import { CompositeMemory } from "../../src/memory/composite.js";
import { MemoryManager } from "../../src/memory/manager.js";

describe("memory persistence", () => {
  describe("ConversationMemory", () => {
    it("should add and search entries", async () => {
      const mem = new ConversationMemory(100);
      await mem.add("User likes TypeScript");
      await mem.add("User prefers dark mode");
      await mem.add("User's favorite color is blue");

      const results = await mem.search("TypeScript", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("TypeScript");
    });

    it("should evict oldest entries when capacity is reached", async () => {
      const mem = new ConversationMemory(3);
      await mem.add("entry-1");
      await mem.add("entry-2");
      await mem.add("entry-3");
      await mem.add("entry-4");

      const count = await mem.count();
      expect(count).toBe(3);

      // entry-1 should have been evicted
      const results = await mem.search("entry-1", 10);
      const hasEntry1 = results.some((r) => r.content === "entry-1");
      expect(hasEntry1).toBe(false);
    });

    it("should delete entries by ID", async () => {
      const mem = new ConversationMemory();
      const id = await mem.add("to-delete");
      expect(await mem.count()).toBe(1);

      const deleted = await mem.delete(id);
      expect(deleted).toBe(true);
      expect(await mem.count()).toBe(0);
    });

    it("should clear all entries", async () => {
      const mem = new ConversationMemory();
      await mem.add("a");
      await mem.add("b");
      await mem.clear();
      expect(await mem.count()).toBe(0);
    });
  });

  describe("KeyValueMemory", () => {
    it("should set and get values by key", async () => {
      const mem = new KeyValueMemory();
      await mem.set("name", "Alice");
      const value = await mem.getValue("name");
      expect(value).toBe("Alice");
    });

    it("should update existing keys", async () => {
      const mem = new KeyValueMemory();
      await mem.set("count", "1");
      await mem.set("count", "2");
      expect(await mem.getValue("count")).toBe("2");
      expect(await mem.count()).toBe(1);
    });

    it("should search across keys and values", async () => {
      const mem = new KeyValueMemory();
      await mem.set("user_name", "Alice");
      await mem.set("user_age", "30");
      await mem.set("favorite_color", "blue");

      const results = await mem.search("user", 10);
      expect(results.length).toBe(2);
    });
  });

  describe("CompositeMemory", () => {
    it("should add to all backends", async () => {
      const conv = new ConversationMemory();
      const kv = new KeyValueMemory();
      const composite = new CompositeMemory({ conversation: conv, kv });

      await composite.add("test entry");
      expect(await conv.count()).toBe(1);
      expect(await kv.count()).toBe(1);
    });

    it("should merge search results from all backends", async () => {
      const conv = new ConversationMemory();
      const kv = new KeyValueMemory();
      await conv.add("Conversation about TypeScript");
      await kv.set("language", "TypeScript is great");

      const composite = new CompositeMemory({ conversation: conv, kv });
      const results = await composite.search("TypeScript", 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should get total count across backends", async () => {
      const conv = new ConversationMemory();
      const kv = new KeyValueMemory();
      await conv.add("a");
      await kv.set("b", "c");

      const composite = new CompositeMemory({ conversation: conv, kv });
      expect(await composite.count()).toBe(2);
    });
  });

  describe("MemoryManager", () => {
    it("should provide memory tools", () => {
      const manager = new MemoryManager({ memory: new ConversationMemory() });
      const tools = manager.getTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("save_to_memory");
      expect(names).toContain("search_memory");
      expect(names).toContain("forget_memory");
    });

    it("should delegate add/search to underlying memory", async () => {
      const manager = new MemoryManager({ memory: new ConversationMemory() });
      await manager.add("test content");
      const results = await manager.search("test", 5);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
