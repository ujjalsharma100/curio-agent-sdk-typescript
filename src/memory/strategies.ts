import type { AgentState } from "../core/state/state.js";
import type { Message } from "../models/llm.js";
import type { Memory } from "./base.js";

// ---------------------------------------------------------------------------
// Injection Strategies
// ---------------------------------------------------------------------------

/**
 * Strategy for injecting memory context into agent state before a run.
 */
export interface MemoryInjectionStrategy {
  inject(state: AgentState, memory: Memory, query: string): Promise<void>;
}

/**
 * Default injection: insert memory context as a system message after the
 * first system prompt (position 1).
 */
export class DefaultInjection implements MemoryInjectionStrategy {
  private readonly maxTokens: number;
  private readonly position: number;
  private readonly prefix: string;

  constructor(options?: { maxTokens?: number; position?: number; prefix?: string }) {
    this.maxTokens = options?.maxTokens ?? 2000;
    this.position = options?.position ?? 1;
    this.prefix = options?.prefix ?? "Relevant information from memory:";
  }

  async inject(state: AgentState, memory: Memory, query: string): Promise<void> {
    const context = await memory.getContext(query, this.maxTokens);
    if (!context) return;
    const msg: Message = {
      role: "system",
      content: `${this.prefix}\n${context}`,
    };
    state.messages.splice(this.position, 0, msg);
  }
}

/**
 * Append memory context to the last user message for a more natural flow.
 */
export class UserMessageInjection implements MemoryInjectionStrategy {
  private readonly maxTokens: number;
  private readonly prefix: string;

  constructor(options?: { maxTokens?: number; prefix?: string }) {
    this.maxTokens = options?.maxTokens ?? 2000;
    this.prefix = options?.prefix ?? "Context from memory:";
  }

  async inject(state: AgentState, memory: Memory, query: string): Promise<void> {
    const context = await memory.getContext(query, this.maxTokens);
    if (!context) return;

    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg && msg.role === "user" && typeof msg.content === "string") {
        msg.content = `${msg.content}\n\n${this.prefix}\n${context}`;
        return;
      }
    }
  }
}

/**
 * No injection — agent manages memory exclusively via tools.
 */
export class NoInjection implements MemoryInjectionStrategy {
  async inject(_state: AgentState, _memory: Memory, _query: string): Promise<void> {
    // intentionally empty
  }
}

// ---------------------------------------------------------------------------
// Save Strategies
// ---------------------------------------------------------------------------

/**
 * Strategy for saving data to memory during the agent lifecycle.
 */
export interface MemorySaveStrategy {
  onRunStart?(memory: Memory, inputText: string, state: AgentState): Promise<void>;
  onRunEnd?(
    memory: Memory,
    inputText: string,
    output: string,
    state: AgentState,
    namespace?: string,
  ): Promise<void>;
  onRunError?(memory: Memory, inputText: string, error: string, state: AgentState): Promise<void>;
  onIteration?(memory: Memory, state: AgentState, iteration: number): Promise<void>;
  onToolResult?(
    memory: Memory,
    toolName: string,
    toolArgs: Record<string, unknown>,
    result: unknown,
    state: AgentState,
  ): Promise<void>;
}

/**
 * Default save: stores user input + assistant output at run end.
 */
export class DefaultSave implements MemorySaveStrategy {
  async onRunEnd(
    memory: Memory,
    inputText: string,
    output: string,
    _state: AgentState,
    namespace?: string,
  ): Promise<void> {
    const meta: Record<string, unknown> = namespace ? { namespace } : {};
    await memory.add(inputText, { ...meta, type: "user_input", role: "user" });
    await memory.add(output, { ...meta, type: "assistant_output", role: "assistant" });
  }
}

/**
 * Save everything: user input, assistant output, and all tool results.
 */
export class SaveEverythingStrategy implements MemorySaveStrategy {
  async onRunEnd(
    memory: Memory,
    inputText: string,
    output: string,
    _state: AgentState,
    namespace?: string,
  ): Promise<void> {
    const meta: Record<string, unknown> = namespace ? { namespace } : {};
    await memory.add(inputText, { ...meta, type: "user_input", role: "user" });
    await memory.add(output, { ...meta, type: "assistant_output", role: "assistant" });
  }

  async onToolResult(
    memory: Memory,
    toolName: string,
    toolArgs: Record<string, unknown>,
    result: unknown,
    _state: AgentState,
  ): Promise<void> {
    const content = `Tool '${toolName}' called with ${JSON.stringify(toolArgs)} returned: ${JSON.stringify(result)}`;
    await memory.add(content, { type: "tool_result", toolName });
  }
}

/**
 * Save only a summarized version of the conversation.
 */
export class SaveSummaryStrategy implements MemorySaveStrategy {
  private readonly summarizeFn: (
    input: string,
    output: string,
    state: AgentState,
  ) => Promise<string>;

  constructor(summarizeFn: (input: string, output: string, state: AgentState) => Promise<string>) {
    this.summarizeFn = summarizeFn;
  }

  async onRunEnd(
    memory: Memory,
    inputText: string,
    output: string,
    state: AgentState,
    namespace?: string,
  ): Promise<void> {
    const summary = await this.summarizeFn(inputText, output, state);
    const meta: Record<string, unknown> = namespace ? { namespace } : {};
    await memory.add(summary, { ...meta, type: "summary" });
  }
}

/**
 * No saving — agent manages memory via tools.
 */
export class NoSave implements MemorySaveStrategy {}

/**
 * Per-iteration save: save at run end + after each loop iteration.
 */
export class PerIterationSave implements MemorySaveStrategy {
  async onRunEnd(
    memory: Memory,
    inputText: string,
    output: string,
    _state: AgentState,
    namespace?: string,
  ): Promise<void> {
    const meta: Record<string, unknown> = namespace ? { namespace } : {};
    await memory.add(inputText, { ...meta, type: "user_input", role: "user" });
    await memory.add(output, { ...meta, type: "assistant_output", role: "assistant" });
  }

  async onIteration(memory: Memory, state: AgentState, iteration: number): Promise<void> {
    const lastMsg = state.messages[state.messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const text = typeof lastMsg.content === "string" ? lastMsg.content : "";
    const snippet = text.slice(0, 500);
    await memory.add(snippet, { type: "iteration_snapshot", iteration });
  }
}

// ---------------------------------------------------------------------------
// Query Strategies
// ---------------------------------------------------------------------------

/**
 * Strategy for building memory queries and controlling token budgets.
 */
export interface MemoryQueryStrategy {
  buildQuery(inputText: string, state: AgentState): Promise<string>;
  maxTokens(state: AgentState): number;
  relevanceThreshold?(): number;
  maxResults?(): number;
}

/**
 * Default query: use raw input as query with fixed token budget.
 */
export class DefaultQuery implements MemoryQueryStrategy {
  private readonly maxTokensValue: number;

  constructor(maxTokensValue?: number) {
    this.maxTokensValue = maxTokensValue ?? 2000;
  }

  async buildQuery(inputText: string): Promise<string> {
    return inputText;
  }

  maxTokens(): number {
    return this.maxTokensValue;
  }
}

/**
 * Strip common stop words for more focused keyword search.
 */
export class KeywordQuery implements MemoryQueryStrategy {
  private readonly maxTokensValue: number;

  private static readonly STOP_WORDS = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "about",
    "it",
    "its",
    "this",
    "that",
    "and",
    "or",
    "but",
    "if",
    "not",
    "no",
    "so",
    "than",
    "too",
    "very",
    "just",
    "i",
    "me",
    "my",
    "we",
    "you",
    "he",
    "she",
    "they",
    "what",
    "which",
    "who",
    "how",
    "when",
    "where",
    "why",
  ]);

  constructor(maxTokensValue?: number) {
    this.maxTokensValue = maxTokensValue ?? 2000;
  }

  async buildQuery(inputText: string): Promise<string> {
    const words = inputText
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0 && !KeywordQuery.STOP_WORDS.has(w));
    return words.join(" ") || inputText;
  }

  maxTokens(): number {
    return this.maxTokensValue;
  }
}

/**
 * Adaptive token budget that decreases as conversation grows.
 */
export class AdaptiveTokenQuery implements MemoryQueryStrategy {
  private readonly baseTokens: number;
  private readonly minTokens: number;
  private readonly decayPerMessage: number;

  constructor(options?: { baseTokens?: number; minTokens?: number; decayPerMessage?: number }) {
    this.baseTokens = options?.baseTokens ?? 4000;
    this.minTokens = options?.minTokens ?? 500;
    this.decayPerMessage = options?.decayPerMessage ?? 100;
  }

  async buildQuery(inputText: string): Promise<string> {
    return inputText;
  }

  maxTokens(state: AgentState): number {
    const msgCount = state.messages.length;
    const budget = this.baseTokens - msgCount * this.decayPerMessage;
    return Math.max(this.minTokens, Math.min(budget, this.baseTokens));
  }
}
