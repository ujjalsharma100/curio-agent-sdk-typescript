import readline from "node:readline";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";

import type { AgentRunResult } from "../models/agent.js";
import type { StreamEvent } from "../models/events.js";
import { InMemorySessionStore, SessionManager } from "../core/state/session.js";
import type { Agent } from "../core/agent/agent.js";

export type SlashCommandHandler = (args: string) => void | Promise<void>;

export type KeybindingHandler = () => void | Promise<void>;

export interface CLIOptions {
  /**
   * Optional session manager for conversation persistence. If not provided,
   * the CLI will reuse any SessionManager already attached to the Agent, or
   * create an in-memory session manager as a fallback.
   */
  sessionManager?: SessionManager;

  /**
   * Optional input stream for the CLI. Defaults to process.stdin.
   */
  input?: NodeJS.ReadableStream;

  /**
   * Optional output stream for the CLI. Defaults to process.stdout.
   */
  output?: NodeJS.WritableStream;
}

interface CLICommand {
  name: string;
  handler: SlashCommandHandler;
  description?: string;
}

interface HandleUserMessageOptions {
  stream: boolean;
  useSessions: boolean;
}

/**
 * CLI harness for interactive agents.
 *
 * Wraps an `Agent` and provides:
 * - `runInteractive()` for a streaming REPL
 * - `runOnce()` for single-shot, pipe/script mode
 * - a simple slash-command system and keybinding hooks
 *
 * Session persistence:
 * - If a `SessionManager` is provided (or attached to the agent),
 *   interactive runs can create and reuse conversation sessions.
 * - When `useSessions` is true and streaming is disabled, runs will
 *   use `agent.arun(..., { sessionId })` so that history is persisted
 *   through the existing session system.
 */
export class AgentCLI {
  readonly agent: Agent;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly sessionManager?: SessionManager;

  private readonly commands = new Map<string, CLICommand>();
  private readonly keybindings = new Map<string, KeybindingHandler>();
  private currentSessionId: string | undefined;
  private shouldExit = false;

  constructor(agent: Agent, options: CLIOptions = {}) {
    this.agent = agent;
    this.input = options.input ?? defaultStdin;
    this.output = options.output ?? defaultStdout;

    // Resolve session manager: prefer explicit, then agent-attached, then in-memory.
    const existingManager = agent.sessionManager;
    const manager =
      options.sessionManager ??
      existingManager ??
      new SessionManager(new InMemorySessionStore());

    // If we created or were given a manager and the agent did not already
    // have one, attach it so Agent.arun() can participate in persistence.
    if (!existingManager && manager) {
      agent.sessionManager = manager;
    }
    this.sessionManager = manager;

    this.registerBuiltinCommands();
  }

  /**
   * Run the agent in interactive REPL mode.
   *
   * @param options.stream - If true, use streaming output (`agent.astream`).
   *                         If false, use `agent.arun` and print the final result.
   * @param options.useSessions - If true, maintain a conversation session using
   *                              the configured `SessionManager`. Session
   *                              persistence is applied when `stream === false`.
   * @param options.prompt - REPL prompt string.
   */
  async runInteractive(options?: {
    stream?: boolean;
    useSessions?: boolean;
    prompt?: string;
  }): Promise<void> {
    const stream = options?.stream ?? true;
    const useSessions = options?.useSessions ?? true;
    const prompt = options?.prompt ?? ">>> ";

    const banner =
      `Curio Agent CLI — ${this.agent.agentName} (${this.agent.agentId})\n` +
      "Type messages to talk to the agent.\n" +
      "Use /help for commands, /exit to quit.\n";
    this.output.write(`${banner}\n`);

    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
      terminal: true,
    });

    this.shouldExit = false;
    rl.setPrompt(prompt);
    rl.prompt();

    try {
      for await (const line of rl) {
        const text = typeof line === "string" ? line.trim() : String(line).trim();
        if (!text) {
          rl.prompt();
          continue;
        }

        // Keybindings: exact match of the input line.
        if (this.keybindings.has(text)) {
          await this.invokeKeybinding(text);
          if (this.shouldExit) break;
          rl.prompt();
          continue;
        }

        // Slash commands: /help, /exit, etc.
        if (text.startsWith("/")) {
          await this.runCommand(text);
          if (this.shouldExit) break;
          rl.prompt();
          continue;
        }

        // Regular user message.
        await this.handleUserMessage(text, { stream, useSessions });
        if (this.shouldExit) break;
        rl.prompt();
      }
    } finally {
      rl.close();
      await this.agent.close();
    }
  }

  /**
   * Run the agent once in a non-interactive mode.
   *
   * If stdin is not a TTY (e.g., input is piped in), the entire input stream
   * is read and sent as a single message. Otherwise, a single prompt is shown
   * and one line of input is read before exiting.
   */
  async runOnce(): Promise<void> {
    // Pipe/script mode: read from stdin when not a TTY.
    if (!(this.input as any).isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of this.input) {
        if (typeof chunk === "string") {
          chunks.push(Buffer.from(chunk));
        } else {
          chunks.push(chunk as Buffer);
        }
      }
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return;
      await this.handleUserMessage(text, { stream: false, useSessions: true });
      await this.agent.close();
      return;
    }

    // TTY mode: prompt once and exit.
    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
      terminal: true,
    });

    rl.setPrompt(">>> ");
    rl.prompt();

    try {
      const iterator = rl[Symbol.asyncIterator]() as AsyncIterator<string>;
      const { value, done } = await iterator.next();
      if (done) return;
      const text = (value ?? "").toString().trim();
      if (!text) return;
      await this.handleUserMessage(text, { stream: false, useSessions: true });
    } finally {
      rl.close();
      await this.agent.close();
    }
  }

  /**
   * Register a slash command.
   *
   * Example:
   * ```ts
   * cli.registerCommand("ping", async () => console.log("pong"));
   * // Invoked as /ping
   * ```
   */
  registerCommand(
    name: string,
    handler: SlashCommandHandler,
    description?: string,
  ): void {
    if (!name) {
      throw new Error("Command name must be non-empty");
    }
    const normalized = name.startsWith("/") ? name : `/${name}`;
    this.commands.set(normalized, { name: normalized, handler, description });
  }

  /**
   * Register a simple keybinding.
   *
   * This implementation matches the entire input line to `key` (for example,
   * typing `:r` could be bound to a "rerun" action). It does not put the
   * terminal into raw mode.
   */
  registerKeybinding(key: string, handler: KeybindingHandler): void {
    if (!key) {
      throw new Error("Keybinding key must be non-empty");
    }
    this.keybindings.set(key, handler);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async runCommand(line: string): Promise<void> {
    const [name, ...rest] = line.split(/\s+/);
    if (!name) {
      this.output.write("Command name is required.\n");
      return;
    }
    const args = rest.join(" ");
    const cmd = this.commands.get(name);
    if (!cmd) {
      this.output.write(
        `Unknown command: ${name}. Type /help for a list of commands.\n`,
      );
      return;
    }

    try {
      const result = cmd.handler(args);
      if (result && typeof (result as Promise<void>).then === "function") {
        await result;
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Unknown error: ${String(err)}`;
      this.output.write(`Command ${name} failed: ${message}\n`);
    }
  }

  private async invokeKeybinding(key: string): Promise<void> {
    const handler = this.keybindings.get(key);
    if (!handler) return;
    try {
      const result = handler();
      if (result && typeof (result as Promise<void>).then === "function") {
        await result;
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Unknown error: ${String(err)}`;
      this.output.write(`Keybinding ${key} failed: ${message}\n`);
    }
  }

  private async handleUserMessage(
    text: string,
    options: HandleUserMessageOptions,
  ): Promise<void> {
    let sessionId: string | undefined;
    if (options.useSessions && this.sessionManager) {
      if (!this.currentSessionId) {
        const session = await this.sessionManager.create(this.agent.agentId);
        this.currentSessionId = session.id;
        this.output.write(`[Created new session: ${session.id}]\n`);
      }
      sessionId = this.currentSessionId;
    }

    if (options.stream) {
      await this.streamRun(text);
    } else {
      const result = await this.agent.arun(text, { sessionId });
      this.printResult(result);
    }
  }

  private async streamRun(text: string): Promise<void> {
    this.output.write(`\nYou: ${text}\n\n`);
    for await (const event of this.agent.astream(text)) {
      this.renderStreamEvent(event);
    }
    this.output.write("\n");
  }

  private renderStreamEvent(event: StreamEvent): void {
    switch (event.type) {
      case "text_delta":
        if (event.text) {
          this.output.write(event.text);
        }
        break;
      case "tool_call_start":
        this.output.write(
          `\n[Calling tool: ${event.toolName} (${event.toolCallId})]\n`,
        );
        break;
      case "tool_call_end":
        this.output.write(
          `\n[Tool finished: ${event.toolName} (${event.toolCallId})]\n`,
        );
        break;
      case "thinking":
        this.output.write("\n[Thinking...]\n");
        break;
      case "iteration_start":
        this.output.write(`\n[Iteration ${event.iteration}]\n`);
        break;
      case "iteration_end":
        this.output.write(`\n[Iteration ${event.iteration} complete]\n`);
        break;
      case "error":
        this.output.write(
          `\n[Error] ${
            event.error instanceof Error
              ? event.error.message
              : String(event.error)
          }\n`,
        );
        break;
      case "done":
        this.output.write("\n[Done]\n");
        break;
    }
  }

  private printResult(result: AgentRunResult): void {
    this.output.write("\n[COMPLETED]\n");
    if (result.output) {
      this.output.write(`${result.output}\n`);
    } else {
      this.output.write("(no output)\n");
    }
    this.output.write(
      `\nIterations: ${result.iterations}  ` +
        `Prompt tokens: ${result.usage.promptTokens}  ` +
        `Completion tokens: ${result.usage.completionTokens}\n`,
    );
  }

  // ── Built-in commands ─────────────────────────────────────────────────────

  private registerBuiltinCommands(): void {
    this.registerCommand("help", this.cmdHelp.bind(this), "Show this help message.");
    this.registerCommand(
      "clear",
      this.cmdClear.bind(this),
      "Clear the terminal screen.",
    );
    this.registerCommand(
      "status",
      this.cmdStatus.bind(this),
      "Show agent and session status.",
    );
    this.registerCommand("exit", this.cmdExit.bind(this), "Exit the CLI.");
    this.registerCommand(
      "sessions",
      this.cmdSessions.bind(this),
      "List known sessions (if enabled).",
    );
    this.registerCommand(
      "session",
      this.cmdSession.bind(this),
      "Manage current session: /session [new|<id>].",
    );
    this.registerCommand(
      "skills",
      this.cmdSkills.bind(this),
      "List registered skills on this agent.",
    );
  }

  private cmdHelp(): void {
    this.output.write("\nAvailable commands:\n");
    const names = Array.from(this.commands.keys()).sort();
    for (const name of names) {
      const cmd = this.commands.get(name);
      if (!cmd) continue;
      const desc = cmd.description ? ` — ${cmd.description}` : "";
      this.output.write(`  ${name}${desc}\n`);
    }
    this.output.write("\nType a message to send it to the agent.\n");
  }

  private cmdClear(): void {
    // Best-effort clear using ANSI escape codes.
    this.output.write("\x1B[2J\x1B[0f");
  }

  private cmdStatus(): void {
    this.output.write(
      `\nAgent: ${this.agent.agentName} (${this.agent.agentId})\n`,
    );
    if (this.currentSessionId) {
      this.output.write(`Current session: ${this.currentSessionId}\n`);
    } else {
      this.output.write("Current session: (none)\n");
    }
  }

  private async cmdSessions(): Promise<void> {
    if (!this.sessionManager) {
      this.output.write("Session management is not enabled.\n");
      return;
    }
    const sessions = await this.sessionManager.listSessions(
      this.agent.agentId,
      50,
    );
    if (!sessions.length) {
      this.output.write("No sessions found.\n");
      return;
    }
    this.output.write("\nSessions:\n");
    for (const s of sessions) {
      const marker = s.id === this.currentSessionId ? "*" : " ";
      this.output.write(
        `${marker} ${s.id}  updatedAt=${s.updatedAt.toISOString()}  metadata=${JSON.stringify(
          s.metadata,
        )}\n`,
      );
    }
  }

  private async cmdSession(args: string): Promise<void> {
    if (!this.sessionManager) {
      this.output.write("Session management is not enabled.\n");
      return;
    }
    const arg = args.trim();
    if (!arg) {
      if (this.currentSessionId) {
        this.output.write(`Current session: ${this.currentSessionId}\n`);
      } else {
        this.output.write(
          "No current session. Use `/session new` to create one.\n",
        );
      }
      return;
    }
    if (arg === "new") {
      const session = await this.sessionManager.create(this.agent.agentId);
      this.currentSessionId = session.id;
      this.output.write(`Created new session: ${session.id}\n`);
      return;
    }

    // Treat arg as session id.
    try {
      const session = await this.sessionManager.get(arg);
      this.currentSessionId = session.id;
      this.output.write(`Switched to session: ${session.id}\n`);
    } catch {
      this.output.write(`No such session: ${arg}\n`);
    }
  }

  private cmdSkills(): void {
    const registry = (this.agent as any).skillRegistry as
      | { list: () => Array<{ name: string; description?: string }> }
      | undefined;
    if (!registry) {
      this.output.write("No skills registry configured on this agent.\n");
      return;
    }
    const skills = registry.list();
    if (!skills.length) {
      this.output.write("No skills registered.\n");
      return;
    }
    this.output.write("\nSkills:\n");
    for (const skill of skills) {
      const desc = skill.description ? ` — ${skill.description}` : "";
      this.output.write(`  ${skill.name}${desc}\n`);
    }
  }

  private cmdExit(): void {
    this.output.write("Exiting CLI.\n");
    this.shouldExit = true;
  }
}
