import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { DEFAULT_CHAIN_ID, type DescriptorConfig } from "../config.js";
import {
  loadContractArtifact,
  listCompiledContracts,
} from "../generator/artifacts.js";
import { createLLMClient, type LLMClient } from "../generator/factory.js";
import { postprocess } from "../generator/postprocess.js";
import { lintDescriptor } from "../validator/lint.js";
import { listExternalFunctions } from "../util/selectors.js";
import { descriptorFile, type DescriptorKind } from "../util/paths.js";
import { c, log } from "../util/log.js";
import {
  computeLlmFingerprint,
  computeOutFingerprint,
  readCache,
  writeCache,
} from "../util/fingerprint.js";
import { readIgnitionDeployment } from "../util/ignition.js";

interface GenerateTaskArguments {
  contract?: string;
  address?: string;
  type?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface GenerateDeps {
  makeClient?: (cfg: DescriptorConfig) => LLMClient;
}


function resolveKinds(arg: string | undefined): DescriptorKind[] {
  const value = (arg ?? "both").toLowerCase();
  switch (value) {
    case "calldata":
      return ["calldata"];
    case "eip712":
      return ["eip712"];
    case "both":
      return ["calldata", "eip712"];
    default:
      throw new Error(
        `hardhat-descriptor: invalid --type "${arg}". Expected "calldata", "eip712", or "both".`,
      );
  }
}

export async function runGenerate(
  args: GenerateTaskArguments,
  hre: HardhatRuntimeEnvironment,
  deps: GenerateDeps = {},
): Promise<{ written: string[]; skipped: string[] }> {
  const cfg = (hre.config as { descriptor: DescriptorConfig }).descriptor;
  const makeClient = deps.makeClient ?? createLLMClient;

  let ignitionAddresses: Map<string, string> | undefined;
  let ignitionChainId: number | undefined;
  if (!args.address) {
    const projectRoot = (hre.config as { paths?: { root?: string } }).paths?.root ?? process.cwd();
    const deployment = readIgnitionDeployment(projectRoot);
    if (deployment) {
      ignitionAddresses = new Map(deployment.contracts.map((c) => [c.contractName, c.address]));
      ignitionChainId = deployment.chainId;
      log.info(
        `using Ignition deployment ${c.bold(deployment.deploymentId)} ${c.dim("·")} ${c.bold(String(ignitionAddresses.size))} contract${ignitionAddresses.size === 1 ? "" : "s"}`,
      );
    }
  }

  const networkName = (hre.globalOptions as { network?: string } | undefined)?.network;
  let networkChainId: number | undefined;
  if (networkName) {
    const networks = (hre.config as { networks?: Record<string, { chainId?: number }> }).networks;
    const net = networks?.[networkName];
    if (!net) {
      throw new Error(
        `hardhat-descriptor: network "${networkName}" is not defined in hardhat.config networks.`,
      );
    }
    if (typeof net.chainId !== "number") {
      throw new Error(
        `hardhat-descriptor: network "${networkName}" has no chainId in hardhat.config.`,
      );
    }
    networkChainId = net.chainId;
  }
  const chainId = networkChainId ?? ignitionChainId ?? DEFAULT_CHAIN_ID;
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`hardhat-descriptor: invalid chainId "${chainId}".`);
  }
  const kinds = resolveKinds(args.type);

  const allNames = await listCompiledContracts(hre);
  let selected = filterContracts(allNames, args.contract, cfg.contracts);
  if (ignitionAddresses) {
    selected = selected.filter((fq) => {
      const name = fq.includes(":") ? fq.slice(fq.lastIndexOf(":") + 1) : fq;
      return ignitionAddresses!.has(name);
    });
  }
  if (selected.length === 0) {
    if (ignitionAddresses) {
      log.warn("no compiled contracts matched the Ignition deployment.");
    } else {
      log.warn("no contracts matched. Did you run `npx hardhat compile` first?");
    }
    return { written: [], skipped: [] };
  }

  const providerSegment =
    cfg.provider === "none"
      ? `${c.bold("no-llm")} ${c.dim("(ABI-only baseline)")}`
      : `${c.bold(cfg.provider)} ${c.dim("·")} model ${c.bold(cfg.model)}`;
  log.info(
    `using ${providerSegment} ${c.dim("·")} ${c.bold(String(selected.length))} contract${selected.length === 1 ? "" : "s"} ${c.dim("·")} kinds: ${c.bold(kinds.join(", "))}`,
  );
  const outAbs = path.isAbsolute(cfg.outDir)
    ? cfg.outDir
    : path.join(process.cwd(), cfg.outDir);
  if (!args.dryRun) mkdirSync(outAbs, { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];
  let client: LLMClient | undefined;
  const getClient = (): LLMClient => (client ??= makeClient(cfg));

  for (const fqName of selected) {
    const artifact = await loadContractArtifact(hre, fqName);
    if (!artifact) {
      skipped.push(`${fqName} (no artifact)`);
      continue;
    }
    if (listExternalFunctions(artifact.abi).length === 0) {
      skipped.push(`${artifact.name} (no external non-view functions)`);
      continue;
    }

    const address = ignitionAddresses?.get(artifact.name) ?? (args.address || undefined);
    for (const kind of kinds) {
      const llmFp = computeLlmFingerprint({ artifact, cfg, kind });
      const outFp = computeOutFingerprint({ artifact, cfg, kind, address, chainId });
      const descriptorPath = descriptorFile(outAbs, artifact.name, kind);
      const cached = args.dryRun || args.force ? undefined : readCache(outAbs, artifact.name, kind);

      if (cached && cached.out === outFp && existsSync(descriptorPath)) {
        log.info(
          `${c.bold(artifact.name)} ${c.dim("·")} ${kind} ${c.dim("unchanged · skipping (use --force to regenerate)")}`,
        );
        skipped.push(`${artifact.name} ${kind} (unchanged)`);
        continue;
      }

      let raw: unknown;
      let elapsed: string;
      const reuseRaw = cached && cached.llm === llmFp && cached.raw !== undefined;
      if (reuseRaw) {
        raw = cached.raw;
        elapsed = "0.0";
        log.step(`re-applying ${kind} descriptor for ${c.bold(artifact.name)} ${c.dim("(cached LLM response)")}…`);
      } else {
        log.step(`generating ${kind} descriptor for ${c.bold(artifact.name)}…`);
        const t0 = Date.now();
        raw = await getClient().generate(artifact, kind);
        elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      }

      const { descriptor, warnings } = postprocess({
        raw,
        artifact,
        config: cfg,
        address,
        chainId,
        kind,
      });
      for (const w of warnings) log.warn(w);

      if (descriptor === null) {
        skipped.push(`${artifact.name} ${kind} (no typed data)`);
        if (!args.dryRun) writeCache(outAbs, artifact.name, kind, { llm: llmFp, out: outFp, raw });
        continue;
      }

      const result = lintDescriptor(descriptor);
      if (!result.ok) {
        log.error(`schema validation failed for ${artifact.name} (${kind})`);
        throw new Error(
          `hardhat-descriptor: generated ${kind} descriptor for ${artifact.name} failed schema validation:\n${result.errors}`,
        );
      }

      const formats = Object.keys(
        ((descriptor as { display?: { formats?: Record<string, unknown> } }).display?.formats) ?? {},
      );
      const serialized = JSON.stringify(descriptor, null, 2) + "\n";
      if (args.dryRun) {
        log.success(
          `${c.bold(artifact.name)} ${c.dim("·")} ${kind} ${c.dim("·")} ${formats.length} format${formats.length === 1 ? "" : "s"} ${c.dim("·")} ${elapsed}s ${c.dim("(dry-run)")}`,
        );
        console.log(serialized);
      } else {
        writeFileSync(descriptorPath, serialized);
        writeCache(outAbs, artifact.name, kind, { llm: llmFp, out: outFp, raw });
        written.push(descriptorPath);
        log.success(
          `${c.bold(artifact.name)} ${c.dim("·")} ${kind} ${c.dim("·")} ${formats.length} format${formats.length === 1 ? "" : "s"} ${c.dim("·")} ${elapsed}s ${c.dim("→")} ${c.cyan(path.relative(process.cwd(), descriptorPath))}`,
        );
      }
    }
  }

  if (skipped.length > 0) {
    for (const s of skipped) log.detail(`skipped ${s}`);
  }
  if (written.length > 0) {
    log.info(
      `${c.green("done")} ${c.dim("·")} ${written.length} descriptor${written.length === 1 ? "" : "s"} written${skipped.length ? `, ${skipped.length} skipped` : ""}`,
    );
  }

  return { written, skipped };
}

function filterContracts(
  all: string[],
  cliContract: string | undefined,
  cfgList: string[] | undefined,
): string[] {
  if (cliContract) {
    return all.filter(
      (n) => n === cliContract || n.endsWith(`:${cliContract}`),
    );
  }
  if (cfgList && cfgList.length > 0) {
    return all.filter((n) => cfgList.some((c) => n === c || n.endsWith(`:${c}`)));
  }
  return all;
}

export default async function (
  args: GenerateTaskArguments,
  hre: HardhatRuntimeEnvironment,
): Promise<void> {
  await runGenerate(args, hre);
}
