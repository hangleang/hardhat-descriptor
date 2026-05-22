import { toFunctionSelector } from "viem";

export interface AbiInput {
  name?: string;
  type: string;
  components?: AbiInput[];
}

export interface AbiFunction {
  type: "function";
  name: string;
  inputs: AbiInput[];
  outputs?: AbiInput[];
  stateMutability?: "pure" | "view" | "nonpayable" | "payable";
}

export type AbiItem =
  | AbiFunction
  | { type: "constructor" | "fallback" | "receive" | "event" | "error"; [k: string]: unknown };

function canonicalType(input: AbiInput): string {
  if (input.type.startsWith("tuple")) {
    const inner = (input.components ?? []).map(canonicalType).join(",");
    return input.type.replace("tuple", `(${inner})`);
  }
  return input.type;
}

export function functionSignature(fn: AbiFunction): string {
  const args = fn.inputs.map(canonicalType).join(",");
  return `${fn.name}(${args})`;
}

/**
 * Parameterised signature used as a key in `display.formats` per ERC-7730 v2.
 * Example: `transfer(address recipient, uint256 amount)`.
 */
export function parameterizedSignature(fn: AbiFunction): string {
  const args = fn.inputs
    .map((p, i) => `${canonicalType(p)} ${p.name ?? `arg${i}`}`)
    .join(", ");
  return `${fn.name}(${args})`;
}

export function functionSelector(fn: AbiFunction): `0x${string}` {
  return toFunctionSelector(functionSignature(fn));
}

export function listExternalFunctions(abi: AbiItem[]): AbiFunction[] {
  return abi
    .filter((i): i is AbiFunction => i.type === "function")
    .filter((f) => f.stateMutability !== "pure" && f.stateMutability !== "view");
}
