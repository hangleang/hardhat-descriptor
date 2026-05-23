import type { ContractArtifact } from "./artifacts.js";
import type { LLMClient } from "./factory.js";
import type { DescriptorKind } from "../util/paths.js";
import {
  listExternalFunctions,
  parameterizedSignature,
  type AbiFunction,
} from "../util/selectors.js";

const INTENT_MAX = 30;

interface BaselineField {
  path: string;
  label: string;
  format: string;
  params?: Record<string, unknown>;
}

function humanize(name: string): string {
  const withSpaces = name
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (withSpaces.length === 0) return name;
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function truncateIntent(s: string): string {
  return s.length <= INTENT_MAX ? s : s.slice(0, INTENT_MAX).trimEnd();
}

function formatForType(type: string): { format: string; params?: Record<string, unknown> } {
  if (type === "address") {
    return { format: "addressName", params: { types: ["eoa", "wallet", "contract"] } };
  }
  return { format: "raw" };
}

function fieldsFor(fn: AbiFunction): BaselineField[] {
  return fn.inputs.map((input, i) => {
    const paramName = input.name && input.name.length > 0 ? input.name : `arg${i}`;
    const { format, params } = formatForType(input.type);
    const field: BaselineField = {
      path: paramName,
      label: humanize(paramName),
      format,
    };
    if (params) field.params = params;
    return field;
  });
}

// Same shape as postprocess's ENCODE_TYPE_REGEX, used here to validate strings
// scanned out of Solidity source before treating them as EIP-712 typehashes.
const ENCODE_TYPE_REGEX = /^[A-Z][A-Za-z0-9_]*\([A-Za-z0-9_,\[\] ]*\)(?:[A-Z][A-Za-z0-9_]*\([A-Za-z0-9_,\[\] ]*\))*$/;
// `keccak256("…")` literals; allow whitespace/newlines around the call and string.
const TYPEHASH_LITERAL = /keccak256\s*\(\s*"([^"\\\n]+)"\s*\)/g;

function extractEip712EncodeTypes(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of source.matchAll(TYPEHASH_LITERAL)) {
    const s = m[1];
    if (!ENCODE_TYPE_REGEX.test(s)) continue;
    if (s.startsWith("EIP712Domain(")) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parsePrimaryFields(encodeType: string): { name: string; fields: { name: string; type: string }[] } {
  const openIdx = encodeType.indexOf("(");
  const closeIdx = encodeType.indexOf(")");
  const structName = encodeType.slice(0, openIdx);
  const body = encodeType.slice(openIdx + 1, closeIdx);
  if (body.length === 0) return { name: structName, fields: [] };
  const fields = body.split(",").map((part) => {
    const trimmed = part.trim();
    const sp = trimmed.lastIndexOf(" ");
    return { type: trimmed.slice(0, sp), name: trimmed.slice(sp + 1) };
  });
  return { name: structName, fields };
}

function eip712FormatsFromSource(source: string): Record<string, unknown> {
  const formats: Record<string, unknown> = {};
  for (const encodeType of extractEip712EncodeTypes(source)) {
    const { name, fields } = parsePrimaryFields(encodeType);
    formats[encodeType] = {
      intent: truncateIntent(humanize(name)),
      fields: fields.map(({ name: fname, type }) => {
        const { format, params } = formatForType(type);
        const field: BaselineField = { path: fname, label: humanize(fname), format };
        if (params) field.params = params;
        return field;
      }),
    };
  }
  return formats;
}

export function createBaselineClient(): LLMClient {
  return {
    async generate(artifact: ContractArtifact, kind: DescriptorKind = "calldata") {
      if (kind === "eip712") {
        const formats = artifact.source ? eip712FormatsFromSource(artifact.source) : {};
        return { display: { formats } };
      }
      const formats: Record<string, unknown> = {};
      for (const fn of listExternalFunctions(artifact.abi)) {
        formats[parameterizedSignature(fn)] = {
          intent: truncateIntent(humanize(fn.name)),
          fields: fieldsFor(fn),
        };
      }
      return { display: { formats } };
    },
  };
}
