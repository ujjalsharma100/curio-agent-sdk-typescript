/**
 * MCP client transports.
 *
 * This module defines a small, SDK-agnostic transport configuration layer and
 * helpers that create concrete transports from the official MCP TypeScript
 * SDK at runtime. We rely on the client subpath exports (e.g.
 * `@modelcontextprotocol/sdk/client/index.js`) rather than the package root so
 * that we work across SDK versions and avoid depending on a particular
 * top-level entrypoint.
 *
 * The MCP SDK is an optional dependency and is loaded lazily via dynamic
 * `import()` so that projects which do not use MCP do not pay the cost.
 */

export type MCPTransportType = "stdio" | "http" | "sse";

/** Configuration for a stdio-based MCP server (spawned local process). */
export interface MCPStdioTransportConfig {
  type: "stdio";
  /** Command to launch the MCP server (e.g., "node", "python", "npx"). */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Environment variables for the spawned process. */
  env?: Record<string, string>;
  /** Optional working directory for the server process. */
  cwd?: string;
}

/** Configuration for an HTTP/SSE-based MCP server. */
export interface MCPHttpTransportConfig {
  /** "http" uses Streamable HTTP when available, "sse" forces SSE. */
  type: "http" | "sse";
  /** Base URL for the MCP server (e.g., http://localhost:3000/mcp). */
  url: string;
  /** Optional HTTP headers (auth, tracing, etc.). */
  headers?: Record<string, string>;
}

/** Union of all supported transport configs. */
export type MCPTransportConfig = MCPStdioTransportConfig | MCPHttpTransportConfig;

/**
 * Minimal shape of the MCP TypeScript SDK module we care about.
 * Everything is typed as `unknown`/`any` and validated at runtime so that
 * changes in the SDK surface area do not break our build.
 */
interface McpSdkModule {
  Client?: new (info: { name: string; version: string }) => unknown;
  StdioClientTransport?: new (options: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  }) => unknown;
  SSEClientTransport?: new (url: URL, options?: { headers?: Record<string, string> }) => unknown;
}

let cachedSdk: McpSdkModule | null = null;

/**
 * Load the optional MCP client SDK at runtime.
 *
 * Throws a clear error if the dependency is missing so that consumers know
 * they must install it to use MCP features.
 */
export async function loadMcpSdk(): Promise<McpSdkModule> {
  if (cachedSdk) return cachedSdk;

  try {
    // Client core (Client class)
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    const clientMod: unknown = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );

    // Transports — best-effort loading; individual imports may fail if the
    // installed SDK is older or lacks a particular transport.
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    let stdioMod: unknown;
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    let sseMod: unknown;

    try {
      stdioMod = await import("@modelcontextprotocol/sdk/client/stdio.js");
    } catch {
      stdioMod = {};
    }

    try {
      sseMod = await import("@modelcontextprotocol/sdk/client/sse.js");
    } catch {
      sseMod = {};
    }

    const anyClient = clientMod as Record<string, unknown>;
    const anyStdio = stdioMod as Record<string, unknown>;
    const anySse = sseMod as Record<string, unknown>;

    cachedSdk = {
      Client: (anyClient["Client"] as McpSdkModule["Client"]) ?? undefined,
      StdioClientTransport:
        (anyStdio["StdioClientTransport"] as McpSdkModule["StdioClientTransport"]) ??
        undefined,
      SSEClientTransport:
        (anySse["SSEClientTransport"] as McpSdkModule["SSEClientTransport"]) ??
        undefined,
    };

    return cachedSdk;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error loading MCP client SDK";
    throw new Error(
      `Optional dependency "@modelcontextprotocol/sdk" (client subpaths) is required for MCP features but could not be loaded: ${message}. ` +
        'Install a recent version with `npm install @modelcontextprotocol/sdk`.',
    );
  }
}

/**
 * Create a concrete MCP client transport from a high-level transport config.
 *
 * The returned object is an instance of one of:
 * - StdioClientTransport
 * - StreamableHTTPClientTransport
 * - SSEClientTransport
 *
 * The exact class comes from the installed `@modelcontextprotocol/sdk` version.
 */
export async function createMcpTransport(config: MCPTransportConfig): Promise<unknown> {
  const sdk = await loadMcpSdk();

  if (config.type === "stdio") {
    const StdioCtor = sdk.StdioClientTransport;
    if (!StdioCtor) {
      throw new Error(
        'The installed MCP SDK does not expose StdioClientTransport. Upgrade "@modelcontextprotocol/sdk" to a recent version.',
      );
    }

    return new (StdioCtor as unknown as new (options: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }) => unknown)({
      command: (config as MCPStdioTransportConfig).command,
      args: (config as MCPStdioTransportConfig).args,
      env: (config as MCPStdioTransportConfig).env,
      cwd: (config as MCPStdioTransportConfig).cwd,
    });
  }

  const url = new URL((config as MCPHttpTransportConfig).url);
  const headers = (config as MCPHttpTransportConfig).headers;

  if (config.type === "http") {
    // Use SSE transport for HTTP-style servers when available.
    const HttpCtor = sdk.SSEClientTransport;

    if (!HttpCtor) {
      throw new Error(
        'The installed MCP SDK does not expose StreamableHTTPClientTransport or SSEClientTransport. Upgrade "@modelcontextprotocol/sdk" to a recent version.',
      );
    }

    return new (HttpCtor as unknown as new (url: URL, options?: { headers?: Record<string, string> }) => unknown)(url, {
      headers,
    });
  }

  // Fallback: explicit SSE transport.
  const SseCtor = sdk.SSEClientTransport;
  if (!SseCtor) {
    throw new Error(
      'The installed MCP SDK does not expose SSEClientTransport. Upgrade "@modelcontextprotocol/sdk" to a recent version.',
    );
  }

  return new (SseCtor as unknown as new (url: URL, options?: { headers?: Record<string, string> }) => unknown)(url, {
    headers,
  });
}

