import { describe, expect, it } from "vitest";
import { createBaselineClient } from "../src/generator/baseline.js";
import { postprocess } from "../src/generator/postprocess.js";
import { lintDescriptor } from "../src/validator/lint.js";
import { erc20Abi } from "./fixtures/abi.js";
import type { DescriptorConfig } from "../src/config.js";
import type { ContractArtifact } from "../src/generator/artifacts.js";

const cfg: DescriptorConfig = {
  provider: "none",
  apiKey: undefined,
  baseUrl: undefined,
  model: "",
  outDir: "descriptors",
  owner: "Acme",
  url: "https://acme.example",
  contracts: undefined,
};

const artifact: ContractArtifact = {
  name: "MyToken",
  sourceName: "contracts/MyToken.sol",
  abi: erc20Abi,
  devdoc: undefined,
  userdoc: undefined,
  source: undefined,
};

describe("createBaselineClient", () => {
  it("emits a schema-valid calldata descriptor with one format per external non-view function", async () => {
    const client = createBaselineClient();
    const raw = await client.generate(artifact, "calldata");

    const { descriptor, warnings } = postprocess({
      raw,
      artifact,
      config: cfg,
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      chainId: 1,
      kind: "calldata",
    });

    expect(descriptor).not.toBeNull();
    expect(warnings.find((w) => w.includes("omitted"))).toBeUndefined();

    const formats = (descriptor as any).display.formats;
    expect(Object.keys(formats).sort()).toEqual([
      "approve(address spender, uint256 amount)",
      "transfer(address recipient, uint256 amount)",
    ]);

    const transfer = formats["transfer(address recipient, uint256 amount)"];
    expect(transfer.intent).toBe("Transfer");
    expect(transfer.fields[0]).toMatchObject({
      path: "recipient",
      label: "Recipient",
      format: "addressName",
    });
    expect(transfer.fields[1]).toMatchObject({
      path: "amount",
      label: "Amount",
      format: "raw",
    });

    const result = lintDescriptor(descriptor);
    expect(result.ok, result.errors).toBe(true);
  });

  it("returns empty formats for eip712 so postprocess skips with a warning", async () => {
    const client = createBaselineClient();
    const raw = await client.generate(artifact, "eip712");

    const { descriptor, warnings } = postprocess({
      raw,
      artifact,
      config: cfg,
      address: undefined,
      chainId: 1,
      kind: "eip712",
    });

    expect(descriptor).toBeNull();
    expect(warnings.some((w) => w.includes("no EIP-712 typed-data structs"))).toBe(true);
  });
});
