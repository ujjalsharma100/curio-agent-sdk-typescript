import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTool, type Tool } from "../core/tools/tool.js";

/**
 * Options for the file_read tool.
 */
export interface FileReadToolOptions {
  /**
   * Optional base directory. When provided, relative paths are resolved
   * against this directory. Absolute paths are left as-is.
   */
  baseDir?: string;
  /**
   * Default text encoding to use when reading files as text.
   * Defaults to "utf-8".
   */
  defaultEncoding?: BufferEncoding;
  /**
   * Default maximum number of bytes to read from the file.
   * 0 or undefined means no explicit limit. Defaults to 512 KiB.
   */
  defaultMaxBytes?: number;
}

const DEFAULT_MAX_BYTES = 512 * 1024;

const FileReadArgsSchema = z.object({
  path: z
    .string()
    .describe("Path to the file to read. May be absolute or relative to the working directory."),
  encoding: z
    .enum(["utf-8", "utf8", "base64"])
    .optional()
    .describe("Encoding to use when returning content (utf-8 or base64). Defaults to utf-8."),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(10_000_000)
    .optional()
    .describe("Maximum number of bytes to read from the file."),
});

type FileReadArgs = z.infer<typeof FileReadArgsSchema>;

function resolvePath(baseDir: string | undefined, filePath: string): string {
  if (!baseDir) return path.resolve(filePath);
  if (path.isAbsolute(filePath)) return path.resolve(filePath);
  return path.resolve(baseDir, filePath);
}

export function createFileReadTool(options: FileReadToolOptions = {}): Tool {
  const defaultEncoding = options.defaultEncoding ?? "utf-8";
  const defaultMaxBytes = options.defaultMaxBytes ?? DEFAULT_MAX_BYTES;
  const baseDir = options.baseDir;

  return createTool<FileReadArgs>({
    name: "file_read",
    description:
      "Read the contents of a file from disk. Returns JSON with path, encoding, content, and truncation metadata.",
    parameters: FileReadArgsSchema,
    config: {
      idempotent: true,
    },
    async execute(args) {
      const encoding = (args.encoding ?? defaultEncoding) as BufferEncoding;
      const maxBytes = args.maxBytes ?? defaultMaxBytes;
      const resolvedPath = resolvePath(baseDir, args.path);

      let stat;
      try {
        stat = await fs.stat(resolvedPath);
      } catch (error) {
        return JSON.stringify({
          path: args.path,
          resolvedPath,
          error: (error as Error).message,
        });
      }

      const totalBytes = stat.size;
      const limited = typeof maxBytes === "number" && maxBytes > 0 && totalBytes > maxBytes;

      try {
        const buffer = await fs.readFile(resolvedPath);
        const slice = limited ? buffer.subarray(0, maxBytes) : buffer;

        let content: string;
        if (encoding === "base64") {
          content = slice.toString("base64");
        } else {
          content = slice.toString("utf8");
        }

        const result = {
          path: args.path,
          resolvedPath,
          encoding,
          content,
          truncated: limited,
          bytes: totalBytes,
        };

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          path: args.path,
          resolvedPath,
          error: (error as Error).message,
        });
      }
    },
  });
}

export const fileReadTool: Tool = createFileReadTool();

