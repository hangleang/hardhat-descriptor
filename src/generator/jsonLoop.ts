import { SYSTEM_PROMPTS, buildUserMessage } from "./prompt.js";
import type { ContractArtifact } from "./artifacts.js";
import type { LLMClient } from "./factory.js";
import type { DescriptorKind } from "../util/paths.js";

export function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

export type CallOnce = (system: string, user: string) => Promise<string>;

export function makeJsonClient(callOnce: CallOnce): LLMClient {
  return {
    async generate(artifact: ContractArtifact, kind: DescriptorKind = "calldata") {
      const system = SYSTEM_PROMPTS[kind];
      const user = buildUserMessage(artifact, kind);
      const first = await callOnce(system, user);
      try {
        return JSON.parse(stripJsonFences(first));
      } catch {
        const retry = await callOnce(
          system,
          user +
            "\n\nYour previous response was not valid JSON. Reply with the ERC-7730 descriptor as a single JSON document, no fences, no prose.",
        );
        return JSON.parse(stripJsonFences(retry));
      }
    },
  };
}
