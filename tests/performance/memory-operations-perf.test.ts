import { describe, it, expect } from "vitest";
import { ConversationMemory } from "../../src/memory/conversation.js";
import { KeyValueMemory } from "../../src/memory/key-value.js";

describe("Performance: Memory operations", () => {
  it("adds 1000 conversation memory entries in under 5000ms", async () => {
    const memory = new ConversationMemory(2000);

    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      // eslint-disable-next-line no-await-in-loop
      await memory.add(`Entry number ${i} with some content about topic ${i % 10}`);
    }
    const elapsedMs = performance.now() - start;

    const count = await memory.count();
    expect(count).toBe(iterations);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("performs 1000 conversation memory searches in under 5000ms", async () => {
    const memory = new ConversationMemory(500);

    for (let i = 0; i < 500; i++) {
      // eslint-disable-next-line no-await-in-loop
      await memory.add(`Topic ${i % 20}: detail about item ${i}`, {
        category: `cat_${i % 10}`,
      });
    }

    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      // eslint-disable-next-line no-await-in-loop
      const results = await memory.search(`Topic ${i % 20}`, 5);
      expect(Array.isArray(results)).toBe(true);
    }
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(5000);
  });

  it("performs 1000 KV set + 1000 KV get operations in under 5000ms", async () => {
    const kv = new KeyValueMemory();

    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      // eslint-disable-next-line no-await-in-loop
      await kv.set(`key_${i}`, `value_${i}`);
    }

    for (let i = 0; i < iterations; i++) {
      // eslint-disable-next-line no-await-in-loop
      const val = await kv.getValue(`key_${i}`);
      expect(val).toBe(`value_${i}`);
    }

    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(5000);
  });
});

