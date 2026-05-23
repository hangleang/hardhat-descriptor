import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGenerate } from "../src/tasks/generate.js";
import { slugifyEntity } from "../src/util/submit.js";
import { erc20Abi, validDescriptor } from "./fixtures/abi.js";

function fakeHre(outDir: string) {
  return {
    config: {
      descriptor: {
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        owner: "Acme",
        url: "https://acme.example",
        outDir,
      },
    },
    artifacts: {
      getAllFullyQualifiedNames: async () => ["contracts/MyToken.sol:MyToken"],
      readArtifact: async () => ({
        contractName: "MyToken",
        sourceName: "contracts/MyToken.sol",
        abi: erc20Abi,
      }),
      getBuildInfo: async () => ({
        input: { sources: { "contracts/MyToken.sol": { content: "// pretend solidity" } } },
        output: {
          contracts: {
            "contracts/MyToken.sol": {
              MyToken: { abi: erc20Abi, devdoc: {}, userdoc: {} },
            },
          },
        },
      }),
    },
  } as any;
}

describe("runGenerate", () => {
  it("writes a schema-valid descriptor using a mocked Claude client", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "descriptor-"));
    const hre = fakeHre(dir);
    const generate = vi.fn().mockResolvedValue(validDescriptor);

    const result = await runGenerate(
      {
        contract: "MyToken",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        chainId: "1",
        type: "calldata",
      },
      hre,
      { makeClient: () => ({ generate }) },
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.written).toHaveLength(1);
    const out = result.written[0];
    expect(existsSync(out)).toBe(true);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written.context.contract.deployments[0].address).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
    expect(written.metadata.owner).toBe("Acme");
  });

  it("writes both calldata and eip712 descriptors with --type both", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "descriptor-"));
    const hre = fakeHre(dir);
    const eip712Raw = {
      context: { eip712: { domain: { name: "MyToken", version: "1" } } },
      metadata: { owner: "x" },
      display: {
        formats: {
          "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)": {
            intent: "Approve spending",
            fields: [],
          },
        },
      },
    };
    const generate = vi
      .fn()
      .mockImplementation(async (_artifact: unknown, kind?: string) =>
        kind === "eip712" ? eip712Raw : validDescriptor,
      );

    const result = await runGenerate(
      {
        contract: "MyToken",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        chainId: "1",
        type: "both",
      },
      hre,
      { makeClient: () => ({ generate }) },
    );

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.written).toHaveLength(2);
    expect(result.written.some((p) => p.endsWith("calldata-MyToken.json"))).toBe(true);
    expect(result.written.some((p) => p.endsWith("eip712-MyToken.json"))).toBe(true);

    // Distinct fingerprints per kind: a second run regenerates nothing.
    const second = await runGenerate(
      {
        contract: "MyToken",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        chainId: "1",
        type: "both",
      },
      hre,
      { makeClient: () => ({ generate }) },
    );
    expect(second.written).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThanOrEqual(2);
  });

  it("writes a baseline calldata descriptor by default when provider is none and no apiKey", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "descriptor-"));
    const hre = fakeHre(dir);
    hre.config.descriptor.provider = "none";
    delete hre.config.descriptor.apiKey;

    const result = await runGenerate(
      {
        contract: "MyToken",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        chainId: "1",
        type: "calldata",
      },
      hre,
    );

    expect(result.written).toHaveLength(1);
    const written = JSON.parse(readFileSync(result.written[0], "utf8"));
    const formats = written.display.formats;
    expect(formats["transfer(address recipient, uint256 amount)"]).toBeDefined();
    expect(formats["approve(address spender, uint256 amount)"]).toBeDefined();
  });

  it("throws if an LLM provider is configured but no apiKey is resolved", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "descriptor-"));
    const hre = fakeHre(dir);
    delete hre.config.descriptor.apiKey;
    await expect(runGenerate({}, hre)).rejects.toThrow(/LLM_PROVIDER_API_KEY/);
  });

});

describe("slugifyEntity", () => {
  it("lowercases and dashes whitespace", () => {
    expect(slugifyEntity("Acme Protocol")).toBe("acme-protocol");
  });
  it("strips punctuation", () => {
    expect(slugifyEntity("Acme, Inc.")).toBe("acme-inc");
  });
  it("throws on empty result", () => {
    expect(() => slugifyEntity("!!!")).toThrow();
  });
});
