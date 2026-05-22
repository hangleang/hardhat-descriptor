import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGenerate } from "../src/tasks/generate.js";
import { runLint } from "../src/tasks/lint.js";
import type { AbiItem } from "../src/util/selectors.js";

const vaultAbi: AbiItem[] = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

const vaultSource = readFileSync(
  path.join(__dirname, "../example/contracts/Vault.sol"),
  "utf8",
);

function vaultHre(outDir: string) {
  return {
    config: {
      descriptor: {
        apiKey: "sk-test",
        owner: "Vault Inc.",
        url: "https://vault.example",
        outDir,
      },
    },
    artifacts: {
      getAllFullyQualifiedNames: async () => ["contracts/Vault.sol:Vault"],
      readArtifact: async () => ({
        contractName: "Vault",
        sourceName: "contracts/Vault.sol",
        abi: vaultAbi,
      }),
      getBuildInfo: async () => ({
        input: {
          sources: { "contracts/Vault.sol": { content: vaultSource } },
        },
        output: {
          contracts: {
            "contracts/Vault.sol": {
              Vault: {
                abi: vaultAbi,
                devdoc: {
                  methods: {
                    "withdraw(address,uint256)": {
                      params: {
                        to: "Recipient of the withdrawn ETH.",
                        amount: "Amount of wei to withdraw.",
                      },
                    },
                  },
                },
                userdoc: {
                  methods: {
                    "deposit()": { notice: "Deposit ETH and credit the sender." },
                    "withdraw(address,uint256)": {
                      notice: "Withdraw amount wei from the sender's balance to to.",
                    },
                  },
                },
              },
            },
          },
        },
      }),
    },
  } as any;
}

/**
 * Simulates a Claude response for the Vault contract. Returns the exact shape
 * the real model is instructed to emit (parameterised signatures, allowed
 * format types, no $schema — postprocess injects it).
 */
const mockedVaultDescriptor = {
  context: {
    $id: "Vault",
    contract: {},
  },
  metadata: {
    owner: "Will be overwritten",
    info: { url: "https://will-be-overwritten" },
  },
  display: {
    formats: {
      "deposit()": {
        intent: "Deposit ETH into the vault",
        fields: [],
      },
      "withdraw(address to, uint256 amount)": {
        intent: "Withdraw ETH from the vault",
        fields: [
          {
            path: "to",
            label: "Recipient",
            format: "addressName",
            params: { types: ["wallet", "eoa", "contract"] },
          },
          {
            path: "amount",
            label: "Amount",
            format: "amount",
          },
        ],
      },
    },
  },
};

describe("Vault deposit/withdraw end-to-end", () => {
  it("generates a schema-valid descriptor and passes lint", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "descriptor-vault-"));
    const hre = vaultHre(dir);
    const generate = vi.fn().mockResolvedValue(mockedVaultDescriptor);

    const result = await runGenerate(
      {
        contract: "Vault",
        address: "0x1111111111111111111111111111111111111111",
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
    expect(written.$schema).toMatch(/erc7730-v2\.schema\.json$/);
    expect(written.context.contract.deployments).toEqual([
      { chainId: 1, address: "0x1111111111111111111111111111111111111111" },
    ]);
    expect(written.metadata.owner).toBe("Vault Inc.");
    expect(written.metadata.info.url).toBe("https://vault.example");
    expect(Object.keys(written.display.formats).sort()).toEqual([
      "deposit()",
      "withdraw(address to, uint256 amount)",
    ]);
    const withdraw = written.display.formats["withdraw(address to, uint256 amount)"];
    expect(withdraw.fields[0].format).toBe("addressName");
    expect(withdraw.fields[1].format).toBe("amount");

    // And lint passes when run as a separate task over the same outDir.
    const failed = await runLint({}, hre);
    expect(failed).toBe(0);
  });

  it("rejects a Claude response with an invented function", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "descriptor-vault-"));
    const hre = vaultHre(dir);
    const halfBogus = {
      ...mockedVaultDescriptor,
      display: {
        formats: {
          ...mockedVaultDescriptor.display.formats,
          "rugPull(uint256 amount)": { intent: "x", fields: [] },
        },
      },
    };
    const generate = vi.fn().mockResolvedValue(halfBogus);

    const result = await runGenerate(
      {
        contract: "Vault",
        address: "0x1111111111111111111111111111111111111111",
        chainId: "1",
        type: "calldata",
      },
      hre,
      { makeClient: () => ({ generate }) },
    );

    const written = JSON.parse(readFileSync(result.written[0], "utf8"));
    // postprocess strips signatures that aren't in the ABI.
    expect(Object.keys(written.display.formats)).not.toContain(
      "rugPull(uint256 amount)",
    );
    expect(Object.keys(written.display.formats).sort()).toEqual([
      "deposit()",
      "withdraw(address to, uint256 amount)",
    ]);
  });
});
