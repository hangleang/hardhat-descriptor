import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { resolveConfig, type DescriptorUserConfig } from "../config.js";
import { lintFile } from "../validator/lint.js";
import { c, log } from "../util/log.js";

interface LintTaskArguments {
  files?: string[];
}

export async function runLint(
  args: LintTaskArguments,
  hre: HardhatRuntimeEnvironment,
): Promise<number> {
  const userCfg = (hre.config as { descriptor?: unknown }).descriptor as
    | DescriptorUserConfig
    | undefined;
  const cfg = resolveConfig(userCfg);

  const files =
    args.files && args.files.length > 0
      ? args.files
      : discoverDescriptors(
          path.isAbsolute(cfg.outDir) ? cfg.outDir : path.join(process.cwd(), cfg.outDir),
        );

  if (files.length === 0) {
    log.warn("no descriptor files found to lint.");
    return 0;
  }

  log.info(
    `linting ${c.bold(String(files.length))} descriptor${files.length === 1 ? "" : "s"}`,
  );

  let failed = 0;
  for (const f of files) {
    const rel = path.relative(process.cwd(), f);
    const result = lintFile(f);
    if (result.ok) {
      log.success(`${c.cyan(rel)}`);
    } else {
      failed++;
      log.error(`${c.cyan(rel)}`);
      console.error(c.red(result.errors));
    }
  }
  if (failed > 0) {
    log.error(
      `${c.bold(String(failed))} of ${files.length} descriptor${files.length === 1 ? "" : "s"} failed validation`,
    );
    throw new Error(
      `hardhat-descriptor: ${failed} of ${files.length} descriptor(s) failed validation.`,
    );
  }
  log.success(`all ${files.length} descriptor${files.length === 1 ? "" : "s"} valid`);
  return failed;
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
  args: LintTaskArguments,
  hre: HardhatRuntimeEnvironment,
): Promise<void> {
  await runLint(args, hre);
}
