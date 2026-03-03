import { Agent, LLMClient, createTool } from "curio-agent-sdk";
import { z } from "zod";

const calculator = createTool({
  name: "calculator",
  description: "Evaluate simple arithmetic expressions.",
  parameters: z.object({
    expression: z.string().describe("Expression like '12 * 7'"),
  }),
  execute: async ({ expression }) => {
    // Replace with a safe parser in production code.
    const value = Function(`"use strict"; return (${expression})`)();
    return String(value);
  },
});

async function main(): Promise<void> {
  const agent = Agent.builder()
    .agentName("tool-agent")
    .model("openai:gpt-4o-mini")
    .llmClient(new LLMClient())
    .systemPrompt("Use tools whenever math is required.")
    .tool(calculator)
    .maxIterations(8)
    .build();

  const result = await agent.run("What is 81 divided by 9?");
  console.log(result.output);
  console.log("Tool calls:", result.toolCalls.length);
}

void main();
