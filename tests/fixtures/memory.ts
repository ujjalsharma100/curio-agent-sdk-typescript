/**
 * Memory seed helpers for tests requiring pre-populated memory.
 */
import { ConversationMemory } from "../../src/memory/conversation.js";
import { KeyValueMemory } from "../../src/memory/key-value.js";
import { CompositeMemory } from "../../src/memory/composite.js";
import { MemoryManager } from "../../src/memory/manager.js";

/** Create a ConversationMemory pre-seeded with entries. */
export async function seededConversationMemory(
  entries: string[],
  maxEntries = 100,
): Promise<ConversationMemory> {
  const mem = new ConversationMemory(maxEntries);
  for (const content of entries) {
    await mem.add(content);
  }
  return mem;
}

/** Create a KeyValueMemory pre-seeded with key/value pairs. */
export async function seededKeyValueMemory(
  pairs: Record<string, string>,
): Promise<KeyValueMemory> {
  const mem = new KeyValueMemory();
  for (const [key, value] of Object.entries(pairs)) {
    await mem.set(key, value);
  }
  return mem;
}

/** Create a CompositeMemory with conversation + KV backends. */
export async function seededCompositeMemory(options: {
  conversationEntries?: string[];
  kvPairs?: Record<string, string>;
} = {}): Promise<CompositeMemory> {
  const conversation = await seededConversationMemory(options.conversationEntries ?? []);
  const kv = await seededKeyValueMemory(options.kvPairs ?? {});
  return new CompositeMemory({ conversation, kv });
}

/** Create a MemoryManager wrapping a seeded ConversationMemory. */
export async function seededMemoryManager(
  entries: string[] = [],
  maxEntries = 100,
): Promise<MemoryManager> {
  const mem = await seededConversationMemory(entries, maxEntries);
  return new MemoryManager({ memory: mem });
}
