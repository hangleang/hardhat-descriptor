import { readFileSync } from "node:fs";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { AbiItem } from "../util/selectors.js";

export interface ContractArtifact {
  name: string;
  sourceName: string;
  abi: AbiItem[];
  devdoc: unknown;
  userdoc: unknown;
  source: string | undefined;
}

interface BuildInfoOutput {
  contracts?: Record<
    string,
    Record<
      string,
      {
        abi?: AbiItem[];
        devdoc?: unknown;
        userdoc?: unknown;
      }
    >
  >;
  sources?: Record<string, { content?: string }>;
}

interface BuildInfo {
  input?: { sources?: Record<string, { content?: string }> };
  output?: BuildInfoOutput;
}

export async function loadContractArtifact(
  hre: HardhatRuntimeEnvironment,
  fullyQualifiedName: string,
): Promise<ContractArtifact | null> {
  const artifacts = (hre as unknown as { artifacts: any }).artifacts;
  const artifact = await artifacts.readArtifact(fullyQualifiedName);
  const sourceName: string = artifact.sourceName;
  const name: string = artifact.contractName;
  const inputSourceName: string = artifact.inputSourceName ?? sourceName;

  let buildInfo: BuildInfo | undefined;
  let buildInfoOutput: BuildInfoOutput | undefined;

  // Hardhat 3: load build-info via id + path lookups. Tests inject a legacy
  // getBuildInfo() that returns the merged shape directly — accept both.
  if (typeof artifacts.getBuildInfo === "function") {
    const legacy = await artifacts.getBuildInfo(fullyQualifiedName);
    buildInfo = legacy;
    buildInfoOutput = legacy?.output;
  } else if (typeof artifacts.getBuildInfoId === "function") {
    const id: string | undefined = await artifacts.getBuildInfoId(fullyQualifiedName);
    if (id) {
      const inputPath: string | undefined = await artifacts.getBuildInfoPath(id);
      const outputPath: string | undefined = await artifacts.getBuildInfoOutputPath(id);
      if (inputPath) buildInfo = JSON.parse(readFileSync(inputPath, "utf8"));
      if (outputPath) buildInfoOutput = JSON.parse(readFileSync(outputPath, "utf8")).output;
    }
  }

  const compiled = buildInfoOutput?.contracts?.[inputSourceName]?.[name]
    ?? buildInfoOutput?.contracts?.[sourceName]?.[name];
  const source =
    buildInfo?.input?.sources?.[inputSourceName]?.content ??
    buildInfo?.input?.sources?.[sourceName]?.content ??
    buildInfoOutput?.sources?.[inputSourceName]?.content ??
    buildInfoOutput?.sources?.[sourceName]?.content;

  return {
    name,
    sourceName,
    abi: artifact.abi as AbiItem[],
    devdoc: compiled?.devdoc,
    userdoc: compiled?.userdoc,
    source: typeof source === "string" ? source : undefined,
  };
}

export async function listCompiledContracts(
  hre: HardhatRuntimeEnvironment,
): Promise<string[]> {
  const artifacts = (hre as unknown as { artifacts: any }).artifacts;
  const names: Iterable<string> = await artifacts.getAllFullyQualifiedNames();
  return Array.from(names);
}
