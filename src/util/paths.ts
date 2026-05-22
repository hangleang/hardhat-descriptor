import path from "node:path";

export type DescriptorKind = "calldata" | "eip712";

export function descriptorFile(
  outDir: string,
  contractName: string,
  kind: DescriptorKind,
): string {
  return path.join(outDir, `${kind}-${contractName}.json`);
}
