import OpenAI from "openai";
import { makeJsonClient } from "./jsonLoop.js";
import type { LLMClient } from "./factory.js";

export interface OpenAICompatibleOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * Works for any OpenAI-API-compatible endpoint:
 *  - Groq            baseUrl: https://api.groq.com/openai/v1
 *  - OpenRouter      baseUrl: https://openrouter.ai/api/v1
 *  - Together        baseUrl: https://api.together.xyz/v1
 *  - Mistral         baseUrl: https://api.mistral.ai/v1
 *  - DeepSeek        baseUrl: https://api.deepseek.com/v1
 *  - Ollama (local)  baseUrl: http://localhost:11434/v1
 *  - OpenAI itself   omit baseUrl
 */
export function createOpenAICompatibleClient(opts: OpenAICompatibleOptions): LLMClient {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl,
  });
  return makeJsonClient(async (system, user) => {
    const resp = await client.chat.completions.create({
      model: opts.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8000,
    });
    return resp.choices[0]?.message?.content ?? "";
  });
}
