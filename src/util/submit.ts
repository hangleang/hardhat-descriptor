import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as readline from "node:readline";
import { c, log } from "./log.js";

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "hardhat-descriptor: confirmation required but stdin is not a TTY. Re-run with --yes to skip the prompt.",
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

const REGISTRY_REPO = "ethereum/clear-signing-erc7730-registry";

export interface SubmitOptions {
  written: string[];
  owner: string;
  /** Override the upstream registry slug. Defaults to ethereum/clear-signing-erc7730-registry. */
  registryRepo?: string;
  /** Skip the interactive confirmation prompt before pushing / opening the PR. */
  assumeYes?: boolean;
}

export interface SubmitResult {
  prUrl: string;
  branch: string;
  entity: string;
  updated: boolean;
}

interface ExistingPR {
  number: number;
  url: string;
  branch: string;
}

function findExistingPR(
  upstream: string,
  ghUser: string,
  entity: string,
): ExistingPR | undefined {
  let raw: string;
  try {
    raw = run("gh", [
      "pr",
      "list",
      "--repo",
      upstream,
      "--author",
      "@me",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,url,headRefName,headRepositoryOwner,files",
    ]);
  } catch (err) {
    log.warn(`could not list existing PRs in ${upstream}: ${(err as Error).message}`);
    return undefined;
  }
  type PrRow = {
    number: number;
    url: string;
    headRefName: string;
    headRepositoryOwner?: { login?: string };
    files?: { path: string }[];
  };
  const rows = JSON.parse(raw) as PrRow[];
  log.detail(`found ${rows.length} open PR${rows.length === 1 ? "" : "s"} from ${ghUser} in ${upstream}`);

  const entityPathPrefix = `registry/${entity}/`;
  const branchPrefix = `hardhat-descriptor/${entity}`;
  const matches = rows.filter((pr) => {
    if (pr.headRepositoryOwner?.login && pr.headRepositoryOwner.login !== ghUser) return false;
    if (pr.headRefName === branchPrefix || pr.headRefName.startsWith(`${branchPrefix}-`)) return true;
    return (pr.files ?? []).some((f) => f.path.startsWith(entityPathPrefix));
  });
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    log.warn(
      `multiple open PRs match entity "${entity}" (#${matches.map((m) => m.number).join(", #")}); updating #${matches[0].number}.`,
    );
  }
  log.info(`reusing open PR #${matches[0].number} (${matches[0].headRefName}) for entity "${entity}"`);
  return {
    number: matches[0].number,
    url: matches[0].url,
    branch: matches[0].headRefName,
  };
}

export function slugifyEntity(owner: string): string {
  const slug = owner
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  if (!slug) {
    throw new Error(
      `hardhat-descriptor: cannot derive a registry entity folder from owner "${owner}". Set a meaningful descriptor.owner.`,
    );
  }
  return slug;
}

function run(cmd: string, args: string[], cwd?: string): string {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message: string };
    const stderr = e.stderr?.toString() ?? "";
    const stdout = e.stdout?.toString() ?? "";
    throw new Error(`${cmd} ${args.join(" ")} failed: ${stderr || stdout || e.message}`);
  }
}

// Reuse a single SSH connection across `gh repo clone`, `git fetch`, `git push`.
// Without this the user gets prompted for their key passphrase once per operation.
// Honor a pre-set GIT_SSH_COMMAND so users with their own SSH config win.
function enableSshMultiplexing(): void {
  if (process.env.GIT_SSH_COMMAND) return;
  const dir = mkdtempSync(path.join(tmpdir(), "hd-ssh-"));
  const socket = path.join(dir, "cm-%C");
  process.env.GIT_SSH_COMMAND = `ssh -o ControlMaster=auto -o ControlPath=${socket} -o ControlPersist=60s`;
}

function ensureGhAvailable(): void {
  try {
    run("gh", ["--version"]);
  } catch {
    throw new Error(
      'hardhat-descriptor: --submit requires the GitHub CLI ("gh"). Install from https://cli.github.com and run `gh auth login`.',
    );
  }
  try {
    run("gh", ["auth", "status"]);
  } catch {
    throw new Error('hardhat-descriptor: `gh auth status` failed. Run `gh auth login` first.');
  }
}

export async function submitToRegistry(opts: SubmitOptions): Promise<SubmitResult> {
  const { written, owner } = opts;
  if (written.length === 0) {
    throw new Error("hardhat-descriptor: nothing to submit — no descriptors were written.");
  }
  const upstream = opts.registryRepo ?? REGISTRY_REPO;
  const entity = slugifyEntity(owner);

  ensureGhAvailable();
  enableSshMultiplexing();

  const ghUser = run("gh", ["api", "user", "--jq", ".login"]).trim();
  const ownsUpstream = upstream.split("/")[0] === ghUser;
  const fork = ownsUpstream ? upstream : `${ghUser}/${upstream.split("/")[1]}`;
  const baseBranch = run("gh", ["api", `repos/${upstream}`, "--jq", ".default_branch"]).trim();

  if (ownsUpstream) {
    log.step(`${c.bold(upstream)} is already owned by ${c.bold(ghUser)} — skipping fork, will PR within the repo.`);
  } else {
    log.step(`forking ${c.bold(upstream)} to ${c.bold(fork)} (no-op if already forked)…`);
    run("gh", ["repo", "fork", upstream, "--clone=false"]);
  }

  const existing = findExistingPR(upstream, ghUser, entity);

  const work = mkdtempSync(path.join(tmpdir(), "hardhat-descriptor-submit-"));
  const repoDir = path.join(work, "registry");

  if (existing) {
    log.step(
      `found open PR ${c.bold("#" + existing.number)} on branch ${c.bold(existing.branch)} — updating in place…`,
    );
    run("gh", ["repo", "clone", fork, repoDir, "--", "--depth=1", `--branch=${existing.branch}`]);
  } else {
    log.step(`cloning ${ownsUpstream ? "registry" : "fork"} to ${c.dim(repoDir)}…`);
    run("gh", ["repo", "clone", fork, repoDir, "--", "--depth=1"]);
    if (!ownsUpstream) {
      const upstreamUrl = `https://github.com/${upstream}.git`;
      try {
        run("git", ["remote", "add", "upstream", upstreamUrl], repoDir);
      } catch {
        run("git", ["remote", "set-url", "upstream", upstreamUrl], repoDir);
      }
      run("git", ["fetch", "upstream", baseBranch, "--depth=1"], repoDir);
    }
  }

  const baseRemote = ownsUpstream ? "origin" : "upstream";
  const branch = existing
    ? existing.branch
    : `hardhat-descriptor/${entity}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  if (!existing) {
    run("git", ["checkout", "-b", branch, `${baseRemote}/${baseBranch}`], repoDir);
  }

  const entityDir = path.join(repoDir, "registry", entity);
  mkdirSync(entityDir, { recursive: true });
  for (const src of written) {
    copyFileSync(src, path.join(entityDir, path.basename(src)));
  }

  run("git", ["add", path.join("registry", entity)], repoDir);
  const hasChanges = (() => {
    try {
      run("git", ["diff", "--cached", "--quiet"], repoDir);
      return false;
    } catch {
      return true;
    }
  })();

  if (!hasChanges) {
    if (existing) {
      log.info(`no descriptor changes — PR #${existing.number} is already up to date.`);
      return { prUrl: existing.url, branch, entity, updated: true };
    }
    throw new Error("hardhat-descriptor: descriptors match upstream exactly; nothing to submit.");
  }

  const commitMessage = existing
    ? `Update ${entity} descriptors\n\nRegenerated by hardhat-descriptor.`
    : `Add ${entity} descriptors\n\nGenerated by hardhat-descriptor.`;

  if (!opts.assumeYes) {
    const action = existing
      ? `update PR #${existing.number} on ${c.bold(upstream)}`
      : `open a new draft PR on ${c.bold(upstream)}`;
    log.info(`About to ${action}:`);
    log.detail(`  entity:  ${entity}`);
    log.detail(`  branch:  ${ghUser}:${branch}`);
    log.detail(`  files:   ${written.map((f) => path.basename(f)).join(", ")}`);
    const ok = await confirm(`${c.dim("?")} Push and ${existing ? "update PR" : "open PR"}? [y/N] `);
    if (!ok) {
      log.warn("submission cancelled by user.");
      throw new Error("hardhat-descriptor: submission cancelled.");
    }
  }

  run("git", ["commit", "-m", commitMessage], repoDir);
  log.step(`pushing branch ${c.bold(branch)}…`);
  run("git", ["push", "-u", "origin", branch], repoDir);

  if (existing) {
    log.success(`updated PR ${c.bold("#" + existing.number)}.`);
    return { prUrl: existing.url, branch, entity, updated: true };
  }

  const body = [
    `Adds ERC-7730 descriptors for **${owner}**.`,
    "",
    "Generated with [hardhat-descriptor](https://github.com/hangleang/hardhat-descriptor).",
    "Each file is LLM-authored and has been reviewed for clear-signing correctness before submission.",
    "",
    "Files in this PR:",
    ...written.map((f) => `- \`registry/${entity}/${path.basename(f)}\``),
  ].join("\n");

  const prUrl = run(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      upstream,
      "--draft",
      "--title",
      `Add ${entity} descriptors`,
      "--body",
      body,
      "--head",
      ownsUpstream ? branch : `${ghUser}:${branch}`,
      "--base",
      baseBranch,
    ],
    repoDir,
  ).trim();

  return { prUrl, branch, entity, updated: false };
}
