// Base
export { MemoryEntry } from "./base.js";
export type { Memory } from "./base.js";

// Backends
export { ConversationMemory } from "./conversation.js";
export { VectorMemory } from "./vector.js";
export type { EmbeddingFn } from "./vector.js";
export { KeyValueMemory } from "./key-value.js";
export { CompositeMemory } from "./composite.js";
export { WorkingMemory } from "./working.js";
export { EpisodicMemory, Episode } from "./episodic.js";
export { GraphMemory, Triple } from "./graph.js";
export { SelfEditingMemory } from "./self-editing.js";
export { FileMemory } from "./file.js";

// Manager & Strategies
export { MemoryManager } from "./manager.js";
export type {
  MemoryInjectionStrategy,
  MemorySaveStrategy,
  MemoryQueryStrategy,
} from "./strategies.js";
export {
  DefaultInjection,
  UserMessageInjection,
  NoInjection,
  DefaultSave,
  SaveEverythingStrategy,
  SaveSummaryStrategy,
  NoSave,
  PerIterationSave,
  DefaultQuery,
  KeywordQuery,
  AdaptiveTokenQuery,
} from "./strategies.js";

// Policies
export {
  importanceScore,
  decayScore,
  combinedRelevance,
  summarizeOldMemories,
} from "./policies.js";
