import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ContractArtifact } from "../generator/artifacts.js";
import type { DescriptorConfig } from "../config.js";
import type { DescriptorKind } from "./paths.js";

interface LlmFingerprintInput {
  artifact: ContractArtifact;
  cfg: DescriptorConfig;
  kind: DescriptorKind;
}

interface OutFingerprintInput extends LlmFingerprintInput {
  address: string | undefined;
  chainId: number;
}

export function computeLlmFingerprint(input: LlmFingerprintInput): string {
  const { artifact, cfg, kind } = input;
  return hash({
    abi: artifact.abi,
    devdoc: artifact.devdoc ?? null,
    userdoc: artifact.userdoc ?? null,
    source: artifact.source ?? null,
    kind,
    owner: cfg.owner ?? null,
    url: cfg.url ?? null,
    provider: cfg.provider,
    model: cfg.model,
  });
}

export function computeOutFingerprint(input: OutFingerprintInput): string {
  return hash({
    llm: computeLlmFingerprint(input),
    address: input.address ?? null,
    chainId: input.chainId,
  });
}

function hash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export interface FingerprintCache {
  llm: string;
  out: string;
  raw: unknown;
}

function cachePath(outDir: string, name: string, kind: DescriptorKind): string {
  return path.join(outDir, ".fingerprints", `${kind}-${name}.json`);
}

export function readCache(
  outDir: string,
  name: string,
  kind: DescriptorKind,
): FingerprintCache | undefined {
  try {
    const raw = readFileSync(cachePath(outDir, name, kind), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { llm?: unknown }).llm === "string" &&
      typeof (parsed as { out?: unknown }).out === "string"
    ) {
      return parsed as FingerprintCache;
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

export function writeCache(
  outDir: string,
  name: string,
  kind: DescriptorKind,
  cache: FingerprintCache,
): void {
  const fp = cachePath(outDir, name, kind);
  mkdirSync(path.dirname(fp), { recursive: true });
  writeFileSync(fp, JSON.stringify(cache, null, 2) + "\n");
}
