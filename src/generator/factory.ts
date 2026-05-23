import type { DescriptorConfig } from "../config.js";
import type { ContractArtifact } from "./artifacts.js";
import type { DescriptorKind } from "../util/paths.js";
import { createClaudeClient } from "./claude.js";
import { createGeminiClient } from "./gemini.js";
import { createOpenAICompatibleClient } from "./openaiCompatible.js";
import { createBaselineClient } from "./baseline.js";

export interface LLMClient {
  generate(artifact: ContractArtifact, kind?: DescriptorKind): Promise<unknown>;
}

export function createLLMClient(cfg: DescriptorConfig): LLMClient {
  if (cfg.provider === "none") {
    return createBaselineClient();
  }
  if (!cfg.apiKey) {
    throw new Error(
      `hardhat-descriptor: no API key for provider "${cfg.provider}". Set LLM_PROVIDER_API_KEY, or descriptor.apiKey in your Hardhat config.`,
    );
  }
  switch (cfg.provider) {
    case "anthropic":
      return createClaudeClient({ apiKey: cfg.apiKey, model: cfg.model });
    case "gemini":
      return createGeminiClient({ apiKey: cfg.apiKey, model: cfg.model });
    case "openai-compatible":
      return createOpenAICompatibleClient({
        apiKey: cfg.apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
      });
  }
}
