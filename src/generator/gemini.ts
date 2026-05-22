import { GoogleGenerativeAI } from "@google/generative-ai";
import { makeJsonClient } from "./jsonLoop.js";
import type { LLMClient } from "./factory.js";

export interface GeminiOptions {
  apiKey: string;
  model: string;
}

export function createGeminiClient(opts: GeminiOptions): LLMClient {
  const genAI = new GoogleGenerativeAI(opts.apiKey);
  const model = genAI.getGenerativeModel({
    model: opts.model,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });
  return makeJsonClient(async (system, user) => {
    const resp = await model.generateContent({
      systemInstruction: { role: "system", parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
    });
    return resp.response.text();
  });
}
