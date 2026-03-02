import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadMcpConfig,
  parseMcpConfig,
  parseMcpConfigText,
  type MCPServerConfig,
} from "../../src/mcp/config.js";
import { MCPClient, type MCPToolDescriptor } from "../../src/mcp/client.js";
import { mcpToolToCurioTool, createToolsFromMcpClient } from "../../src/mcp/adapter.js";
import { MCPBridge } from "../../src/mcp/bridge.js";
import type { MCPTransportConfig } from "../../src/mcp/transport.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

describe("MCP config parsing", () => {
  it("parses stdio server with env interpolation", () => {
    const config = {
      mcpServers: {
        filesystem: {
          type: "stdio",
          command: "$SHELL_CMD",
          args: ["-y", "${PKG_NAME}"],
          env: {
            ROOT: "$HOME/projects",
          },
        },
      },
    };

    const env = makeEnv({
      SHELL_CMD: "npx",
      PKG_NAME: "@modelcontextprotocol/server-filesystem",
      HOME: "/home/test",
    });

    const servers = parseMcpConfig(config, { env });
    expect(servers).toHaveLength(1);
    const server = servers[0] as MCPServerConfig;
    expect(server.name).toBe("filesystem");
    expect(server.transport.type).toBe("stdio");
    expect((server.transport as Extract<MCPTransportConfig, { type: "stdio" }>).command).toBe(
      "npx",
    );
    expect(
      (server.transport as Extract<MCPTransportConfig, { type: "stdio" }>).args,
    ).toEqual(["-y", "@modelcontextprotocol/server-filesystem"]);
    expect(server.env?.ROOT).toBe("/home/test/projects");
  });

  it("parses http server config and falls back when type missing", () => {
    const config = {
      mcpServers: {
        remote: {
          type: "http",
          url: "http://localhost:3000/mcp",
          headers: {
            Authorization: "Bearer $TOKEN",
          },
        },
      },
    };

    const env = makeEnv({ TOKEN: "secret" });
    const servers = parseMcpConfig(config, { env });
    expect(servers).toHaveLength(1);
    const server = servers[0] as MCPServerConfig;
    expect(server.name).toBe("remote");
    expect(server.transport.type).toBe("http");
  });

  it("parses YAML/JSON text via loadMcpConfigText helpers", async () => {
    const yamlText = `
mcpServers:
  memory:
    type: sse
    url: "https://example.com/mcp"
    headers:
      X-Env: "$ENV_NAME"
`;

    const env = makeEnv({ ENV_NAME: "dev" });
    const parsed = parseMcpConfigText(yamlText, { env });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("memory");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "curio-mcp-"));
    const jsonPath = path.join(tmpDir, "mcp.json");
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        mcpServers: {
          test: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
        },
      }),
      "utf8",
    );

    const fileServers = await loadMcpConfig(jsonPath);
    expect(fileServers).toHaveLength(1);
    expect(fileServers[0]?.name).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// MCPClient wrapper (with mocked @modelcontextprotocol/sdk)
// ---------------------------------------------------------------------------

describe("MCPClient", () => {
  it("connects using provided transport and exposes list/call APIs", async () => {
    const listToolsMock = vi.fn().mockResolvedValue({
      tools: [
        {
          name: "echo",
          description: "Echo text",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
        } satisfies MCPToolDescriptor,
      ],
    });

    const callToolMock = vi.fn().mockResolvedValue({
      isError: false,
      content: "ok",
    });

    const mockClientInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: listToolsMock,
      callTool: callToolMock,
    };

    const transportModule = await import("../../src/mcp/transport.js");
    vi.spyOn(transportModule, "loadMcpSdk").mockResolvedValue({
      Client: class {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(_info: any) {
          Object.assign(this, mockClientInstance);
        }
      },
      StdioClientTransport: class {},
      StreamableHTTPClientTransport: class {},
      SSEClientTransport: class {},
    } as unknown as Awaited<ReturnType<(typeof transportModule)["loadMcpSdk"]>>);
    vi.spyOn(transportModule, "createMcpTransport").mockResolvedValue({});

    const client = new MCPClient({
      name: "test-client",
      version: "1.0.0",
      transport: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
      },
    });

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("echo");

    const result = await client.callTool("echo", { text: "hello" });
    expect(result).toBe("ok");
    expect(callToolMock).toHaveBeenCalledWith({ name: "echo", arguments: { text: "hello" } });
  });

  it("throws when tool returns isError === true", async () => {
    const mockClientInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockResolvedValue({
        isError: true,
        content: "boom",
      }),
    };

    const transportModule = await import("../../src/mcp/transport.js");
    vi.spyOn(transportModule, "loadMcpSdk").mockResolvedValue({
      Client: class {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(_info: any) {
          Object.assign(this, mockClientInstance);
        }
      },
      StdioClientTransport: class {},
      StreamableHTTPClientTransport: class {},
      SSEClientTransport: class {},
    } as unknown as Awaited<ReturnType<(typeof transportModule)["loadMcpSdk"]>>);
    vi.spyOn(transportModule, "createMcpTransport").mockResolvedValue({});

    const client = new MCPClient({
      transport: {
        type: "stdio",
        command: "node",
      },
    });

    await expect(client.callTool("bad", {})).rejects.toThrow(/reported an error/i);
  });
});

// ---------------------------------------------------------------------------
// Adapter and Bridge
// ---------------------------------------------------------------------------

describe("mcpToolToCurioTool and createToolsFromMcpClient", () => {
  it("wraps MCP tool as Curio Tool and executes via MCPClient", async () => {
    const toolDesc: MCPToolDescriptor = {
      name: "echo",
      description: "Echo text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
      },
    };

    const callTool = vi.fn().mockResolvedValue({ text: "hello" });
    const fakeClient = {
      callTool: callTool as unknown,
      listTools: vi.fn().mockResolvedValue([toolDesc]),
    } as unknown as MCPClient;

    const tool = mcpToolToCurioTool({
      serverName: "test",
      client: fakeClient,
      tool: toolDesc,
    });

    expect(tool.name).toBe("test:echo");
    const result = await tool.execute({ text: "hello" });
    expect(result).toBe(JSON.stringify({ text: "hello" }));
    expect(callTool).toHaveBeenCalledWith("echo", { text: "hello" });

    const tools = await createToolsFromMcpClient("test", fakeClient);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("test:echo");
  });
});

describe("MCPBridge", () => {
  it("starts, exposes clients, and returns tools from servers", async () => {
    const toolDesc: MCPToolDescriptor = {
      name: "echo",
      description: "Echo",
      inputSchema: { type: "object", properties: {} },
    };

    const mockInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [toolDesc] }),
      callTool: vi.fn().mockResolvedValue({ content: "ok" }),
    };

    const transportModule = await import("../../src/mcp/transport.js");
    vi.spyOn(transportModule, "loadMcpSdk").mockResolvedValue({
      Client: class {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(_info: any) {
          Object.assign(this, mockInstance);
        }
      },
      StdioClientTransport: class {},
      StreamableHTTPClientTransport: class {},
      SSEClientTransport: class {},
    } as unknown as Awaited<ReturnType<(typeof transportModule)["loadMcpSdk"]>>);
    vi.spyOn(transportModule, "createMcpTransport").mockResolvedValue({});

    const bridge = new MCPBridge({
      servers: [
        {
          name: "test-server",
          transport: {
            type: "stdio",
            command: "node",
          },
        },
      ],
    });

    await bridge.startup();
    const clients = await bridge.getAllClients();
    expect(clients.size).toBe(1);
    expect(clients.get("test-server")).toBeDefined();

    const tools = await bridge.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("test-server:echo");

    await bridge.shutdown();
  });
});

