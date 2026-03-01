/**
 * Agent builder — fluent API for constructing agents.
 *
 * Usage:
 * ```typescript
 * const agent = Agent.builder()
 *   .model("anthropic:claude-sonnet-4-6")
 *   .systemPrompt("You are a helpful assistant.")
 *   .tools([myTool1, myTool2])
 *   .maxIterations(20)
 *   .build();
 * ```
 */

import type { HookHandler } from "../../models/events.js";
import type { ILLMClient } from "../llm/client.js";
import type { AgentLoop } from "../loops/base.js";
import type { StateStore } from "../state/state-store.js";
import type { SessionManager } from "../state/session.js";
import type { Middleware } from "../../middleware/base.js";
import type { MemoryManager } from "../../memory/manager.js";
import type { ContextManager } from "../context/context.js";
import { Tool } from "../tools/tool.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import { HookRegistry } from "../events/hooks.js";
import { MiddlewarePipeline } from "../../middleware/base.js";
import { ToolCallingLoop } from "../loops/tool-calling.js";
import { Runtime } from "./runtime.js";
import { generateShortId } from "../../utils/hash.js";

import { Agent } from "./agent.js";

/** Configuration accumulated by the builder before build(). */
export interface AgentConfig {
  model: string;
  systemPrompt: string | (() => string);
  tools: Tool[];
  llmClient?: ILLMClient;
  loop?: AgentLoop;
  hooks: Array<{ event: string; handler: HookHandler; priority?: number }>;
  middleware: Middleware[];
  maxIterations: number;
  timeout: number;
  agentId: string;
  agentName: string;
  onEvent?: (event: unknown) => void;
  metadata: Record<string, unknown>;
  stateStore?: StateStore;
  sessionManager?: SessionManager;
  memoryManager?: MemoryManager;
  contextManager?: ContextManager;
}

export class AgentBuilder {
  private config: AgentConfig = {
    model: "",
    systemPrompt: "",
    tools: [],
    hooks: [],
    middleware: [],
    maxIterations: 50,
    timeout: 0,
    agentId: generateShortId(),
    agentName: "curio-agent",
    metadata: {},
  };

  /** Set the model (e.g., "anthropic:claude-sonnet-4-6", "openai:gpt-4o"). */
  model(model: string): this {
    this.config.model = model;
    return this;
  }

  /** Set the system prompt. Can be a string or a function returning a string (lazy evaluation). */
  systemPrompt(prompt: string | (() => string)): this {
    this.config.systemPrompt = prompt;
    return this;
  }

  /** Add multiple tools. */
  tools(tools: Tool[]): this {
    this.config.tools.push(...tools);
    return this;
  }

  /** Add a single tool. */
  tool(tool: Tool): this {
    this.config.tools.push(tool);
    return this;
  }

  /** Set the LLM client directly (bypasses provider auto-detection). */
  llmClient(client: ILLMClient): this {
    this.config.llmClient = client;
    return this;
  }

  /** Set a custom agent loop (overrides the default ToolCallingLoop). */
  loop(loop: AgentLoop): this {
    this.config.loop = loop;
    return this;
  }

  /** Register a hook handler. */
  hook(event: string, handler: HookHandler, priority?: number): this {
    this.config.hooks.push({ event, handler, priority });
    return this;
  }

  /** Set the maximum number of loop iterations per run. Default: 50. */
  maxIterations(n: number): this {
    this.config.maxIterations = n;
    return this;
  }

  /** Set the run timeout in milliseconds. 0 = no timeout. Default: 0. */
  timeout(ms: number): this {
    this.config.timeout = ms;
    return this;
  }

  /** Set the agent ID. Auto-generated if not provided. */
  agentId(id: string): this {
    this.config.agentId = id;
    return this;
  }

  /** Set the agent name. */
  agentName(name: string): this {
    this.config.agentName = name;
    return this;
  }

  /** Set an event callback (legacy style). */
  onEvent(handler: (event: unknown) => void): this {
    this.config.onEvent = handler;
    return this;
  }

  /** Set arbitrary metadata on the agent. */
  metadata(key: string, value: unknown): this {
    this.config.metadata[key] = value;
    return this;
  }

  /** Set the middleware pipeline (replaces any previously set middleware). */
  middleware(middleware: Middleware[]): this {
    this.config.middleware = [...middleware];
    return this;
  }

  /** Add a single middleware to the pipeline. */
  addMiddleware(mw: Middleware): this {
    this.config.middleware.push(mw);
    return this;
  }

  /** Set the state store for run persistence (save/load/resume). */
  stateStore(store: StateStore): this {
    this.config.stateStore = store;
    return this;
  }

  /** Set the session manager for multi-turn conversation history. */
  sessionManager(manager: SessionManager): this {
    this.config.sessionManager = manager;
    return this;
  }

  /** Set the memory manager for memory injection, saving, and querying. */
  memoryManager(manager: MemoryManager): this {
    this.config.memoryManager = manager;
    return this;
  }

  /** Set the context manager for token budget enforcement and message fitting. */
  contextManager(manager: ContextManager): this {
    this.config.contextManager = manager;
    return this;
  }

  /** Build the agent. Requires at minimum a model and an LLM client. */
  build(): Agent {
    // Build tool registry
    const toolRegistry = new ToolRegistry();
    for (const tool of this.config.tools) {
      toolRegistry.register(tool);
    }

    // Build hook registry
    const hookRegistry = new HookRegistry();
    for (const { event, handler, priority } of this.config.hooks) {
      hookRegistry.on(event, handler, priority);
    }

    // Build middleware pipeline and wrap LLM client
    const pipeline = new MiddlewarePipeline(this.config.middleware, { hookRegistry });
    let llmClient = this.config.llmClient;
    if (!llmClient) {
      throw new Error(
        "An LLM client is required. Call .llmClient(client) on the builder. " +
          "Full provider auto-detection will be available in Phase 3.",
      );
    }
    if (this.config.middleware.length > 0) {
      llmClient = pipeline.wrapLLMClient(llmClient);
    }

    // Build tool executor (with hook registry and optional pipeline for tool middleware)
    const toolExecutor = new ToolExecutor(toolRegistry, {
      hookRegistry,
      middlewarePipeline: this.config.middleware.length > 0 ? pipeline : undefined,
    });

    const loop =
      this.config.loop ??
      new ToolCallingLoop(llmClient, toolExecutor, hookRegistry, {
        contextManager: this.config.contextManager,
      });

    // Register memory manager tools if present
    if (this.config.memoryManager) {
      for (const t of this.config.memoryManager.getTools()) {
        if (!toolRegistry.has(t.name)) {
          toolRegistry.register(t);
        }
      }
    }

    // Build runtime
    const runtime = new Runtime({
      loop,
      hooks: hookRegistry,
      toolRegistry,
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      maxIterations: this.config.maxIterations,
      timeout: this.config.timeout,
      agentId: this.config.agentId,
      stateStore: this.config.stateStore,
      memoryManager: this.config.memoryManager,
    });

    return new Agent({
      runtime,
      agentId: this.config.agentId,
      agentName: this.config.agentName,
      model: this.config.model,
      toolRegistry,
      hookRegistry,
      metadata: this.config.metadata,
      sessionManager: this.config.sessionManager,
    });
  }
}
