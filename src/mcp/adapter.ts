/**
 * Adapters between MCP tools and Curio tools.
 *
 * MCP servers expose tools described by JSON Schema. This module converts
 * those MCP tool definitions into Curio `Tool` instances so that they can be
 * registered in an agent's ToolRegistry like any other tool.
 */

import type { ToolSchema } from "../models/llm.js";
import { Tool } from "../core/tools/tool.js";
import type { MCPClient, MCPToolDescriptor } from "./client.js";

export interface MCPToolAdapterOptions {
  /** The logical MCP server name (used for namespacing tools). */
  serverName: string;
  /** Connected MCP client for the target server. */
  client: MCPClient;
  /** Tool descriptor returned by the MCP server. */
  tool: MCPToolDescriptor;
}

/**
 * Convert a single MCP tool descriptor into a Curio `Tool`.
 *
 * The resulting tool is named `<serverName>:<toolName>` to avoid collisions
 * when multiple MCP servers expose tools with the same name.
 */
export function mcpToolToCurioTool(options: MCPToolAdapterOptions): Tool {
  const { serverName, client, tool } = options;

  const fullName = `${serverName}:${tool.name}`;
  const description =
    tool.description ??
    `MCP tool "${tool.name}" exposed by server "${serverName}".`;

  const schema: ToolSchema = {
    name: fullName,
    description,
    // Prefer the JSON Schema provided by the MCP server; fall back to an
    // empty object schema if none is available.
    parameters:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? (tool.inputSchema as Record<string, unknown>)
        : { type: "object", properties: {} },
  };

  return new Tool({
    name: fullName,
    description,
    schema,
    execute: async (args) => {
      const result = await client.callTool(tool.name, args);
      if (typeof result === "string") {
        return result;
      }
      try {
        return JSON.stringify(result);
      } catch {
        return String(result);
      }
    },
  });
}

/**
 * Discover all tools exposed by an MCP server and convert them into Curio
 * tools. This is a convenience helper for wiring MCP servers into an agent.
 */
export async function createToolsFromMcpClient(
  serverName: string,
  client: MCPClient,
): Promise<Tool[]> {
  const tools = await client.listTools();
  return tools.map((t) =>
    mcpToolToCurioTool({
      serverName,
      client,
      tool: t,
    }),
  );
}

