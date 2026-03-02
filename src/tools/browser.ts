import { z } from "zod";
import { createTool, type Tool } from "../core/tools/tool.js";

/**
 * Options for the browser_navigate tool.
 */
export interface BrowserToolOptions {
  /**
   * Browser engine to use. Defaults to "chromium".
   */
  browser?: "chromium" | "firefox" | "webkit";
  /**
   * Default timeout in milliseconds for page navigation. Defaults to 30s.
   */
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const BrowserArgsSchema = z.object({
  url: z
    .string()
    .url()
    .describe("URL to open in the headless browser."),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .optional()
    .describe("Event to wait for before capturing HTML. Defaults to 'load'."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe("Per-invocation timeout in milliseconds."),
});

type BrowserArgs = z.infer<typeof BrowserArgsSchema>;

async function loadPlaywright() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
    const mod: any = await import("playwright");
    return mod;
  } catch {
    return null;
  }
}

export function createBrowserTool(options: BrowserToolOptions = {}): Tool {
  const browserKind = options.browser ?? "chromium";
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return createTool<BrowserArgs>({
    name: "browser_navigate",
    description:
      "Open a page in a headless browser (Playwright) and return the final HTML and title. Requires the optional 'playwright' dependency.",
    parameters: BrowserArgsSchema,
    config: {
      timeout: defaultTimeoutMs + 15_000,
    },
    async execute(args) {
      const timeoutMs = args.timeoutMs ?? defaultTimeoutMs;
      const waitUntil = args.waitUntil ?? "load";
      try {
        const playwright = await loadPlaywright();
        if (!playwright) {
          return JSON.stringify({
            url: args.url,
            error:
              "The 'playwright' package is not installed. Install it as an optional dependency to enable browser automation.",
          });
        }

        const browserType = playwright[browserKind];
        if (!browserType || typeof browserType.launch !== "function") {
          return JSON.stringify({
            url: args.url,
            error: `Playwright browser type '${browserKind}' is not available.`,
          });
        }

        const browser = await browserType.launch();
        try {
          const context = await browser.newContext();
          const page = await context.newPage();
          await page.goto(args.url, { waitUntil, timeout: timeoutMs });
          const title = await page.title();
          const html = await page.content();

          return JSON.stringify({
            url: args.url,
            title,
            html,
          });
        } finally {
          await browser.close();
        }
      } catch (error) {
        return JSON.stringify({
          url: args.url,
          error: (error as Error).message,
        });
      }
    },
  });
}

export const browserTool: Tool = createBrowserTool();

