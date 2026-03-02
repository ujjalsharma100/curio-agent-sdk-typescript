import { z } from "zod";
import { createTool, type Tool } from "../core/tools/tool.js";

/**
 * Options for the web_fetch tool.
 */
export interface WebFetchToolOptions {
  /**
   * Default timeout in milliseconds for the HTTP request (not including
   * tool-executor retry/timeout). Defaults to 15s.
   */
  defaultTimeoutMs?: number;
  /**
   * Default maximum number of bytes to read from the response body.
   * 0 or undefined means no explicit limit. Defaults to 512 KiB.
   */
  defaultMaxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 512 * 1024;

const WebFetchArgsSchema = z.object({
  url: z
    .string()
    .url()
    .describe("Absolute HTTP or HTTPS URL to fetch."),
  method: z
    .enum(["GET", "HEAD"])
    .optional()
    .describe("HTTP method to use (GET or HEAD). Defaults to GET when omitted."),
  headers: z
    .record(z.string())
    .optional()
    .describe("Optional HTTP headers to include in the request."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe("Request timeout in milliseconds (default 15000)."),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(10_000_000)
    .optional()
    .describe("Maximum number of bytes to read from the response body."),
});

type WebFetchArgs = z.infer<typeof WebFetchArgsSchema>;

function htmlToMarkdown(html: string): string {
  // Remove script and style blocks
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");

  // Normalize line breaks
  text = text.replace(/\r\n/g, "\n");

  // Headings
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
  text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n\n");
  text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n\n");

  // Paragraphs and line breaks
  text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Lists
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");

  // Bold / italics
  text = text.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gi, "*$2*");

  // Links: [text](href)
  text = text.replace(
    /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi,
    (_match, href: string, label: string) => `[${label}](${href})`,
  );

  // Strip remaining tags
  text = text.replace(/<\/?[^>]+>/g, "");

  // Collapse excessive blank lines
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function createWebFetchTool(options: WebFetchToolOptions = {}): Tool {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxBytes = options.defaultMaxBytes ?? DEFAULT_MAX_BYTES;

  return createTool<WebFetchArgs>({
    name: "web_fetch",
    description:
      "Fetch a URL over HTTP/HTTPS and return the response as markdown text, with basic HTML-to-markdown conversion.",
    parameters: WebFetchArgsSchema,
    config: {
      // Give the executor a slightly higher timeout than the internal fetch.
      timeout: defaultTimeoutMs + 2_000,
      idempotent: true,
    },
    async execute(args) {
      const method = args.method ?? "GET";
      const timeoutMs = args.timeoutMs ?? defaultTimeoutMs;
      const maxBytes = args.maxBytes ?? defaultMaxBytes;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(args.url, {
          method,
          headers: args.headers,
          signal: controller.signal,
        });

        const contentType = response.headers.get("content-type") ?? "";
        const buffer = await response.arrayBuffer();
        const totalBytes = buffer.byteLength;
        const limited = typeof maxBytes === "number" && maxBytes > 0 && totalBytes > maxBytes;
        const sliced = limited ? buffer.slice(0, maxBytes) : buffer;
        const textBody = new TextDecoder().decode(sliced);

        const markdown = contentType.includes("text/html") ? htmlToMarkdown(textBody) : textBody;

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        const result = {
          url: args.url,
          method,
          status: response.status,
          statusText: response.statusText,
          contentType,
          headers,
          markdown,
          truncated: limited,
          bytes: totalBytes,
        };

        return JSON.stringify(result);
      } catch (error) {
        const err = error as Error;
        return JSON.stringify({
          url: args.url,
          error: err.message,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export const webFetchTool: Tool = createWebFetchTool();

