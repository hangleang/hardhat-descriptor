import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { DescriptorConfig } from "../config.js";
import { submitToRegistry, type SubmitResult } from "../util/submit.js";
import { c, log } from "../util/log.js";

interface SubmitTaskArguments {
  files?: string[];
  registry?: string;
  yes?: boolean;
}

export interface SubmitDeps {
  submit?: (opts: {
    written: string[];
    owner: string;
    registryRepo?: string;
    assumeYes?: boolean;
  }) => Promise<SubmitResult>;
}

export async function runSubmit(
  args: SubmitTaskArguments,
  hre: HardhatRuntimeEnvironment,
  deps: SubmitDeps = {},
): Promise<SubmitResult> {
  const cfg = (hre.config as { descriptor: DescriptorConfig }).descriptor;
  if (!cfg.owner) {
    throw new Error(
      "hardhat-descriptor: descriptor submit requires descriptor.owner to be set (it becomes the registry entity folder).",
    );
  }

  const outAbs = path.isAbsolute(cfg.outDir)
    ? cfg.outDir
    : path.join(process.cwd(), cfg.outDir);

  const files =
    args.files && args.files.length > 0
      ? args.files.map((f) => (path.isAbsolute(f) ? f : path.join(process.cwd(), f)))
      : discoverDescriptors(outAbs);

  if (files.length === 0) {
    throw new Error(
      `hardhat-descriptor: no descriptors found to submit. Run \`npx hardhat descriptor generate\` first or pass file paths explicitly.`,
    );
  }

  log.info(
    `submitting ${c.bold(String(files.length))} descriptor${files.length === 1 ? "" : "s"} for ${c.bold(cfg.owner)}`,
  );

  const submitter = deps.submit ?? submitToRegistry;
  const pr = await submitter({
    written: files,
    owner: cfg.owner,
    registryRepo: args.registry || undefined,
    assumeYes: args.yes ?? false,
  });
  const verb = pr.updated ? "updated existing PR" : "draft PR opened";
  log.success(
    `${verb} ${c.dim("·")} entity ${c.bold(pr.entity)} ${c.dim("→")} ${c.cyan(pr.prUrl)}`,
  );
  return pr;
}

function discoverDescriptors(dir: string): string[] {
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(dir)
    .filter(
      (name) =>
        (name.startsWith("calldata-") || name.startsWith("eip712-")) &&
        name.endsWith(".json"),
    )
    .map((name) => path.join(dir, name))
    .sort();
}

export default async function (
  args: SubmitTaskArguments,
  hre: HardhatRuntimeEnvironment,
): Promise<void> {
  await runSubmit(args, hre);
}
