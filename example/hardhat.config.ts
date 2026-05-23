import type { HardhatUserConfig } from "hardhat/config";
import descriptor from "hardhat-descriptor";
import HardhatIgnition from "@nomicfoundation/hardhat-ignition";

const config: HardhatUserConfig = {
  plugins: [HardhatIgnition, descriptor],
  solidity: {
    version: "0.8.24",
  },
  networks: {
    mainnet: {
      type: "http",
      chainType: "l1",
      url: "https://eth.drpc.org",
      chainId: 1,
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org",
      chainId: 11155111,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  descriptor: {
    owner: "Vault Inc.",
    url: "https://vault.example",
  },
};

export default config;
