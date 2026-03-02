import { z } from "zod";
import { createTool, type Tool } from "../core/tools/tool.js";

/**
 * Options for the http_request tool.
 */
export interface HttpRequestToolOptions {
  /**
   * Default timeout in milliseconds for the HTTP request.
   * Defaults to 15s.
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

const HttpRequestArgsSchema = z.object({
  url: z
    .string()
    .url()
    .describe("HTTP or HTTPS URL to request."),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    .optional()
    .describe("HTTP method to use. Defaults to GET when omitted."),
  headers: z
    .record(z.string())
    .optional()
    .describe("Optional HTTP headers to include in the request."),
  body: z
    .string()
    .optional()
    .describe("Request body for non-GET/HEAD methods. Sent as-is."),
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

type HttpRequestArgs = z.infer<typeof HttpRequestArgsSchema>;

export function createHttpRequestTool(options: HttpRequestToolOptions = {}): Tool {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxBytes = options.defaultMaxBytes ?? DEFAULT_MAX_BYTES;

  return createTool<HttpRequestArgs>({
    name: "http_request",
    description:
      "Perform a generic HTTP request and return status, headers, and body (text/JSON) as JSON.",
    parameters: HttpRequestArgsSchema,
    config: {
      // Requests may be state-changing; do not mark as idempotent.
      timeout: defaultTimeoutMs + 2_000,
      idempotent: false,
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
          body: method === "GET" || method === "HEAD" ? undefined : args.body,
          signal: controller.signal,
        });

        const contentType = response.headers.get("content-type") ?? "";
        const buffer = await response.arrayBuffer();
        const totalBytes = buffer.byteLength;
        const limited = typeof maxBytes === "number" && maxBytes > 0 && totalBytes > maxBytes;
        const sliced = limited ? buffer.slice(0, maxBytes) : buffer;
        const textBody = new TextDecoder().decode(sliced);

        let parsedJson: unknown = null;
        if (contentType.includes("application/json")) {
          try {
            parsedJson = JSON.parse(textBody);
          } catch {
            parsedJson = null;
          }
        }

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        return JSON.stringify({
          url: args.url,
          method,
          status: response.status,
          statusText: response.statusText,
          contentType,
          headers,
          bodyText: textBody,
          json: parsedJson,
          truncated: limited,
          bytes: totalBytes,
        });
      } catch (error) {
        const err = error as Error;
        return JSON.stringify({
          url: args.url,
          method: args.method,
          error: err.message,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export const httpRequestTool: Tool = createHttpRequestTool();

