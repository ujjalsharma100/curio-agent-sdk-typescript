import fs from "node:fs/promises";
import path from "node:path";

import type { Tool } from "../tools/tool.js";
import type { HookHandler } from "../events/hooks.js";
import { parse as parseYaml } from "yaml";

export interface SkillHookDefinition {
  event: string;
  handler: HookHandler;
  priority?: number;
}

export interface SkillOptions {
  name: string;
  description?: string;
  systemPrompt?: string;
  tools?: Tool[];
  hooks?: SkillHookDefinition[];
  instructions?: string;
}

export interface SkillManifest {
  name: string;
  description?: string;
  system_prompt?: string;
  systemPrompt?: string;
  instructions_file?: string;
  instructionsFile?: string;
  active?: boolean;
}

export interface SkillDirectoryOptions {
  /**
   * Candidate manifest file names to look for inside the skill directory.
   * Defaults to: ["skill.yaml", "skill.yml", "skill.json"].
   */
  manifestFileNames?: string[];
  /**
   * Candidate instruction file names to load as markdown.
   * Defaults to: ["SKILL.md", "README.md"].
   */
  instructionFileNames?: string[];
}

/**
 * A Skill bundles a system prompt, optional tools, hooks, and free-form
 * instructions. It is a higher-level extension concept that can be attached
 * to an agent via the builder.
 */
export class Skill {
  readonly name: string;
  readonly description?: string;
  readonly systemPrompt?: string;
  readonly tools: Tool[];
  readonly hooks: SkillHookDefinition[];
  readonly instructions?: string;

  constructor(options: SkillOptions) {
    this.name = options.name;
    this.description = options.description;
    this.systemPrompt = options.systemPrompt;
    this.tools = [...(options.tools ?? [])];
    this.hooks = [...(options.hooks ?? [])];
    this.instructions = options.instructions;
  }

  /**
   * Load a Skill from a directory containing a YAML/JSON manifest and optional
   * markdown instructions file.
   *
   * The loader is intentionally conservative: it does not try to resolve or
   * instantiate tools from the filesystem — those should be wired by the host
   * application. The returned Skill will have an empty tools array by default.
   */
  static async fromDirectory(
    dir: string,
    options: SkillDirectoryOptions = {},
  ): Promise<Skill> {
    const manifestFileNames =
      options.manifestFileNames ?? ["skill.yaml", "skill.yml", "skill.json"];
    const instructionFileNames =
      options.instructionFileNames ?? ["SKILL.md", "README.md"];

    const manifestPath = await findFirstExistingFile(dir, manifestFileNames);
    if (!manifestPath) {
      throw new Error(
        `Skill.fromDirectory: No manifest file found in ${dir}. Looked for ${manifestFileNames.join(", ")}`,
      );
    }

    const manifest = await loadManifest(manifestPath);
    const instructionsPath = await findFirstExistingFile(
      dir,
      instructionFileNames,
    );
    const instructions = instructionsPath
      ? await fs.readFile(instructionsPath, "utf8")
      : undefined;

    const systemPrompt =
      manifest.systemPrompt ?? manifest.system_prompt ?? undefined;

    return new Skill({
      name: manifest.name ?? path.basename(dir),
      description: manifest.description,
      systemPrompt,
      tools: [],
      hooks: [],
      instructions,
    });
  }
}

/**
 * Simple in-memory registry for Skills. It can be used by higher-level
 * orchestration layers to keep track of available/active skills.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();
  private readonly active = new Set<string>();

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  unregister(name: string): void {
    this.skills.delete(name);
    this.active.delete(name);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  activate(name: string): void {
    if (this.skills.has(name)) {
      this.active.add(name);
    }
  }

  deactivate(name: string): void {
    this.active.delete(name);
  }

  isActive(name: string): boolean {
    return this.active.has(name);
  }

  getActiveSkills(): Skill[] {
    return Array.from(this.active)
      .map((name) => this.skills.get(name))
      .filter((s): s is Skill => s != null);
  }

  clear(): void {
    this.skills.clear();
    this.active.clear();
  }
}

async function findFirstExistingFile(
  dir: string,
  candidates: string[],
): Promise<string | undefined> {
  for (const name of candidates) {
    const fullPath = path.join(dir, name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        return fullPath;
      }
    } catch {
      // ignore missing files
    }
  }
  return undefined;
}

async function loadManifest(manifestPath: string): Promise<SkillManifest> {
  const raw = await fs.readFile(manifestPath, "utf8");
  if (manifestPath.endsWith(".json")) {
    return JSON.parse(raw) as SkillManifest;
  }

  const parsed = parseYaml(raw) as unknown;
  if (parsed == null || typeof parsed !== "object") {
    throw new Error(
      `Skill.fromDirectory: Manifest at ${manifestPath} did not parse to an object`,
    );
  }
  return parsed as SkillManifest;
}

