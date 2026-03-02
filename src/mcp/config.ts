/**
 * MCP configuration parsing.
 *
 * This module understands common MCP configuration formats used by tools like
 * Claude Desktop and Cursor, and turns them into normalized transport configs
 * that the Curio SDK can consume.
 *
 * The primary supported format is a JSON/YAML object with a top-level
 * `mcpServers` (or `servers`) map:
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "filesystem": {
 *       "type": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem"],
 *       "env": { "ROOT": "$HOME/projects" }
 *     }
 *   }
 * }
 * ```
 */

import fs from "node:fs/promises";
import type {
  MCPHttpTransportConfig,
  MCPStdioTransportConfig,
  MCPTransportConfig,
  MCPTransportType,
} from "./transport.js";
import YAML from "yaml";

/** Raw, un-normalized configuration for a single MCP server. */
export interface RawMCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Transport type: "stdio" (default), "http", or "sse". */
  type?: MCPTransportType | string;
  /** Base URL for HTTP/SSE transports. */
  url?: string;
  /** Optional HTTP headers for HTTP/SSE transports. */
  headers?: Record<string, string>;
}

/** Raw MCP config file shape (JSON/YAML) before normalization. */
export interface RawMcpConfigFile {
  mcpServers?: Record<string, RawMCPServerConfig>;
  /** Some tools use "servers" instead of "mcpServers"; support both. */
  servers?: Record<string, RawMCPServerConfig>;
}

/** Normalized server configuration used by the rest of the SDK. */
export interface MCPServerConfig {
  /** Logical server name (e.g., "filesystem", "memory"). */
  name: string;
  /** Transport details for connecting to the server. */
  transport: MCPTransportConfig;
  /** Optional normalized environment variables for the server process. */
  env?: Record<string, string>;
}

export interface LoadMcpConfigOptions {
  /** Environment used for $VAR interpolation. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Load and parse an MCP configuration file (JSON or YAML) from disk.
 */
export async function loadMcpConfig(
  filePath: string,
  options?: LoadMcpConfigOptions,
): Promise<MCPServerConfig[]> {
  const text = await fs.readFile(filePath, "utf8");
  return parseMcpConfigText(text, options);
}

/**
 * Parse configuration from a JSON/YAML string.
 */
export function parseMcpConfigText(
  text: string,
  options?: LoadMcpConfigOptions,
): MCPServerConfig[] {
  const env = options?.env ?? process.env;
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    raw = YAML.parse(text);
  }

  return parseMcpConfig(raw, { env });
}

/**
 * Normalize a raw configuration object into a list of MCPServerConfig entries.
 */
export function parseMcpConfig(
  config: unknown,
  options?: LoadMcpConfigOptions,
): MCPServerConfig[] {
  const env = options?.env ?? process.env;
  if (!config || typeof config !== "object") return [];

  const raw = config as RawMcpConfigFile;
  const servers = raw.mcpServers ?? raw.servers ?? {};
  const result: MCPServerConfig[] = [];

  for (const [name, server] of Object.entries(servers)) {
    if (!server) continue;

    const resolvedEnv = server.env
      ? Object.fromEntries(
          Object.entries(server.env).map(([k, v]) => [k, resolveEnvString(v, env)]),
        )
      : undefined;

    const type = normalizeTransportType(server.type);

    if (type === "stdio") {
      const command = server.command ? resolveEnvString(server.command, env) : undefined;
      if (!command) continue;
      const args = server.args?.map((a) => resolveEnvString(a, env));
      const stdio: MCPStdioTransportConfig = {
        type: "stdio",
        command,
        args,
        env: resolvedEnv,
      };
      result.push({
        name,
        transport: stdio,
        env: resolvedEnv,
      });
      continue;
    }

    const url = server.url ? resolveEnvString(server.url, env) : undefined;
    if (!url) continue;

    const headers = server.headers
      ? Object.fromEntries(
          Object.entries(server.headers).map(([k, v]) => [k, resolveEnvString(v, env)]),
        )
      : undefined;

    const http: MCPHttpTransportConfig = {
      type: type,
      url,
      headers,
    };

    result.push({
      name,
      transport: http,
      env: resolvedEnv,
    });
  }

  return result;
}

function normalizeTransportType(type: MCPTransportType | string | undefined): MCPTransportType {
  if (!type) {
    return "stdio";
  }

  const value = String(type).toLowerCase() as MCPTransportType | string;
  if (value === "stdio") return "stdio";
  if (value === "sse") return "sse";
  if (value === "http" || value === "https" || value === "streamable_http") return "http";

  // Fallback to stdio if an unknown type is provided.
  return "stdio";
}

/**
 * Replace $VAR or ${VAR} placeholders in a string with values from the
 * provided environment map. Unset variables are replaced with the empty
 * string, matching common shell semantics.
 */
function resolveEnvString(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$(\w+)|\$\{([^}]+)\}/g, (_match, var1, var2) => {
    const key = (var1 ?? var2) as string;
    const replacement = env[key];
    return replacement ?? "";
  });
}

// (No value export for MCPTransportType here; consumers should import the type
// directly from ./transport.js.)
