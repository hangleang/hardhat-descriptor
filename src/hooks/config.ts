import { existsSync } from "node:fs";
import path from "node:path";
import type { ConfigHooks } from "hardhat/types/hooks";
import { resolveConfig, type DescriptorUserConfig } from "../config.js";

function loadDotEnv(): void {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  const loader = (process as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof loader === "function") loader(file);
}

export default async (): Promise<Partial<ConfigHooks>> => ({
  async resolveUserConfig(userConfig, resolveConfigurationVariable, next) {
    loadDotEnv();
    const resolved = await next(userConfig, resolveConfigurationVariable);
    const userDescriptor = (userConfig as { descriptor?: unknown }).descriptor as
      | DescriptorUserConfig
      | undefined;
    return {
      ...resolved,
      descriptor: resolveConfig(userDescriptor),
    };
  },
});
