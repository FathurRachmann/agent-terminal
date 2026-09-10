import { ChatOpenAI } from "@langchain/openai";

export function createRouterModel() {
  const apiKey = process.env.ROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ROUTER_API_KEY is not set. Copy .env.example to .env and configure 9router credentials.",
    );
  }

  return new ChatOpenAI({
    model: process.env.AGENT_MODEL ?? "gpt-4o",
    apiKey,
    configuration: {
      baseURL: process.env.ROUTER_BASE_URL ?? "https://api.9router.com/v1",
    },
    temperature: 0,
    // Some 9router upstreams emit incomplete streaming roles; prefer buffered
    // completions for agent tool-calling stability.
    streaming: false,
  });
}
