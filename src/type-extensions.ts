import "hardhat/types/config";
import type { DescriptorUserConfig, DescriptorConfig } from "./config.js";

declare module "hardhat/types/config" {
  interface HardhatUserConfig {
    descriptor?: DescriptorUserConfig;
  }
  interface HardhatConfig {
    descriptor: DescriptorConfig;
  }
}
