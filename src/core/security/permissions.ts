/**
 * Permission and sandbox model for tool execution.
 *
 * Port of the Python `curio_agent_sdk.core.security.permissions` module.
 * Controls what the agent is allowed to do (tools, file system, network).
 */

import * as nodePath from "node:path";

/**
 * Execution context passed to permission checks.
 *
 * This is intentionally open-ended so different callers can attach
 * whatever metadata they need (runId, agentId, toolCallId, toolConfig, etc.).
 */
export interface PermissionContext extends Record<string, unknown> {
  runId?: string;
  agentId?: string;
  toolCallId?: string;
  toolConfig?: Record<string, unknown>;
}

/** Result of a permission check. */
export interface PermissionResult {
  /** Whether the action is allowed to proceed. */
  allowed: boolean;
  /** Optional human-readable reason for logging / UI. */
  reason?: string;
  /**
   * If true, the action is allowed in principle but should be confirmed
   * with a human (via a HumanInputHandler) before proceeding.
   */
  requireConfirmation?: boolean;
}

/**
 * Common argument keys that may contain file paths or URLs. Used for
 * introspecting tool arguments when applying file/network sandbox policies.
 */
const PATH_LIKE_KEYS: ReadonlySet<string> = new Set([
  "path",
  "file_path",
  "file",
  "filepath",
  "file_paths",
  "paths",
  "directory",
  "dir",
  "target",
]);

const URL_LIKE_KEYS: ReadonlySet<string> = new Set([
  "url",
  "uri",
  "href",
  "endpoint",
  "link",
]);

/** Collect (key, value) pairs from args that look like file paths. */
export function collectPathsFromArgs(
  args: Record<string, unknown>,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(args)) {
    const keyLower = key.toLowerCase();
    if (!PATH_LIKE_KEYS.has(keyLower) || value == null) continue;

    if (typeof value === "string") {
      out.push([key, value]);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          out.push([key, item]);
        }
      }
    }
  }
  return out;
}

/** Collect (key, value) pairs from args that look like URLs. */
export function collectUrlsFromArgs(
  args: Record<string, unknown>,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(args)) {
    const keyLower = key.toLowerCase();
    if (!URL_LIKE_KEYS.has(keyLower) || value == null) continue;

    if (typeof value === "string") {
      out.push([key, value]);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          out.push([key, item]);
        }
      }
    }
  }
  return out;
}

/**
 * Controls what the agent is allowed to do.
 *
 * Implementations must at least provide `checkToolCall`. They may also
 * provide file and network specific checks, which can be called directly
 * from tools or from higher-level policies.
 */
export interface PermissionPolicy {
  /**
   * Check whether a tool call is allowed.
   *
   * Returning `allowed: false` denies the action outright.
   * Returning `allowed: true, requireConfirmation: true` indicates that a
   * human should be asked to confirm before proceeding.
   */
  checkToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context: PermissionContext,
  ): Promise<PermissionResult>;

  /**
   * Optional file access check (read/write/delete).
   *
   * `mode` is typically `"r"`, `"w"`, `"x"`, or `"delete"`, but this is not
   * enforced so policies can use richer semantics if desired.
   */
  checkFileAccess?(
    path: string,
    mode: string,
    context: PermissionContext,
  ): Promise<PermissionResult>;

  /**
   * Optional network access check.
   */
  checkNetworkAccess?(
    url: string,
    context: PermissionContext,
  ): Promise<PermissionResult>;
}

// ---------------------------------------------------------------------------
// Basic policies
// ---------------------------------------------------------------------------

/** Allow all tool calls, file access, and network access without confirmation. */
export class AllowAll implements PermissionPolicy {
  async checkToolCall(
    _toolName: string,
    _args: Record<string, unknown>,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    return { allowed: true };
  }

  async checkFileAccess(
    _path: string,
    _mode: string,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    return { allowed: true };
  }

  async checkNetworkAccess(
    _url: string,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    return { allowed: true };
  }
}

/** Always require human confirmation before tool execution. */
export class AskAlways implements PermissionPolicy {
  async checkToolCall(
    _toolName: string,
    _args: Record<string, unknown>,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    return {
      allowed: true,
      requireConfirmation: true,
      reason: "Tool execution requires confirmation",
    };
  }
}

/**
 * Allow reads automatically; ask for writes/destructive actions.
 *
 * Heuristics are applied to tool names and (for file access) modes.
 */
export class AllowReadsAskWrites implements PermissionPolicy {
  private static readonly WRITE_LIKE_PATTERN = /\b(write|edit|delete|create|run|execute|execute_code|shell|command|remove|rm|add|append|modify|update|install)\b/i;

  async checkToolCall(
    toolName: string,
    _args: Record<string, unknown>,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    if (AllowReadsAskWrites.WRITE_LIKE_PATTERN.test(toolName)) {
      return {
        allowed: true,
        requireConfirmation: true,
        reason: "This action may modify state; confirmation required",
      };
    }

    return { allowed: true };
  }

  async checkFileAccess(
    _path: string,
    mode: string,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    if (mode === "r" || mode === "read") {
      return { allowed: true };
    }
    return {
      allowed: true,
      requireConfirmation: true,
      reason: "File write/delete requires confirmation",
    };
  }

  async checkNetworkAccess(
    _url: string,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    // Without HTTP method information we treat all network access as allowed.
    return { allowed: true };
  }
}

/**
 * Combine multiple policies: all must allow the action.
 *
 * Evaluation order is deterministic; the first deny or confirmation
 * requirement short-circuits the rest.
 */
export class CompoundPolicy implements PermissionPolicy {
  private readonly policies: PermissionPolicy[];

  constructor(policies: PermissionPolicy[]) {
    this.policies = [...policies];
  }

  async checkToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context: PermissionContext,
  ): Promise<PermissionResult> {
    for (const policy of this.policies) {
      const result = await policy.checkToolCall(toolName, args, context);
      if (!result.allowed || result.requireConfirmation) {
        return result;
      }
    }
    return { allowed: true };
  }

  async checkFileAccess(
    path: string,
    mode: string,
    context: PermissionContext,
  ): Promise<PermissionResult> {
    for (const policy of this.policies) {
      if (!policy.checkFileAccess) continue;
      const result = await policy.checkFileAccess(path, mode, context);
      if (!result.allowed || result.requireConfirmation) {
        return result;
      }
    }
    return { allowed: true };
  }

  async checkNetworkAccess(
    url: string,
    context: PermissionContext,
  ): Promise<PermissionResult> {
    for (const policy of this.policies) {
      if (!policy.checkNetworkAccess) continue;
      const result = await policy.checkNetworkAccess(url, context);
      if (!result.allowed || result.requireConfirmation) {
        return result;
      }
    }
    return { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// File system sandboxing
// ---------------------------------------------------------------------------

function normalizePathForPrefix(path: string): string {
  try {
    return nodePath.resolve(path);
  } catch {
    return path;
  }
}

function pathUnderPrefix(resolved: string, prefixResolved: string): boolean {
  if (resolved === prefixResolved) return true;

  try {
    const relative = nodePath.relative(prefixResolved, resolved);
    return !!relative && !relative.startsWith("..") && !nodePath.isAbsolute(relative);
  } catch {
    const sep = nodePath.sep;
    const prefix = prefixResolved.endsWith(sep) ? prefixResolved : `${prefixResolved}${sep}`;
    return resolved === prefixResolved || resolved.startsWith(prefix);
  }
}

/**
 * Restrict file access to a set of allowed path prefixes.
 *
 * Only paths under one of the configured prefixes are permitted.
 * Paths are normalized before comparison.
 */
export class FileSandboxPolicy implements PermissionPolicy {
  private readonly allowedPrefixes: string[];

  constructor(allowedPrefixes: string[]) {
    this.allowedPrefixes = allowedPrefixes.map((p) => String(p));
  }

  async checkToolCall(
    _toolName: string,
    args: Record<string, unknown>,
    context: PermissionContext,
  ): Promise<PermissionResult> {
    for (const [, path] of collectPathsFromArgs(args)) {
      const result = await this.checkFileAccess(path, "r", context);
      if (!result.allowed || result.requireConfirmation) {
        return result;
      }
    }
    return { allowed: true };
  }

  async checkFileAccess(
    path: string,
    _mode: string,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    let resolved: string;
    try {
      resolved = normalizePathForPrefix(path);
    } catch {
      return { allowed: false, reason: `Invalid path: ${path}` };
    }

    for (const prefix of this.allowedPrefixes) {
      try {
        const prefixResolved = normalizePathForPrefix(prefix);
        if (pathUnderPrefix(resolved, prefixResolved)) {
          return { allowed: true };
        }
      } catch {
        if (resolved.startsWith(prefix)) {
          return { allowed: true };
        }
      }
    }

    return { allowed: false, reason: `Path not in allowed list: ${path}` };
  }
}

// ---------------------------------------------------------------------------
// Network sandboxing
// ---------------------------------------------------------------------------

/**
 * Restrict network access to a set of allowed URL patterns.
 *
 * Patterns may be regular expressions (as strings) or literal substrings
 * that must appear in the URL.
 */
export class NetworkSandboxPolicy implements PermissionPolicy {
  private readonly compiled: Array<RegExp | string> = [];

  constructor(allowedPatterns: string[]) {
    for (const pattern of allowedPatterns) {
      try {
        this.compiled.push(new RegExp(pattern));
      } catch {
        this.compiled.push(pattern);
      }
    }
  }

  async checkToolCall(
    _toolName: string,
    args: Record<string, unknown>,
    context: PermissionContext,
  ): Promise<PermissionResult> {
    for (const [, url] of collectUrlsFromArgs(args)) {
      const result = await this.checkNetworkAccess(url, context);
      if (!result.allowed || result.requireConfirmation) {
        return result;
      }
    }
    return { allowed: true };
  }

  async checkNetworkAccess(
    url: string,
    _context: PermissionContext,
  ): Promise<PermissionResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: `Invalid URL: ${url}` };
    }

    if (!parsed.protocol || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      return { allowed: false, reason: `Disallowed URL scheme for: ${url}` };
    }

    if (!parsed.hostname) {
      return { allowed: false, reason: `Invalid URL host for: ${url}` };
    }

    for (const pattern of this.compiled) {
      if (typeof pattern === "string") {
        if (url.includes(pattern)) {
          return { allowed: true };
        }
      } else if (pattern.test(url)) {
        return { allowed: true };
      }
    }

    return { allowed: false, reason: `URL not in allowed list: ${url}` };
  }
}

