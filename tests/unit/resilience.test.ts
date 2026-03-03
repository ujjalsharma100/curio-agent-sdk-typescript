import { describe, it, expect, vi } from "vitest";
import {
  BaseConnector,
  ConnectorBridge,
  EnvCredentialResolver,
  VaultCredentialResolver,
  resolveCredentialChain,
  resolveCredentialOrThrow,
  CircuitBreaker,
  LLMClient,
  LLMProviderError,
} from "../../src/index.js";
import type { ConnectorRequestContext, LLMRequest, LLMResponse, LLMStreamChunk, ProviderConfig } from "../../src/index.js";

class MockConnector extends BaseConnector<{ value: string }, { echoed: string }> {
  connectCalls = 0;
  disconnectCalls = 0;

  constructor(name = "mock") {
    super({ name });
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.markInitialized();
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.markShutdown();
  }

  async request(
    request: { value: string },
    _context?: ConnectorRequestContext,
  ): Promise<{ echoed: string }> {
    return { echoed: request.value };
  }

  async healthCheck(): Promise<boolean> {
    return this.connected;
  }
}

function createProvider(
  name: string,
  callImpl: (req: LLMRequest) => Promise<LLMResponse>,
): {
  name: string;
  supportedModels: string[];
  supportsModel: (model: string) => boolean;
  call: (request: LLMRequest, config: ProviderConfig) => Promise<LLMResponse>;
  stream: (request: LLMRequest, config: ProviderConfig) => AsyncIterableIterator<LLMStreamChunk>;
  callMock: ReturnType<typeof vi.fn>;
} {
  const callMock = vi.fn<[LLMRequest, ProviderConfig], Promise<LLMResponse>>(
    async (request: LLMRequest) => callImpl(request),
  );
  return {
    name,
    supportedModels: ["model-a", "model-b"],
    supportsModel: (model: string) => model === "model-a" || model === "model-b",
    call: callMock,
    async *stream(_request: LLMRequest, _config: ProviderConfig): AsyncIterableIterator<LLMStreamChunk> {
      yield { type: "text_delta", text: "stream" };
      yield { type: "done", finishReason: "stop" };
    },
    callMock,
  };
}

describe("Resilience: ConnectorBridge", () => {
  it("starts, routes requests, and shuts down connectors", async () => {
    const connector = new MockConnector("svc");
    const bridge = new ConnectorBridge({ connectors: [connector] });

    await bridge.startup();
    expect(connector.connectCalls).toBe(1);
    expect(await bridge.healthCheck()).toBe(true);

    const response = await bridge.request<{ value: string }, { echoed: string }>("svc", { value: "hello" });
    expect(response).toEqual({ echoed: "hello" });

    await bridge.shutdown();
    expect(connector.disconnectCalls).toBe(1);
  });
});

describe("Resilience: Credential resolvers", () => {
  it("resolves env credentials with prefix fallback", async () => {
    const resolver = new EnvCredentialResolver({
      env: { CURIO_API_KEY: "secret-123" },
      prefix: "CURIO_",
    });

    await expect(resolver.resolve("api_key")).resolves.toBe("secret-123");
  });

  it("resolves credentials from chain and supports required mode", async () => {
    const first = new EnvCredentialResolver({ env: {} });
    const second = new EnvCredentialResolver({ env: { TOKEN: "abc" } });

    await expect(resolveCredentialChain("TOKEN", [first, second])).resolves.toBe("abc");
    await expect(resolveCredentialOrThrow("MISSING", [first])).rejects.toThrow();
  });

  it("resolves vault kv-v2 secret field", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            data: {
              apiKey: "vault-value",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const resolver = new VaultCredentialResolver({
      address: "https://vault.example.com",
      token: "vault-token",
      fetchImpl,
    });

    await expect(resolver.resolve("service/curio#apiKey")).resolves.toBe("vault-value");
  });
});

describe("Resilience: CircuitBreaker", () => {
  it("opens after threshold and closes after successful half-open probe", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 5,
      successThreshold: 1,
      halfOpenMaxCalls: 1,
    });

    await expect(breaker.execute(async () => Promise.reject(new Error("boom-1")))).rejects.toThrow("boom-1");
    await expect(breaker.execute(async () => Promise.reject(new Error("boom-2")))).rejects.toThrow("boom-2");
    expect(breaker.state).toBe("open");

    await new Promise((resolve) => setTimeout(resolve, 8));
    await expect(breaker.execute(async () => "ok")).resolves.toBe("ok");
    expect(breaker.state).toBe("closed");
  });
});

describe("Resilience: LLM failover with circuit breaker", () => {
  it("falls back to lower tier model and avoids repeated open-circuit calls", async () => {
    const primary = createProvider("primary", async () => {
      throw new LLMProviderError("primary down", { provider: "primary", statusCode: 503 });
    });
    const fallback = createProvider("fallback", async (request: LLMRequest) => ({
      content: `ok:${request.model}`,
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: request.model,
      finishReason: "stop",
    }));

    const client = new LLMClient({
      autoDiscover: false,
      dedup: false,
      maxRetries: 0,
      router: {
        tier1: { models: ["fallback:model-b"] },
        tier2: { models: ["primary:model-a"] },
      },
      circuitBreaker: {
        failureThreshold: 1,
        recoveryTimeoutMs: 60_000,
      },
    });
    client.registerProvider(primary);
    client.registerProvider(fallback);

    const first = await client.call({
      model: "tier2",
      messages: [{ role: "user", content: "hello" }],
    });
    const second = await client.call({
      model: "tier2",
      messages: [{ role: "user", content: "hello again" }],
    });

    expect(first.content).toBe("ok:model-b");
    expect(second.content).toBe("ok:model-b");
    expect(primary.callMock).toHaveBeenCalledTimes(1);
    expect(fallback.callMock).toHaveBeenCalledTimes(2);
  });
});
