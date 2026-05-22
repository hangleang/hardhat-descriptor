import type { AbiItem } from "../../src/util/selectors.js";

export const erc20Abi: AbiItem[] = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

export const validDescriptor = {
  $schema: "https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json",
  context: {
    $id: "MyToken",
    contract: {
      abi: erc20Abi,
      deployments: [{ chainId: 1, address: "0x0000000000000000000000000000000000000000" }],
    },
  },
  metadata: {
    owner: "Acme",
    info: { url: "https://acme.example" },
  },
  display: {
    formats: {
      "transfer(address recipient, uint256 amount)": {
        intent: "Transfer tokens",
        fields: [
          {
            path: "recipient",
            label: "Recipient",
            format: "addressName",
            params: { types: ["wallet", "eoa", "contract"] },
          },
          { path: "amount", label: "Amount", format: "tokenAmount" },
        ],
      },
      "approve(address spender, uint256 amount)": {
        intent: "Approve spender",
        fields: [
          {
            path: "spender",
            label: "Spender",
            format: "addressName",
            params: { types: ["wallet", "contract"] },
          },
          { path: "amount", label: "Allowance", format: "tokenAmount" },
        ],
      },
    },
  },
};
