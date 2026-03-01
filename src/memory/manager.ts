import { z } from "zod";
import { Component } from "../base/component.js";
import { createTool, type Tool } from "../core/tools/tool.js";
import type { AgentState } from "../core/state/state.js";
import type { Memory, MemoryEntry } from "./base.js";
import {
  type MemoryInjectionStrategy,
  type MemorySaveStrategy,
  type MemoryQueryStrategy,
  DefaultInjection,
  DefaultSave,
  DefaultQuery,
} from "./strategies.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("memory-manager");

/**
 * Orchestrates memory lifecycle: injection, saving, querying.
 * Exposes agent tools for self-managed memory.
 */
export class MemoryManager extends Component {
  readonly memory: Memory;
  private readonly injectionStrategy: MemoryInjectionStrategy;
  private readonly saveStrategy: MemorySaveStrategy;
  private readonly queryStrategy: MemoryQueryStrategy;
  readonly namespace?: string;

  constructor(options: {
    memory: Memory;
    injectionStrategy?: MemoryInjectionStrategy;
    saveStrategy?: MemorySaveStrategy;
    queryStrategy?: MemoryQueryStrategy;
    namespace?: string;
  }) {
    super();
    this.memory = options.memory;
    this.injectionStrategy = options.injectionStrategy ?? new DefaultInjection();
    this.saveStrategy = options.saveStrategy ?? new DefaultSave();
    this.queryStrategy = options.queryStrategy ?? new DefaultQuery();
    this.namespace = options.namespace;
  }

  // ---------------------------------------------------------------------------
  // Component lifecycle (delegate to memory if it's a Component)
  // ---------------------------------------------------------------------------

  async startup(): Promise<void> {
    if (isComponent(this.memory)) {
      await this.memory.startup();
    }
    this.markInitialized();
    logger.debug("MemoryManager started");
  }

  async shutdown(): Promise<void> {
    if (isComponent(this.memory)) {
      await this.memory.shutdown();
    }
    this.markShutdown();
    logger.debug("MemoryManager shut down");
  }

  async healthCheck(): Promise<boolean> {
    if (isComponent(this.memory)) {
      return this.memory.healthCheck();
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks called by Runtime
  // ---------------------------------------------------------------------------

  async inject(state: AgentState, inputText: string): Promise<void> {
    const query = await this.queryStrategy.buildQuery(inputText, state);
    await this.injectionStrategy.inject(state, this.memory, query);
  }

  async onRunStart(inputText: string, state: AgentState): Promise<void> {
    if (this.saveStrategy.onRunStart) {
      await this.saveStrategy.onRunStart(this.memory, inputText, state);
    }
  }

  async onRunEnd(
    inputText: string,
    output: string,
    state: AgentState,
    namespaceOverride?: string,
  ): Promise<void> {
    if (this.saveStrategy.onRunEnd) {
      await this.saveStrategy.onRunEnd(
        this.memory,
        inputText,
        output,
        state,
        namespaceOverride ?? this.namespace,
      );
    }
  }

  async onRunError(inputText: string, error: string, state: AgentState): Promise<void> {
    if (this.saveStrategy.onRunError) {
      await this.saveStrategy.onRunError(this.memory, inputText, error, state);
    }
  }

  async onIteration(state: AgentState, iteration: number): Promise<void> {
    if (this.saveStrategy.onIteration) {
      await this.saveStrategy.onIteration(this.memory, state, iteration);
    }
  }

  async onToolResult(
    toolName: string,
    toolArgs: Record<string, unknown>,
    result: unknown,
    state: AgentState,
  ): Promise<void> {
    if (this.saveStrategy.onToolResult) {
      await this.saveStrategy.onToolResult(this.memory, toolName, toolArgs, result, state);
    }
  }

  // ---------------------------------------------------------------------------
  // Direct memory access
  // ---------------------------------------------------------------------------

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    return this.memory.add(content, metadata);
  }

  async search(query: string, limit?: number): Promise<MemoryEntry[]> {
    return this.memory.search(query, limit);
  }

  async getContext(query: string, maxTokens?: number): Promise<string> {
    return this.memory.getContext(query, maxTokens);
  }

  async clear(): Promise<void> {
    if (this.memory.clear) {
      await this.memory.clear();
    }
  }

  async count(): Promise<number> {
    if (this.memory.count) {
      return this.memory.count();
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Agent tools — allow the agent to manage memory itself
  // ---------------------------------------------------------------------------

  getTools(): Tool[] {
    return [
      createTool({
        name: "save_to_memory",
        description: "Save information to long-term memory for future reference.",
        parameters: z.object({
          content: z.string().describe("The content to remember"),
          tags: z.string().optional().describe("Comma-separated tags for categorization"),
        }),
        execute: async (args) => {
          const meta: Record<string, unknown> = {};
          if (args.tags) {
            meta.tags = args.tags.split(",").map((t) => t.trim());
          }
          const id = await this.memory.add(args.content, meta);
          return `Saved to memory with id: ${id}`;
        },
      }),
      createTool({
        name: "search_memory",
        description: "Search long-term memory for relevant information.",
        parameters: z.object({
          query: z.string().describe("Search query"),
          limit: z.number().optional().describe("Max results (default 5)"),
        }),
        execute: async (args) => {
          const results = await this.memory.search(args.query, args.limit ?? 5);
          if (results.length === 0) return "No matching memories found.";
          return results
            .map(
              (e, i) =>
                `${i + 1}. [${e.id}] (relevance: ${e.relevance.toFixed(2)}) ${e.content}`,
            )
            .join("\n");
        },
      }),
      createTool({
        name: "forget_memory",
        description: "Delete a specific memory entry by ID.",
        parameters: z.object({
          entryId: z.string().describe("The memory entry ID to delete"),
        }),
        execute: async (args) => {
          if (this.memory.delete) {
            const ok = await this.memory.delete(args.entryId);
            return ok ? `Deleted memory ${args.entryId}` : `Memory ${args.entryId} not found.`;
          }
          return "Delete not supported by this memory backend.";
        },
      }),
    ];
  }
}

/** Type guard for checking if a memory backend is also a Component. */
function isComponent(obj: unknown): obj is Component {
  return (
    obj instanceof Component ||
    (typeof obj === "object" &&
      obj !== null &&
      "startup" in obj &&
      "shutdown" in obj &&
      typeof (obj as Component).startup === "function" &&
      typeof (obj as Component).shutdown === "function")
  );
}
