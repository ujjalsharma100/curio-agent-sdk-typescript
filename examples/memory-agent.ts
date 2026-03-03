import { Agent, LLMClient, MemoryManager, ConversationMemory } from "curio-agent-sdk";

async function main(): Promise<void> {
  const memoryManager = new MemoryManager({
    memory: new ConversationMemory(),
    namespace: "demo-user-1",
  });

  const agent = Agent.builder()
    .agentName("memory-agent")
    .model("openai:gpt-4o-mini")
    .llmClient(new LLMClient())
    .systemPrompt("Remember user preferences and use them in later replies.")
    .memoryManager(memoryManager)
    .build();

  await agent.run("My favorite editor theme is dark mode.");
  const result = await agent.run("What editor theme do I prefer?");
  console.log(result.output);
}

void main();
