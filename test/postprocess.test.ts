import { describe, expect, it } from "vitest";
import { postprocess } from "../src/generator/postprocess.js";
import { resolveConfig } from "../src/config.js";
import { erc20Abi } from "./fixtures/abi.js";
import type { ContractArtifact } from "../src/generator/artifacts.js";

const artifact: ContractArtifact = {
  name: "MyToken",
  sourceName: "contracts/MyToken.sol",
  abi: erc20Abi,
  devdoc: {},
  userdoc: {},
  source: "// fake",
};

describe("postprocess", () => {
  it("forces $schema, owner, and the deployment entry", () => {
    const cfg = resolveConfig({ owner: "Acme", url: "https://acme.example" });
    const { descriptor, warnings } = postprocess({
      raw: {
        context: { contract: {} },
        metadata: { owner: "LLM Said So" },
        display: { formats: {} },
      },
      artifact,
      config: cfg,
      address: "0x1111111111111111111111111111111111111111",
      chainId: 1,
    });
    const meta = descriptor!.metadata as Record<string, any>;
    const ctx = descriptor!.context as Record<string, any>;
    expect(descriptor!["$schema"]).toMatch(/erc7730-v2\.schema\.json$/);
    expect(meta.owner).toBe("Acme");
    expect(meta.info.url).toBe("https://acme.example");
    expect(ctx.contract.deployments).toEqual([
      { chainId: 1, address: "0x1111111111111111111111111111111111111111" },
    ]);
    expect(ctx.contract.abi).toBe(erc20Abi);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("No display.formats entry for")]),
    );
  });

  it("injects a $.value field for payable functions missing one", () => {
    const payableArtifact: ContractArtifact = {
      name: "Vault",
      sourceName: "contracts/Vault.sol",
      abi: [
        {
          type: "function",
          name: "deposit",
          stateMutability: "payable",
          inputs: [],
          outputs: [],
        },
        {
          type: "function",
          name: "ping",
          stateMutability: "nonpayable",
          inputs: [],
          outputs: [],
        },
      ],
      devdoc: {},
      userdoc: {},
      source: "// fake",
    };
    const cfg = resolveConfig({ owner: "Acme" });
    const { descriptor, warnings } = postprocess({
      raw: {
        display: {
          formats: {
            "deposit()": { intent: "Deposit", fields: [] },
            "ping()": { intent: "Ping", fields: [] },
          },
        },
      },
      artifact: payableArtifact,
      config: cfg,
      address: undefined,
      chainId: 1,
    });
    const formats = (descriptor!.display as any).formats;
    expect(formats["deposit()"].fields).toEqual([
      { path: "$.value", label: "Amount", format: "amount" },
    ]);
    expect(formats["ping()"].fields).toEqual([]);
    expect(warnings.some((w) => w.includes("Injected $.value"))).toBe(true);
  });

  it("does not duplicate $.value when the LLM already supplied one", () => {
    const payableArtifact: ContractArtifact = {
      name: "Vault",
      sourceName: "contracts/Vault.sol",
      abi: [
        {
          type: "function",
          name: "deposit",
          stateMutability: "payable",
          inputs: [],
          outputs: [],
        },
      ],
      devdoc: {},
      userdoc: {},
      source: "// fake",
    };
    const cfg = resolveConfig({ owner: "Acme" });
    const { descriptor } = postprocess({
      raw: {
        display: {
          formats: {
            "deposit()": {
              intent: "Deposit ETH into your vault",
              fields: [
                { path: "$.value", label: "Deposit Amount", format: "amount" },
              ],
            },
          },
        },
      },
      artifact: payableArtifact,
      config: cfg,
      address: undefined,
      chainId: 1,
    });
    const formats = (descriptor!.display as any).formats;
    expect(formats["deposit()"].fields).toHaveLength(1);
    expect(formats["deposit()"].fields[0].label).toBe("Deposit Amount");
  });

  it("drops unknown signatures and warns", () => {
    const cfg = resolveConfig({ owner: "Acme" });
    const { descriptor, warnings } = postprocess({
      raw: {
        display: {
          formats: {
            "transfer(address recipient, uint256 amount)": { intent: "x", fields: [] },
            "totallyMadeUp()": { intent: "y", fields: [] },
          },
        },
      },
      artifact,
      config: cfg,
      address: "0x1111111111111111111111111111111111111111",
      chainId: 1,
    });
    const formats = (descriptor!.display as any).formats;
    expect(Object.keys(formats)).toEqual(["transfer(address recipient, uint256 amount)"]);
    expect(warnings.some((w) => w.includes("totallyMadeUp"))).toBe(true);
  });

  describe("eip712", () => {
    it("overwrites metadata, domain, and deployments", () => {
      const cfg = resolveConfig({ owner: "Acme", url: "https://acme.example" });
      const { descriptor } = postprocess({
        raw: {
          context: {
            eip712: {
              domain: { name: "Vault", version: "1" },
            },
          },
          metadata: { owner: "LLM Said So" },
          display: {
            formats: {
              "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)": {
                intent: "Grant approval",
                fields: [],
              },
            },
          },
        },
        artifact,
        config: cfg,
        address: "0x2222222222222222222222222222222222222222",
        chainId: 1,
        kind: "eip712",
      });
      expect(descriptor).not.toBeNull();
      const ctx = descriptor!.context as Record<string, any>;
      const meta = descriptor!.metadata as Record<string, any>;
      expect(ctx.contract).toBeUndefined();
      expect(ctx.eip712.domain.name).toBe("Vault");
      expect(ctx.eip712.domain.chainId).toBe(1);
      expect(ctx.eip712.domain.verifyingContract).toBe(
        "0x2222222222222222222222222222222222222222",
      );
      expect(ctx.eip712.deployments).toEqual([
        { chainId: 1, address: "0x2222222222222222222222222222222222222222" },
      ]);
      expect(meta.owner).toBe("Acme");
      expect(meta.info.url).toBe("https://acme.example");
    });

    it("drops format keys that aren't EIP-712 encodeType strings", () => {
      const cfg = resolveConfig({ owner: "Acme" });
      const { descriptor, warnings } = postprocess({
        raw: {
          display: {
            formats: {
              "Permit(address owner,uint256 value)": { intent: "ok", fields: [] },
              "transfer(address,uint256)": { intent: "bad", fields: [] },
            },
          },
        },
        artifact,
        config: cfg,
        address: undefined,
        chainId: 1,
        kind: "eip712",
      });
      expect(descriptor).not.toBeNull();
      const formats = (descriptor!.display as any).formats;
      expect(Object.keys(formats)).toEqual(["Permit(address owner,uint256 value)"]);
      expect(
        warnings.some((w) => w.includes("transfer(address,uint256)")),
      ).toBe(true);
    });

    it("returns null when no EIP-712 typed-data structs are present", () => {
      const cfg = resolveConfig({ owner: "Acme" });
      const { descriptor, warnings } = postprocess({
        raw: {
          display: { formats: {} },
        },
        artifact,
        config: cfg,
        address: undefined,
        chainId: 1,
        kind: "eip712",
      });
      expect(descriptor).toBeNull();
      expect(warnings.some((w) => w.includes("no EIP-712"))).toBe(true);
    });
  });
});
