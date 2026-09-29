import { ChatOpenAI } from "@langchain/openai";

export function createRouterModel() {
  const apiKey = process.env.ROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ROUTER_API_KEY is not set. Copy .env.example to .env and configure 9router credentials.",
    );
  }

  // Streaming on by default so "Thinking" shows tokens ASAP.
  // Opt out: AGENT_STREAMING=0 (some 9router upstreams have incomplete stream roles).
  const streamingRaw = process.env.AGENT_STREAMING?.trim().toLowerCase();
  const streaming =
    streamingRaw === undefined || streamingRaw === ""
      ? true
      : !["0", "false", "no", "off"].includes(streamingRaw);

  return new ChatOpenAI({
    model: process.env.AGENT_MODEL ?? "gpt-4o",
    apiKey,
    configuration: {
      baseURL: process.env.ROUTER_BASE_URL ?? "https://api.9router.com/v1",
    },
    temperature: 0,
    streaming,
  });
}
