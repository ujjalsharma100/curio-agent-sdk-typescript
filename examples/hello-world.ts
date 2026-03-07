import { Agent, LLMClient } from "curio-agent-sdk";

async function main(): Promise<void> {
  const agent = Agent.builder()
    .agentName("hello-agent")
    .model("openai:gpt-4.1-mini")
    .llmClient(new LLMClient())
    .systemPrompt("You are a concise assistant.")
    .build();

  const result = await agent.run("Give me one sentence about main character of Attack on Titan.");
  console.log(result.output);
}

void main();
