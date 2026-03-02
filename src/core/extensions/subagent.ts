import type { Tool } from "../tools/tool.js";

/**
 * Configuration for spawning a subagent.
 *
 * Subagents are lightweight child agents that typically share the same
 * underlying LLM client, hooks, and middleware as their parent, but can
 * have their own system prompt, tools, and run limits.
 */
export interface SubagentConfig {
  /** System prompt for the subagent. */
  systemPrompt: string;
  /** Tools available to the subagent (falls back to parent tools if omitted). */
  tools?: Tool[];
  /** Model to use (defaults to parent's model). */
  model?: string;
  /** Max iterations for the subagent (defaults to parent's maxIterations). */
  maxIterations?: number;
  /** Timeout in milliseconds (defaults to parent's timeout). */
  timeout?: number;
}

