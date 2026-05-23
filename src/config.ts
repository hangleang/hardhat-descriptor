export type LLMProvider = "anthropic" | "gemini" | "openai-compatible" | "none";

export interface DescriptorUserConfig {
  provider?: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  outDir?: string;
  owner?: string;
  url?: string;
  contracts?: string[];
}

export interface DescriptorConfig {
  provider: LLMProvider;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  model: string;
  outDir: string;
  owner: string | undefined;
  url: string | undefined;
  contracts: string[] | undefined;
}

export const DEFAULT_MODEL_BY_PROVIDER: Record<LLMProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  "openai-compatible": "llama-3.3-70b-versatile",
  none: "",
};
export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.anthropic;
export const DEFAULT_OUT_DIR = "descriptors";
export const DEFAULT_CHAIN_ID = 1;
export const SCHEMA_URL =
  "https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json";

export function resolveConfig(user: DescriptorUserConfig | undefined): DescriptorConfig {
  const u = user ?? {};
  const provider: LLMProvider = u.provider ?? "none";
  const apiKey = u.apiKey ?? process.env.LLM_PROVIDER_API_KEY;
  return {
    provider,
    apiKey,
    baseUrl: u.baseUrl,
    model: u.model ?? DEFAULT_MODEL_BY_PROVIDER[provider],
    outDir: u.outDir ?? DEFAULT_OUT_DIR,
    owner: u.owner,
    url: u.url,
    contracts: u.contracts,
  };
}
