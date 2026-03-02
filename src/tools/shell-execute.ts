import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTool, type Tool } from "../core/tools/tool.js";

const execFileAsync = promisify(execFile);

/**
 * Options for the shell_execute tool.
 *
 * Note: this tool deliberately does not use a shell (`shell: true`) and
 * instead executes a single binary with arguments via execFile to avoid
 * shell injection risks.
 */
export interface ShellExecuteToolOptions {
  /**
   * Working directory for the subprocess. Defaults to process.cwd().
   */
  cwd?: string;
  /**
   * Default timeout in milliseconds for the subprocess. Defaults to 20s.
   */
  defaultTimeoutMs?: number;
  /**
   * Default maximum number of bytes to buffer from stdout/stderr.
   * Defaults to 10 MiB.
   */
  defaultMaxBufferBytes?: number;
  /**
   * Additional environment variables to expose to the subprocess.
   */
  extraEnv?: Record<string, string>;
  /**
   * Environment variable names from the parent process that are safe to
   * forward into the subprocess. Defaults to a conservative set.
   */
  allowedEnvVars?: string[];
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const DEFAULT_ALLOWED_ENV_VARS = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP"];

const ShellExecuteArgsSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      "Executable to run (binary name or absolute path). Shell features like pipes and redirection are not supported.",
    ),
  args: z
    .array(z.string())
    .optional()
    .describe("Arguments to pass to the command."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe("Per-invocation timeout in milliseconds."),
  maxBufferBytes: z
    .number()
    .int()
    .positive()
    .max(50_000_000)
    .optional()
    .describe("Per-invocation max stdout/stderr buffer size in bytes."),
});

type ShellExecuteArgs = z.infer<typeof ShellExecuteArgsSchema>;

function buildEnv(options: ShellExecuteToolOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = options.allowedEnvVars ?? DEFAULT_ALLOWED_ENV_VARS;
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (options.extraEnv) {
    for (const [key, value] of Object.entries(options.extraEnv)) {
      env[key] = value;
    }
  }
  return env;
}

export function createShellExecuteTool(options: ShellExecuteToolOptions = {}): Tool {
  const baseCwd = options.cwd ?? process.cwd();
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxBufferBytes = options.defaultMaxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  return createTool<ShellExecuteArgs>({
    name: "shell_execute",
    description:
      "Execute a single binary with arguments (no shell interpolation) and return stdout, stderr, and exit code as JSON.",
    parameters: ShellExecuteArgsSchema,
    config: {
      timeout: defaultTimeoutMs + 2_000,
    },
    async execute(args) {
      const timeoutMs = args.timeoutMs ?? defaultTimeoutMs;
      const maxBuffer = args.maxBufferBytes ?? defaultMaxBufferBytes;
      const env = buildEnv(options);

      try {
        const { stdout, stderr } = await execFileAsync(args.command, args.args ?? [], {
          cwd: baseCwd,
          timeout: timeoutMs,
          maxBuffer,
          env,
        });

        return JSON.stringify({
          command: args.command,
          args: args.args ?? [],
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: 0,
          timedOut: false,
        });
      } catch (error) {
        const err = error as NodeJS.ErrnoException & {
          code?: string | number;
          stdout?: string;
          stderr?: string;
          killed?: boolean;
          signal?: NodeJS.Signals;
        };

        const exitCode = typeof err.code === "number" ? err.code : null;
        const timedOut = err.killed === true;

        return JSON.stringify({
          command: args.command,
          args: args.args ?? [],
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? err.message ?? "",
          exitCode,
          signal: err.signal ?? null,
          timedOut,
        });
      }
    },
  });
}

export const shellExecuteTool: Tool = createShellExecuteTool();

