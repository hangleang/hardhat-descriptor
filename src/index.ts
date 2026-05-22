import type { HardhatPlugin } from "hardhat/types/plugins";
import { task, emptyTask } from "hardhat/config";
import "./type-extensions.js";

const descriptorTask = emptyTask("descriptor", "ERC-7730 clear-signing descriptor tooling.").build();

const generateTask = task(["descriptor", "generate"], "Generate ERC-7730 clear-signing descriptors with Claude.")
  .addOption({
    name: "contract",
    description: "Restrict generation to a single contract name (or fully qualified name).",
    defaultValue: "",
  })
  .addOption({
    name: "address",
    description: "Deployed contract address to inject into context.contract.deployments.",
    defaultValue: "",
  })
  .addOption({
    name: "type",
    description: "Descriptor kind to generate: \"calldata\", \"eip712\", or \"both\" (default).",
    defaultValue: "both",
  })
  .addFlag({
    name: "dryRun",
    description: "Print descriptors to stdout instead of writing to disk.",
  })
  .addFlag({
    name: "force",
    description: "Regenerate descriptors even if inputs are unchanged from the last run.",
  })
  .setAction(() => import("./tasks/generate.js"))
  .build();

const lintTask = task(["descriptor", "lint"], "Validate ERC-7730 descriptors against the official JSON schema.")
  .addVariadicArgument({
    name: "files",
    description: "Descriptor files to lint. Defaults to descriptors in the configured outDir.",
    defaultValue: [],
  })
  .setAction(() => import("./tasks/lint.js"))
  .build();

const plugin: HardhatPlugin = {
  id: "hardhat-descriptor",
  tasks: [descriptorTask, generateTask, lintTask],
  hookHandlers: {
    config: async () => import("./hooks/config.js"),
  },
  npmPackage: "hardhat-descriptor",
};

export default plugin;
