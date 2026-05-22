import type { DescriptorConfig } from "../config.js";
import { SCHEMA_URL } from "../config.js";
import type { ContractArtifact } from "./artifacts.js";
import {
  parameterizedSignature,
  listExternalFunctions,
} from "../util/selectors.js";
import type { DescriptorKind } from "../util/paths.js";

export interface PostprocessInput {
  raw: unknown;
  artifact: ContractArtifact;
  config: DescriptorConfig;
  address: string | undefined;
  chainId: number;
  kind?: DescriptorKind;
}

export interface PostprocessResult {
  /** null = nothing to write (EIP-712 with no typed data found). */
  descriptor: Record<string, unknown> | null;
  warnings: string[];
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function applyMetadata(
  out: Record<string, unknown>,
  cfg: DescriptorConfig,
): void {
  const metadata = isObject(out.metadata) ? { ...out.metadata } : {};
  if (cfg.owner) metadata.owner = cfg.owner;
  if (cfg.url) {
    const info = isObject(metadata.info) ? { ...metadata.info } : {};
    info.url = cfg.url;
    metadata.info = info;
  }
  out.metadata = metadata;
}

interface Envelope {
  out: Record<string, unknown>;
  context: Record<string, unknown>;
  formats: Record<string, unknown>;
}

function openEnvelope(input: PostprocessInput): Envelope {
  const out: Record<string, unknown> = isObject(input.raw) ? { ...input.raw } : {};
  out["$schema"] = SCHEMA_URL;
  const context = isObject(out.context) ? { ...out.context } : {};
  if (typeof context.$id !== "string") context.$id = input.artifact.name;
  const display = isObject(out.display) ? { ...out.display } : {};
  const formats = isObject(display.formats) ? { ...display.formats } : {};
  display.formats = formats;
  out.display = display;
  return { out, context, formats };
}

function stripRequired(entry: unknown): void {
  if (isObject(entry) && "required" in entry) {
    delete (entry as Record<string, unknown>).required;
  }
}

// Ledger's erc7730 linter rejects `params: {}` ("Parameter type cannot be deduced from attributes").
// Walk the format entry's fields and drop empty params objects entirely.
function stripEmptyParams(entry: unknown): void {
  if (!isObject(entry) || !Array.isArray(entry.fields)) return;
  for (const f of entry.fields) {
    if (isObject(f) && isObject(f.params) && Object.keys(f.params).length === 0) {
      delete (f as Record<string, unknown>).params;
    }
  }
}

export function postprocess(input: PostprocessInput): PostprocessResult {
  const kind = input.kind ?? "calldata";
  return kind === "eip712"
    ? postprocessEip712(input)
    : postprocessCalldata(input);
}

function postprocessCalldata(input: PostprocessInput): PostprocessResult {
  const warnings: string[] = [];
  const { out, context, formats } = openEnvelope(input);

  const contract = isObject(context.contract) ? { ...context.contract } : {};
  contract.abi = input.artifact.abi;
  if (input.address) {
    contract.deployments = [{ chainId: input.chainId, address: input.address }];
  } else if (!Array.isArray(contract.deployments) || contract.deployments.length === 0) {
    contract.deployments = [{ chainId: input.chainId, address: ZERO_ADDRESS }];
    warnings.push(
      "No --address provided; wrote a zero-address placeholder in context.contract.deployments[0].",
    );
  }
  delete (context as Record<string, unknown>).eip712;
  context.contract = contract;
  out.context = context;

  applyMetadata(out, input.config);

  const externals = listExternalFunctions(input.artifact.abi);
  const payableSignatures = new Set(
    externals
      .filter((f) => f.stateMutability === "payable")
      .map(parameterizedSignature),
  );
  const validSignatures = new Set(externals.map(parameterizedSignature));
  for (const key of Object.keys(formats)) {
    if (!validSignatures.has(key)) {
      warnings.push(`Dropped display.formats["${key}"] — no matching function in ABI.`);
      delete formats[key];
      continue;
    }
    const entry = formats[key];
    stripRequired(entry);
    stripEmptyParams(entry);
    if (payableSignatures.has(key) && isObject(entry)) {
      const fields = Array.isArray(entry.fields) ? [...entry.fields] : [];
      const hasValueField = fields.some(
        (f) => isObject(f) && typeof f.path === "string" && f.path === "$.value",
      );
      if (!hasValueField) {
        fields.push({
          path: "$.value",
          label: "Amount",
          format: "amount",
        });
        entry.fields = fields;
        warnings.push(`Injected $.value field into display.formats["${key}"] (payable function).`);
      }
    }
  }
  for (const sig of validSignatures) {
    if (!(sig in formats)) {
      warnings.push(`No display.formats entry for "${sig}" — the LLM omitted it.`);
    }
  }

  return { descriptor: out, warnings };
}

// EIP-712 encodeType primary string, e.g.
//   "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
// optionally followed by referenced-struct encodings concatenated without separators.
const ENCODE_TYPE_REGEX = /^[A-Z][A-Za-z0-9_]*\([A-Za-z0-9_,\[\] ]*\)(?:[A-Z][A-Za-z0-9_]*\([A-Za-z0-9_,\[\] ]*\))*$/;

function postprocessEip712(input: PostprocessInput): PostprocessResult {
  const warnings: string[] = [];
  const { out, context, formats } = openEnvelope(input);

  delete (context as Record<string, unknown>).contract;
  const eip712 = isObject(context.eip712) ? { ...context.eip712 } : {};
  const domain = isObject(eip712.domain) ? { ...eip712.domain } : {};
  if (typeof domain.name !== "string" || domain.name.length === 0) {
    domain.name = input.artifact.name;
    warnings.push(
      `context.eip712.domain.name was missing; defaulted to "${input.artifact.name}".`,
    );
  }
  if (typeof domain.version !== "string" || domain.version.length === 0) {
    domain.version = "1";
  }
  domain.chainId = input.chainId;
  const addr = input.address ?? ZERO_ADDRESS;
  domain.verifyingContract = addr;
  eip712.deployments = [{ chainId: input.chainId, address: addr }];
  if (!input.address) {
    warnings.push(
      "No --address provided; wrote a zero-address placeholder in context.eip712.deployments[0] and domain.verifyingContract.",
    );
  }
  eip712.domain = domain;
  context.eip712 = eip712;
  out.context = context;

  applyMetadata(out, input.config);

  for (const key of Object.keys(formats)) {
    if (!ENCODE_TYPE_REGEX.test(key)) {
      warnings.push(
        `Dropped display.formats["${key}"] — not a valid EIP-712 encodeType string.`,
      );
      delete formats[key];
      continue;
    }
    stripRequired(formats[key]);
    stripEmptyParams(formats[key]);
  }

  if (Object.keys(formats).length === 0) {
    warnings.push(
      `${input.artifact.name}: no EIP-712 typed-data structs found in source — skipping eip712 descriptor.`,
    );
    return { descriptor: null, warnings };
  }

  return { descriptor: out, warnings };
}
