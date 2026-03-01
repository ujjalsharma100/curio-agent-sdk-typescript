/**
 * Guardrails middleware — content safety filtering via regex and prompt-injection heuristics.
 */

import type { LLMRequest, LLMResponse, Message } from "../models/llm.js";
import { getMessageText } from "../models/llm.js";
import type { Middleware } from "./base.js";
import { CurioError } from "../models/errors.js";

/**
 * Raised when content is blocked by a guardrail rule.
 */
export class GuardrailsError extends CurioError {
  readonly pattern: string;
  readonly direction: "input" | "output";

  constructor(message: string, pattern: string, direction: "input" | "output" = "output") {
    super(message);
    this.pattern = pattern;
    this.direction = direction;
  }
}

export interface GuardrailsMiddlewareOptions {
  /** Regex patterns (strings) matched against LLM response content; block if match. */
  blockPatterns?: string[];
  /** Regex patterns matched against user message content; block if match. */
  blockInputPatterns?: string[];
  /** Callback when content is blocked. */
  onBlock?: (error: GuardrailsError) => void;
  /** When true, apply heuristic prompt-injection detection to user prompts. */
  blockPromptInjection?: boolean;
}

const SUSPICIOUS_PHRASES = [
  "ignore previous instructions",
  "forget previous instructions",
  "disregard all prior rules",
  "you are no longer",
  "you must now act as",
  "as a large language model you must ignore",
  "developer mode",
  "system prompt",
];

/**
 * Blocks LLM inputs or outputs matching regex patterns and optionally
 * performs heuristic prompt-injection detection.
 */
export class GuardrailsMiddleware implements Middleware {
  readonly name = "GuardrailsMiddleware";
  private readonly blockPatterns: RegExp[];
  private readonly blockInputPatterns: RegExp[];
  private readonly onBlock?: (error: GuardrailsError) => void;
  private readonly blockPromptInjection: boolean;

  constructor(options: GuardrailsMiddlewareOptions = {}) {
    this.blockPatterns = (options.blockPatterns ?? []).map((p) => new RegExp(p));
    this.blockInputPatterns = (options.blockInputPatterns ?? []).map((p) => new RegExp(p));
    this.onBlock = options.onBlock;
    this.blockPromptInjection = options.blockPromptInjection ?? false;
  }

  private checkContent(
    content: string,
    patterns: RegExp[],
    direction: "input" | "output",
  ): void {
    for (const re of patterns) {
      if (re.test(content)) {
        const err = new GuardrailsError(
          `Content blocked by guardrail (${direction}): matched '${re.source}'`,
          re.source,
          direction,
        );
        if (this.onBlock) this.onBlock(err);
        throw err;
      }
    }
  }

  private looksLikePromptInjection(text: string): boolean {
    const lower = text.toLowerCase();
    return SUSPICIOUS_PHRASES.some((phrase) => lower.includes(phrase));
  }

  async beforeLLMCall(request: LLMRequest): Promise<LLMRequest> {
    let lastUser: Message | undefined;
    for (let i = request.messages.length - 1; i >= 0; i--) {
      const m = request.messages[i];
      if (m && m.role === "user") {
        lastUser = m;
        break;
      }
    }
    if (!lastUser) return request;

    const text = getMessageText(lastUser);
    if (!text) return request;

    if (this.blockInputPatterns.length > 0) {
      this.checkContent(text, this.blockInputPatterns, "input");
    }
    if (this.blockPromptInjection && this.looksLikePromptInjection(text)) {
      const err = new GuardrailsError(
        "Content blocked by guardrail (input): suspected prompt injection",
        "prompt_injection_heuristic",
        "input",
      );
      if (this.onBlock) this.onBlock(err);
      throw err;
    }
    return request;
  }

  async afterLLMCall(_request: LLMRequest, response: LLMResponse): Promise<LLMResponse> {
    if (this.blockPatterns.length === 0) return response;
    const text = response.content;
    if (text) {
      this.checkContent(text, this.blockPatterns, "output");
    }
    return response;
  }
}
