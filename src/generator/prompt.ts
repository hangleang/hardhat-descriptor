import type { ContractArtifact } from "./artifacts.js";
import { listExternalFunctions, parameterizedSignature } from "../util/selectors.js";
import type { DescriptorKind } from "../util/paths.js";

const SHARED_PREAMBLE = `You generate ERC-7730 v2 "clear-signing" descriptors for Ethereum smart contracts.

ERC-7730 descriptors are JSON files that wallets (Ledger, Trezor, WalletConnect, etc.) consume to render transactions and signature requests as human-readable intents instead of opaque calldata or typed-data blobs.

Allowed "format" values and their typical "params":
- "raw" — no params; show the value as-is.
- "amount" — { } — for ETH/wei amounts; wallet handles decimals.
- "tokenAmount" — { "tokenPath": "<param path>" } OR { "token": { "address": "0x..", "chainId": 1 } } — for ERC-20 amounts.
- "addressName" — { "types": ["wallet" | "eoa" | "contract" | "token"], "sources": ["local" | "ens"] } — render addresses with name resolution.
- "date" — { "encoding": "timestamp" | "blockheight" }
- "duration" — { } — seconds → friendly duration.
- "unit" — { "base": "<unit symbol>", "decimals": <int>, "prefix": "<optional>" }
- "nft" — { "collectionPath": "<param path>" }
- "enum" — { "$ref": "$.enums.<enumName>" } — values mapped under top-level "enums".

Output rules:
- Output STRICT JSON. No prose, no markdown fences, no trailing commas.
- metadata.info may contain only "url" (required) and optionally "deploymentDate". Do NOT add other keys.
- Each format entry may have only "intent", "interpolatedIntent", "fields", "$id" — do NOT include "required" or other extra keys.

Writing good intents:
- Intents must describe the user-visible EFFECT of the call, not restate the function name. Bad: "Deposit ETH". Good: "Deposit ETH into your vault balance".
- Read the NatSpec @notice and the function/struct body for the semantic effect (what state changes, who is credited/debited, where funds go) and surface that in the intent.
- Prefer second person ("your balance", "your tokens") when the contract acts on behalf of msg.sender.
- Field labels should be Title Case and concise.
- Use tokenAmount for ERC-20 token amounts (wei-denominated uint256 values that represent token quantities). Use amount for native ETH.
- Use addressName for every address parameter. Choose types based on context (spender → ["wallet","contract"], recipient → ["wallet","eoa","contract"], token → ["token"]).`;

const CALLDATA_SECTION = `Calldata descriptor shape (this task):

{
  "$schema": "https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json",
  "context": {
    "$id": "<short contract id>",
    "contract": {
      "abi": [...],
      "deployments": [{ "chainId": 1, "address": "0x0000000000000000000000000000000000000000" }]
    }
  },
  "metadata": { "owner": "<project name>", "info": { "url": "<https url>" } },
  "display": {
    "formats": {
      "<parameterised signature, e.g. transfer(address recipient, uint256 amount)>": {
        "intent": "<short verb phrase>",
        "fields": [
          { "path": "<param name>", "label": "<human label>", "format": "<format type>", "params": { ... } }
        ]
      }
    }
  }
}

Calldata-specific rules:
- Include EVERY external/public non-view function from the supplied ABI in display.formats, keyed by its PARAMETERISED signature (with parameter names, e.g. "transfer(address recipient, uint256 amount)" — NOT the canonical ABI form).
- Do not invent function selectors. Use the exact canonical signatures from the supplied list.

Transaction-level paths (not ABI parameters):
- "$.value" refers to msg.value (the ETH attached to the transaction).
- For payable functions where msg.value carries the user-visible amount (e.g. deposits, payments, mints priced in ETH), include a field with path "$.value", a clear label, and format "amount". This lets the wallet show the ETH amount as a labelled descriptor row rather than only as the generic "Value" field.`;

const EIP712_SECTION = `EIP-712 descriptor shape (this task):

{
  "$schema": "https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json",
  "context": {
    "$id": "<short contract id>",
    "eip712": {
      "domain": {
        "name": "<EIP-712 domain name, from the contract's domain separator>",
        "version": "<domain version, e.g. \\"1\\">",
        "chainId": 1,
        "verifyingContract": "0x0000000000000000000000000000000000000000"
      },
      "deployments": [{ "chainId": 1, "address": "0x0000000000000000000000000000000000000000" }]
    }
  },
  "metadata": { "owner": "<project name>", "info": { "url": "<https url>" } },
  "display": {
    "formats": {
      "<encodeType string, e.g. Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)>": {
        "intent": "<what signing this message does>",
        "fields": [
          { "path": "<struct field name>", "label": "<human label>", "format": "<format type>", "params": { ... } }
        ]
      }
    }
  }
}

EIP-712-specific rules:
- Extract typed-data structs from the Solidity source. Look for: \`bytes32 constant <NAME>_TYPEHASH = keccak256("<encodeType>")\` definitions, \`struct\` definitions referenced inside \`_hashTypedDataV4\` / \`abi.encode(TYPEHASH, ...)\`, ERC-2612 \`Permit\`, ERC-4337 \`UserOperation\`, and OpenZeppelin EIP712 usage.
- One display.formats entry per primary type. The KEY MUST be the canonical EIP-712 \`encodeType\` string (NO spaces between fields): \`PrimaryType(type1 field1,type2 field2,...)\`. If the struct references other structs, append their encodings in alphabetical order per the EIP-712 spec.
- Populate context.eip712.domain from the contract's EIP712 domain separator (typically the contract name as \`name\`, "1" as \`version\`). Use placeholders if the source does not specify version explicitly.
- "$.value" is NOT valid for EIP-712 (no msg.value when signing typed data). Do not emit a $.value field.
- If the contract does NOT define any EIP-712 typed data (no TYPEHASH constants, no \`_hashTypedDataV4\` calls, no struct hashing), emit a descriptor with \`display.formats: {}\` and the runtime will skip writing it.`;

export const SYSTEM_PROMPTS: Record<DescriptorKind, string> = {
  calldata: `${SHARED_PREAMBLE}\n\n${CALLDATA_SECTION}`,
  eip712: `${SHARED_PREAMBLE}\n\n${EIP712_SECTION}`,
};

function sourceExcerpt(art: ContractArtifact): string {
  if (!art.source) return "// (source not available)";
  return art.source.length > 12000
    ? art.source.slice(0, 12000) + "\n// ... source truncated ..."
    : art.source;
}

function commonArtifactSections(art: ContractArtifact): string[] {
  return [
    "ABI:",
    "```json",
    JSON.stringify(art.abi, null, 2),
    "```",
    "",
    "NatSpec devdoc:",
    "```json",
    JSON.stringify(art.devdoc ?? {}, null, 2),
    "```",
    "",
    "NatSpec userdoc:",
    "```json",
    JSON.stringify(art.userdoc ?? {}, null, 2),
    "```",
    "",
    "Solidity source:",
    "```solidity",
    sourceExcerpt(art),
    "```",
  ];
}

function buildCalldataUserMessage(art: ContractArtifact): string {
  const signatures = listExternalFunctions(art.abi).map(parameterizedSignature);
  return [
    `Contract: ${art.name}`,
    `Source file: ${art.sourceName}`,
    "",
    "External/public non-view function signatures (you must emit a display.formats entry for each):",
    signatures.map((s) => `- ${s}`).join("\n") || "(none)",
    "",
    ...commonArtifactSections(art),
    "",
    "Emit the ERC-7730 v2 calldata descriptor JSON now. Output only the JSON document.",
  ].join("\n");
}

function buildEip712UserMessage(art: ContractArtifact): string {
  return [
    `Contract: ${art.name}`,
    `Source file: ${art.sourceName}`,
    "",
    "Task: produce an ERC-7730 v2 EIP-712 descriptor for this contract.",
    "Read the Solidity source below and extract every EIP-712 typed-data struct the contract uses for signing (TYPEHASH constants, structs passed to _hashTypedDataV4, ERC-2612 Permit, etc.).",
    "If you find NONE, return a descriptor with display.formats = {} and the runtime will skip writing it.",
    "",
    ...commonArtifactSections(art),
    "",
    "Emit the ERC-7730 v2 EIP-712 descriptor JSON now. Output only the JSON document.",
  ].join("\n");
}

export function buildUserMessage(
  art: ContractArtifact,
  kind: DescriptorKind,
): string {
  return kind === "eip712"
    ? buildEip712UserMessage(art)
    : buildCalldataUserMessage(art);
}
