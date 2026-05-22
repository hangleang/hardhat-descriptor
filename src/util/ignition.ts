import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface IgnitionContract {
  contractName: string;
  address: string;
}

export interface IgnitionDeployment {
  deploymentId: string;
  chainId: number | undefined;
  contracts: IgnitionContract[];
}

export function readIgnitionDeployment(
  projectRoot: string,
): IgnitionDeployment | undefined {
  const root = path.join(projectRoot, "ignition", "deployments");
  const dir = mostRecentSubdir(root);
  if (!dir) return undefined;

  let raw: string;
  try {
    raw = readFileSync(path.join(dir, "deployed_addresses.json"), "utf8");
  } catch {
    return undefined;
  }
  const data = JSON.parse(raw) as Record<string, string>;
  const id = path.basename(dir);
  const chainMatch = id.match(/^chain-(\d+)$/);
  const chainId = chainMatch ? Number(chainMatch[1]) : undefined;

  const contracts: IgnitionContract[] = Object.entries(data).map(
    ([key, address]) => ({
      contractName: key.includes("#") ? key.slice(key.lastIndexOf("#") + 1) : key,
      address,
    }),
  );
  return { deploymentId: id, chainId, contracts };
}

function mostRecentSubdir(root: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name));
  } catch {
    return undefined;
  }
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return entries[0];
}
