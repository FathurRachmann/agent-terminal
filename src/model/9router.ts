import { ChatOpenAI } from "@langchain/openai";

export function createRouterModel() {
  const apiKey = process.env.ROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ROUTER_API_KEY is not set. Start the desktop app so Model Hub can inject it, or set ROUTER_API_KEY in .env.",
    );
  }

  // Streaming on by default so "Thinking" shows tokens ASAP.
  // Opt out: AGENT_STREAMING=0 (some upstreams have incomplete stream roles).
  const streamingRaw = process.env.AGENT_STREAMING?.trim().toLowerCase();
  const streaming =
    streamingRaw === undefined || streamingRaw === ""
      ? true
      : !["0", "false", "no", "off"].includes(streamingRaw);

  const baseURL =
    process.env.ROUTER_BASE_URL?.trim() || "http://127.0.0.1:27128/v1";

  return new ChatOpenAI({
    model: process.env.AGENT_MODEL ?? "gpt-4o",
    apiKey,
    configuration: {
      baseURL,
    },
    temperature: 0,
    streaming,
  });
}
