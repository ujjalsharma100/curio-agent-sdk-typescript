/**
 * High-level MCP client wrapper.
 *
 * This module provides a thin, dependency-light wrapper around the official
 * MCP TypeScript SDK so that Curio agents can:
 * - connect to MCP servers over stdio or HTTP/SSE
 * - list tools, resources, and prompts
 * - call tools and read resources
 *
 * The underlying SDK types are deliberately treated as `unknown`/`any` so that
 * changes in the MCP package surface area do not break this SDK.
 */

import type { MCPTransportConfig } from "./transport.js";
import { createMcpTransport, loadMcpSdk } from "./transport.js";

/** Basic description of a tool as returned by an MCP server. */
export interface MCPToolDescriptor {
  name: string;
  description?: string | null;
  /** JSON Schema describing the tool's parameters (if provided by the server). */
  inputSchema?: unknown;
}

/** Basic description of a resource exposed by an MCP server. */
export interface MCPResourceDescriptor {
  uri: string;
  name?: string | null;
  description?: string | null;
  mimeType?: string | null;
}

/** Result of reading a resource. */
export interface MCPResourceReadResult {
  uri: string;
  /** The decoded content (string, JSON, or raw object) of the resource. */
  contents: unknown;
  mimeType?: string | null;
}

/** Basic description of a prompt exposed by an MCP server. */
export interface MCPPromptDescriptor {
  name: string;
  description?: string | null;
}

/** Result of retrieving a prompt definition. */
export interface MCPPromptResult {
  name: string;
  description?: string | null;
  /** The prompt messages as defined by the server. */
  messages: unknown;
}

/** Options for constructing an MCPClient. */
export interface MCPClientOptions {
  /**
   * Client name reported to the MCP server.
   * Defaults to "curio-agent-sdk".
   */
  name?: string;
  /**
   * Client version reported to the MCP server.
   * Defaults to "0.0.0".
   */
  version?: string;
  /** Transport configuration describing how to reach the MCP server. */
  transport: MCPTransportConfig;
}

/**
 * Wrapper around the MCP SDK `Client` that exposes a stable, minimal surface
 * tailored to Curio's agent abstraction.
 */
export class MCPClient {
  private readonly options: MCPClientOptions;
  private client: unknown | null = null;
  private _connected = false;

  constructor(options: MCPClientOptions) {
    this.options = options;
  }

  /** Whether the underlying MCP client is currently connected. */
  get connected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the MCP server. Safe to call multiple times; subsequent calls
   * are no-ops once connected.
   */
  async connect(): Promise<void> {
    if (this._connected && this.client) return;

    const sdk = await loadMcpSdk();
    const ClientCtor = sdk.Client;

    if (!ClientCtor) {
      throw new Error(
        'The installed "@modelcontextprotocol/sdk" does not expose a Client class. ' +
          "Upgrade the SDK to a recent version.",
      );
    }

    const client = new ClientCtor({
      name: this.options.name ?? "curio-agent-sdk",
      version: this.options.version ?? "0.0.0",
    });

    const transport = await createMcpTransport(this.options.transport);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).connect(transport);

    this.client = client;
    this._connected = true;
  }

  /**
   * Disconnect from the MCP server, if connected.
   */
  async disconnect(): Promise<void> {
    if (!this._connected || !this.client) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = this.client as any;
    if (typeof c.close === "function") {
      await c.close();
    }
    this.client = null;
    this._connected = false;
  }

  private async ensureConnected(): Promise<void> {
    if (!this._connected || !this.client) {
      await this.connect();
    }
  }

  /**
   * List tools exposed by the connected MCP server.
   */
  async listTools(): Promise<MCPToolDescriptor[]> {
    await this.ensureConnected();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = this.client as any;
    const result = await c.listTools();
    const tools = (result?.tools ?? []) as Array<{
      name: string;
      description?: string | null;
      inputSchema?: unknown;
      input_schema?: unknown;
    }>;

    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? null,
      inputSchema: t.inputSchema ?? t.input_schema,
    }));
  }

  /**
   * Call a tool by name with the provided arguments.
   *
   * The underlying MCP client may return either a success or an error payload;
   * tool-level errors (result.isError === true) are converted into thrown
   * Errors so that callers can rely on standard exception handling.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = this.client as any;
    const result = await c.callTool({ name, arguments: args });

    if (result && typeof result === "object" && "isError" in result && (result as { isError?: boolean }).isError) {
      const content = (result as { content?: unknown }).content;
      throw new Error(
        `MCP tool "${name}" reported an error: ${
          typeof content === "string" ? content : JSON.stringify(content)
        }`,
      );
    }

    return (result as { content?: unknown })?.content ?? result;
  }

  /**
   * List resources exposed by the MCP server.
   */
  async listResources(): Promise<MCPResourceDescriptor[]> {
    await this.ensureConnected();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = this.client as any;
    const result = await c.listResources();
    const resources = (result?.resources ?? []) as Array<{
      uri?: string;
      name?: string | null;
      description?: string | null;
      mimeType?: string | null;
      mime_type?: string | null;
    }>;

    return resources
      .filter((r) => r.uri)
      .map((r) => ({
        uri: r.uri as string,
        name: r.name ?? null,
        description: r.description ?? null,
        mimeType: r.mimeType ?? r.mime_type ?? null,
      }));
  }

  /**
   * Read the contents of a resource identified by URI.
   */
  async readResource(uri: string): Promise<MCPResourceReadResult> {
    await this.ensureConnected();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = this.client as any;
    const result = await c.readResource({ uri });
    const contentsArray = (result?.contents ?? []) as Array<{
      mimeType?: string | null;
      mime_type?: string | null;
      text?: string;
      value?: unknown;
    }>;

    const first = contentsArray[0] ?? {};
    const mimeType = first.mimeType ?? first.mime_type ?? null;
    const contents = first.text ?? first.value ?? first ?? result;

    return {
      uri,
      contents,
      mimeType,
    };
  }

  /**
   * List prompts exposed by the MCP server.
   */
  async listPrompts(): Promise<MCPPromptDescriptor[]> {
    await this.ensureConnected();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = this.client as any;
    const result = await c.listPrompts();
    const prompts = (result?.prompts ?? []) as Array<{
      name: string;
      description?: string | null;
    }>;

    return prompts.map((p) => ({
      name: p.name,
      description: p.description ?? null,
    }));
  }

  /**
   * Get a prompt definition (messages + metadata) by name.
   */
  async getPrompt(name: string, args?: Record<string, unknown>): Promise<MCPPromptResult> {
    await this.ensureConnected();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = this.client as any;
    const result = await c.getPrompt({ name, arguments: args });

    return {
      name: (result?.name as string | undefined) ?? name,
      description: (result?.description as string | undefined) ?? null,
      messages: (result?.messages as unknown) ?? result,
    };
  }
}

