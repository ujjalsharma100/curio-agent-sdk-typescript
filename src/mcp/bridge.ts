/**
 * MCP bridge — Component lifecycle for MCP servers.
 *
 * The bridge manages one or more MCP clients as a Curio `Component`, handling
 * connection startup/shutdown and providing helpers to convert remote MCP
 * tools into Curio tools.
 */

import { Component } from "../base/component.js";
import type { MCPServerConfig } from "./config.js";
import { MCPClient } from "./client.js";
import type { Tool } from "../core/tools/tool.js";
import { createToolsFromMcpClient } from "./adapter.js";

export interface MCPBridgeOptions {
  /** Normalized server configurations (typically from `loadMcpConfig()`). */
  servers: MCPServerConfig[];
  /** Optional client name reported to MCP servers. Default: "curio-agent-sdk". */
  clientName?: string;
  /** Optional client version reported to MCP servers. Default: "0.0.0". */
  clientVersion?: string;
}

/**
 * Bridge between Curio components and one or more MCP servers.
 *
 * Typical usage:
 *
 * ```ts
 * const servers = await loadMcpConfig("claude_desktop_config.json");
 * const bridge = new MCPBridge({ servers });
 * await bridge.startup();
 *
 * const mcpTools = await bridge.getTools();
 * const agent = Agent.builder().tools(mcpTools).build();
 * ```
 */
export class MCPBridge extends Component {
  private readonly options: MCPBridgeOptions;
  private readonly clients = new Map<string, MCPClient>();

  constructor(options: MCPBridgeOptions) {
    super();
    this.options = options;
  }

  /** Connect to all configured MCP servers. */
  async startup(): Promise<void> {
    if (this.initialized) return;

    this.clients.clear();
    for (const server of this.options.servers) {
      const client = new MCPClient({
        name: this.options.clientName ?? "curio-agent-sdk",
        version: this.options.clientVersion ?? "0.0.0",
        transport: server.transport,
      });
      await client.connect();
      this.clients.set(server.name, client);
    }

    this.markInitialized();
  }

  /** Disconnect from all MCP servers. */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      this.clients.clear();
      return;
    }

    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();

    this.markShutdown();
  }

  /** Get the connected MCPClient for a specific server, if available. */
  getClient(serverName: string): MCPClient | undefined {
    return this.clients.get(serverName);
  }

  /**
   * Get a read-only map of all connected clients.
   *
   * The bridge must be started before this is called; if it is not yet
   * started, startup() is invoked automatically.
   */
  async getAllClients(): Promise<ReadonlyMap<string, MCPClient>> {
    if (!this.initialized) {
      await this.startup();
    }
    return this.clients;
  }

  /**
   * Discover and convert tools from all (or a subset of) MCP servers into
   * Curio tools ready to be registered on an Agent.
   *
   * @param filter Optional list of server names to include; if omitted, all
   *               configured servers are queried.
   */
  async getTools(filter?: string[]): Promise<Tool[]> {
    if (!this.initialized) {
      await this.startup();
    }

    const result: Tool[] = [];
    const serverNames = filter && filter.length > 0 ? filter : Array.from(this.clients.keys());

    for (const name of serverNames) {
      const client = this.clients.get(name);
      if (!client) continue;
      const tools = await createToolsFromMcpClient(name, client);
      result.push(...tools);
    }

    return result;
  }
}

