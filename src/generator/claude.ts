import Anthropic from "@anthropic-ai/sdk";
import { makeJsonClient } from "./jsonLoop.js";
import type { LLMClient } from "./factory.js";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
}

export function createClaudeClient(opts: AnthropicOptions): LLMClient {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return makeJsonClient(async (system, user) => {
    const resp = await client.messages.create({
      model: opts.model,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
    });
    return resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  });
}
