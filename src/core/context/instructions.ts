/**
 * Rules / instructions system for Curio Agent SDK.
 *
 * Loads instruction files hierarchically (global > project > directory) and
 * merges them into the agent's system prompt. Supports file-based rules
 * (AGENT.md, .agent/rules.md) and raw instruction strings.
 */

import { readFileSync, existsSync, watch, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("InstructionLoader");

/** Default file names to look for (in order of precedence within each level). */
export const DEFAULT_INSTRUCTION_FILES = ["AGENT.md", ".agent/rules.md"];

/** Markers that indicate a project root when walking up from cwd. */
export const PROJECT_ROOT_MARKERS = [".git", "pyproject.toml", ".cursorrules", "AGENT.md", "package.json"];

/**
 * Walk up from start (default cwd) and return the first directory that
 * contains a project root marker, or null.
 */
export function findProjectRoot(start?: string): string | null {
  let current = start ? resolve(start) : process.cwd();
  const home = homedir();

  while (current && current !== home) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      const candidate = join(current, marker);
      if (existsSync(candidate)) {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Return default search path order: global (~/.agent), project root, cwd.
 * Later paths override earlier in terms of specificity (directory > project > global).
 */
export function defaultSearchPaths(): string[] {
  const cwd = resolve(process.cwd());
  const home = homedir();
  const paths: string[] = [];

  const globalDir = platform() === "win32" ? join(home, ".agent") : join(home, ".agent");
  if (existsSync(globalDir)) {
    paths.push(globalDir);
  }

  const project = findProjectRoot(cwd);
  if (project && !paths.includes(project)) {
    paths.push(project);
  }

  if (!paths.includes(cwd)) {
    paths.push(cwd);
  }

  return paths;
}

/** Options for InstructionLoader. */
export interface InstructionLoaderOptions {
  /** Names of files to load (e.g. ["AGENT.md", ".agent/rules.md"]). Paths in names are relative to each search path. */
  fileNames?: string[];
  /** Directories to search. If not provided, uses default: [~/.agent, project_root, cwd]. */
  searchPaths?: string[];
  /** String between concatenated file contents. Default: "\\n\\n---\\n\\n". */
  mergeSeparator?: string;
}

/**
 * Loads instruction files hierarchically and merges them into a single string.
 *
 * Search order: global (~/.agent) → project root → current directory.
 * Within each level, files are loaded in fileNames order. Content is
 * concatenated so that later (more specific) levels effectively override
 * or extend earlier ones.
 */
export class InstructionLoader {
  readonly fileNames: string[];
  readonly searchPaths: string[];
  readonly mergeSeparator: string;

  constructor(options: InstructionLoaderOptions = {}) {
    this.fileNames = options.fileNames ?? [...DEFAULT_INSTRUCTION_FILES];
    this.searchPaths =
      options.searchPaths ?? defaultSearchPaths();
    this.mergeSeparator = options.mergeSeparator ?? "\n\n---\n\n";
  }

  /**
   * Load and merge all instruction files from the hierarchy.
   *
   * @returns Concatenated content (global + project + directory). Empty string if no files found.
   */
  load(): string {
    const parts: string[] = [];
    const seenContent = new Set<string>();

    for (const basePath of this.searchPaths) {
      if (!existsSync(basePath)) continue;
      for (const fileName of this.fileNames) {
        const fullPath = resolve(basePath, fileName);
        try {
          if (!existsSync(fullPath)) continue;
          if (!statSync(fullPath).isFile()) continue;
          const text = readFileSync(fullPath, "utf-8").replace(/\r\n/g, "\n").trim();
          if (!text) continue;
          if (seenContent.has(text)) continue;
          seenContent.add(text);
          parts.push(text);
        } catch (e) {
          logger.warn({ path: fullPath, err: e }, "Could not read instruction file");
        }
      }
    }

    return parts.length > 0 ? parts.join(this.mergeSeparator) : "";
  }

  /**
   * Watch instruction files for changes and invoke onReload when any change is detected.
   * Returns an unsubscribe function to stop watching.
   */
  watch(onReload: () => void): () => void {
    const dirsToWatch = new Set<string>();

    for (const basePath of this.searchPaths) {
      if (!existsSync(basePath)) continue;
      for (const fileName of this.fileNames) {
        const fullPath = resolve(basePath, fileName);
        if (existsSync(fullPath)) {
          const dir = dirname(fullPath);
          dirsToWatch.add(dir);
        }
      }
    }

    const watchers: ReturnType<typeof watch>[] = [];
    for (const dir of dirsToWatch) {
      try {
        const w = watch(
          dir,
          { persistent: false },
          (_eventType, filename) => {
            if (filename && this.fileNames.some((f) => f.endsWith(filename) || f.includes(filename))) {
              onReload();
            }
          },
        );
        watchers.push(w);
      } catch (e) {
        logger.warn({ dir, err: e }, "Could not watch instruction directory");
      }
    }

    return () => {
      for (const w of watchers) {
        try {
          w.close();
        } catch (_) {}
      }
    };
  }

  toString(): string {
    return `InstructionLoader(fileNames=${JSON.stringify(this.fileNames)}, searchPaths=${JSON.stringify(this.searchPaths)})`;
  }
}

/**
 * Load instructions from a single file.
 *
 * @param path - Path to the instruction file.
 * @returns File content or empty string if file cannot be read.
 */
export function loadInstructionsFromFile(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    logger.warn({ path: resolved }, "Instruction file not found");
    return "";
  }
  try {
    return readFileSync(resolved, "utf-8").replace(/\r\n/g, "\n").trim();
  } catch (e) {
    logger.warn({ path: resolved, err: e }, "Could not read instruction file");
    return "";
  }
}
