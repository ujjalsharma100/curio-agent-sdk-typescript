/**
 * Context window management: fit message history within token budgets.
 *
 * Provides ContextManager for trimming or summarizing messages so that
 * conversation + tools fit within a model's context limit.
 */

import type { Message, ToolSchema } from "../../models/llm.js";
import { createMessage } from "../../models/llm.js";
import { countMessageTokens } from "../llm/token-counter.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("ContextManager");

/** Placeholder text when using "summarize" strategy without a summarizer callback. */
export const SUMMARIZE_PLACEHOLDER =
  "[Earlier messages were truncated due to context length.]";

/** Strategy for fitting messages within the token budget. */
export type ContextStrategy = "truncate_oldest" | "summarize";

/** Options for ContextManager. */
export interface ContextManagerOptions {
  /** Maximum total tokens (context window). */
  maxTokens: number;
  /** Tokens to reserve for the model's response. Default: 1000. */
  reserveTokens?: number;
  /** How to fit: drop oldest messages or replace prefix with a summary. Default: "truncate_oldest". */
  strategy?: ContextStrategy;
  /**
   * Optional summarizer used when strategy is "summarize".
   * Receives (messagesToSummarize, model, tools) and returns a single Message (typically system).
   */
  summarizer?: (
    messages: Message[],
    model: string,
    tools: ToolSchema[] | undefined,
  ) => Message | Promise<Message>;
}

/**
 * Manages message history within token budgets.
 *
 * Trims or summarizes messages so that the conversation fits within
 * maxTokens, reserving reserveTokens for the model's response.
 */
export class ContextManager {
  private readonly _maxTokens: number;
  private readonly strategy: ContextStrategy;
  private readonly reserveTokens: number;
  private readonly _budget: number;
  private readonly summarizer?: ContextManagerOptions["summarizer"];

  constructor(options: ContextManagerOptions) {
    this._maxTokens = options.maxTokens;
    this.strategy = options.strategy ?? "truncate_oldest";
    this.reserveTokens = options.reserveTokens ?? 1000;
    this._budget = Math.max(0, options.maxTokens - this.reserveTokens);
    this.summarizer = options.summarizer;
  }

  /** Maximum total tokens (context window). */
  get maxTokens(): number {
    return this._maxTokens;
  }

  /**
   * Count tokens for a message list (and optional tool definitions) for the given model.
   */
  async countTokens(
    messages: Message[],
    model: string,
    tools?: ToolSchema[],
  ): Promise<number> {
    return countMessageTokens(messages, model, tools);
  }

  /**
   * Trim or summarize messages to fit within the token budget.
   *
   * Budget is maxTokens - reserveTokens. Only the first system message
   * is preserved at the start; all others are part of the trimmable history.
   *
   * @param messages - Full message history (system, user, assistant, tool).
   * @param tools - Optional tool schemas (their token cost is included when counting).
   * @param model - Model identifier for token counting.
   * @returns A new list of messages that fits within the budget.
   */
  async fitMessages(
    messages: Message[],
    tools?: ToolSchema[],
    model: string = "gpt-4o-mini",
  ): Promise<Message[]> {
    if (messages.length === 0) return [];

    const current = await countMessageTokens(messages, model, tools);
    if (current <= this._budget) return [...messages];

    // Only preserve the first system message (standard convention)
    let systemMsg: Message | undefined;
    const rest: Message[] = [];
    for (const m of messages) {
      if (systemMsg === undefined && m.role === "system") {
        systemMsg = m;
      } else {
        rest.push(m);
      }
    }

    if (rest.length === 0) return [...messages];

    const systemPrefix: Message[] = systemMsg ? [systemMsg] : [];

    if (this.strategy === "truncate_oldest") {
      return this.fitTruncateOldest(systemPrefix, rest, tools, model);
    }
    if (this.strategy === "summarize") {
      return this.fitSummarize(systemPrefix, rest, tools, model);
    }
    return [...messages];
  }

  /**
   * Group messages into atomic windows that should not be split.
   * Assistant messages with tool calls are grouped with their corresponding tool-result messages.
   */
  private groupMessages(rest: Message[]): Message[][] {
    const groups: Message[][] = [];
    let i = 0;
    const n = rest.length;

    while (i < n) {
      const msg = rest[i];
      if (!msg) continue;

      if (msg.role === "assistant" && msg.toolCalls?.length) {
        const group: Message[] = [msg];
        const toolIds = new Set(
          (msg.toolCalls ?? [])
            .map((tc) => tc.id)
            .filter((id): id is string => Boolean(id)),
        );
        let j = i + 1;
        while (j < n) {
          const nextMsg = rest[j];
          if (!nextMsg || nextMsg.role !== "tool") break;
          const tcId = nextMsg.toolCallId;
          if (!tcId || !toolIds.has(tcId)) break;
          group.push(nextMsg);
          j += 1;
        }
        groups.push(group);
        i = j;
        continue;
      }

      groups.push([msg]);
      i += 1;
    }

    return groups;
  }

  private async fitTruncateOldest(
    systemPrefix: Message[],
    rest: Message[],
    tools: ToolSchema[] | undefined,
    model: string,
  ): Promise<Message[]> {
    const groups = this.groupMessages(rest);
    if (groups.length === 0) return [...systemPrefix];

    const n = groups.length;
    let lo = 0;
    let hi = n - 1;
    let bestStart = n - 1;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const tailMessages = groups.slice(mid).flat();
      const candidate = [...systemPrefix, ...tailMessages];
      const tokenCount = await countMessageTokens(candidate, model, tools);
      if (tokenCount <= this._budget) {
        bestStart = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const tailMessages = groups.slice(bestStart).flat();
    return [...systemPrefix, ...tailMessages];
  }

  private async fitSummarize(
    systemPrefix: Message[],
    rest: Message[],
    tools: ToolSchema[] | undefined,
    model: string,
  ): Promise<Message[]> {
    const groups = this.groupMessages(rest);
    if (groups.length === 0) return [...systemPrefix];

    const n = groups.length;
    const placeholder = createMessage("system", SUMMARIZE_PLACEHOLDER);

    let lo = 0;
    let hi = n - 1;
    let bestStart = n - 1;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const tailMessages = groups.slice(mid).flat();
      const candidate = [...systemPrefix, placeholder, ...tailMessages];
      const tokenCount = await countMessageTokens(candidate, model, tools);
      if (tokenCount <= this._budget) {
        bestStart = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const prefixGroups = groups.slice(0, bestStart);
    const tailGroups = groups.slice(bestStart);
    const tailMessages = tailGroups.flat();

    if (prefixGroups.length === 0) {
      const flatRest = groups.flat();
      return this.fitTruncateOldest(systemPrefix, flatRest, tools, model);
    }

    const prefixMessages = prefixGroups.flat();

    let summaryMsg: Message;
    if (this.summarizer) {
      try {
        summaryMsg = await Promise.resolve(
          this.summarizer(prefixMessages, model, tools),
        );
      } catch (e) {
        logger.warn(
          { err: e },
          "Context summarizer failed; using placeholder",
        );
        summaryMsg = createMessage("system", SUMMARIZE_PLACEHOLDER);
      }
    } else {
      summaryMsg = createMessage("system", SUMMARIZE_PLACEHOLDER);
    }

    const result = [...systemPrefix, summaryMsg, ...tailMessages];

    try {
      const resultTokens = await countMessageTokens(result, model, tools);
      if (resultTokens <= this._budget) return result;
    } catch {
      return result;
    }

    logger.warn(
      "Summarized context still exceeds budget; falling back to truncate_oldest",
    );
    const flatRest = groups.flat();
    return this.fitTruncateOldest(systemPrefix, flatRest, tools, model);
  }
}
