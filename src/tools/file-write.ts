import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTool, type Tool } from "../core/tools/tool.js";

/**
 * Options for the file_write tool.
 */
export interface FileWriteToolOptions {
  /**
   * Optional base directory. When provided, relative paths are resolved
   * against this directory. Absolute paths are left as-is.
   */
  baseDir?: string;
  /**
   * Default text encoding to use when writing files as text.
   * Defaults to "utf-8".
   */
  defaultEncoding?: BufferEncoding;
}

const FileWriteArgsSchema = z.object({
  path: z
    .string()
    .describe("Path of the file to write. May be absolute or relative to the working directory."),
  content: z
    .string()
    .describe("Text content to write into the file."),
  encoding: z
    .enum(["utf-8", "utf8"])
    .optional()
    .describe("Encoding to use when writing the file (defaults to utf-8)."),
  overwrite: z
    .boolean()
    .optional()
    .describe("Whether to overwrite an existing file. Defaults to false."),
});

type FileWriteArgs = z.infer<typeof FileWriteArgsSchema>;

function resolvePath(baseDir: string | undefined, filePath: string): string {
  if (!baseDir) return path.resolve(filePath);
  if (path.isAbsolute(filePath)) return path.resolve(filePath);
  return path.resolve(baseDir, filePath);
}

export function createFileWriteTool(options: FileWriteToolOptions = {}): Tool {
  const baseDir = options.baseDir;
  const defaultEncoding = options.defaultEncoding ?? "utf-8";

  return createTool<FileWriteArgs>({
    name: "file_write",
    description:
      "Write text content to a file on disk. By default this fails if the target file already exists.",
    parameters: FileWriteArgsSchema,
    config: {
      idempotent: false,
    },
    async execute(args) {
      const encoding = (args.encoding ?? defaultEncoding) as BufferEncoding;
      const overwrite = args.overwrite ?? false;
      const resolvedPath = resolvePath(baseDir, args.path);

      try {
        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });

        const exists = await fs
          .access(resolvedPath)
          .then(() => true)
          .catch(() => false);

        if (exists && !overwrite) {
          return JSON.stringify({
            path: args.path,
            resolvedPath,
            error: "File already exists; set overwrite=true to replace it.",
          });
        }

        const buffer = Buffer.from(args.content, encoding);
        await fs.writeFile(resolvedPath, buffer);

        return JSON.stringify({
          path: args.path,
          resolvedPath,
          bytesWritten: buffer.byteLength,
          overwritten: exists,
        });
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

export const fileWriteTool: Tool = createFileWriteTool();

