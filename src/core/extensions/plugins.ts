import fs from "node:fs/promises";
import path from "node:path";

import type { AgentBuilder } from "../agent/builder.js";

export interface Plugin {
  name: string;
  register(builder: AgentBuilder): void;
}

export function isPlugin(value: unknown): value is Plugin {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Plugin).name === "string" &&
    typeof (value as Plugin).register === "function"
  );
}

export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): void {
    this.plugins.delete(name);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Apply all registered plugins to the given builder.
   */
  applyAll(builder: AgentBuilder): void {
    for (const plugin of this.plugins.values()) {
      plugin.register(builder);
    }
  }
}

export interface DiscoverPluginsOptions {
  /**
   * Working directory whose package.json should be inspected.
   * Defaults to process.cwd().
   */
  cwd?: string;
  /**
   * Prefix used to identify plugin packages.
   * Defaults to "curio-plugin-".
   */
  prefix?: string;
}

/**
 * Discover plugins by scanning package.json dependencies for packages whose
 * names start with the given prefix and then attempting to import them.
 *
 * Any exported value with a compatible shape (name + register(builder)) will be
 * treated as a Plugin instance.
 */
export async function discoverPluginsFromPackageJson(
  options: DiscoverPluginsOptions = {},
): Promise<Plugin[]> {
  const cwd = options.cwd ?? process.cwd();
  const prefix = options.prefix ?? "curio-plugin-";
  const pkgPath = path.join(cwd, "package.json");

  let pkgRaw: string;
  try {
    pkgRaw = await fs.readFile(pkgPath, "utf8");
  } catch {
    // No package.json — nothing to discover.
    return [];
  }

  let pkg: any;
  try {
    pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
  } catch {
    return [];
  }

  const depSections = [
    (pkg.dependencies ?? {}) as Record<string, string>,
    (pkg.devDependencies ?? {}) as Record<string, string>,
    (pkg.optionalDependencies ?? {}) as Record<string, string>,
  ];

  const seenNames = new Set<string>();
  const pluginNames: string[] = [];
  for (const deps of depSections) {
    for (const name of Object.keys(deps)) {
      if (name.startsWith(prefix) && !seenNames.has(name)) {
        seenNames.add(name);
        pluginNames.push(name);
      }
    }
  }

  const plugins: Plugin[] = [];

  for (const name of pluginNames) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = await import(name);
      const candidates: unknown[] = [];

      if (mod.default) candidates.push(mod.default);
      if (Array.isArray(mod.plugins)) candidates.push(...mod.plugins);
      for (const value of Object.values(mod)) {
        candidates.push(value);
      }

      for (const candidate of candidates) {
        if (isPlugin(candidate) && !plugins.find((p) => p.name === candidate.name)) {
          plugins.push(candidate);
        }
      }
    } catch {
      // Ignore modules that fail to import; discovery is best-effort.
    }
  }

  return plugins;
}

