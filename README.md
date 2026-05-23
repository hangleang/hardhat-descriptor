# hardhat-descriptor

A Hardhat 3 plugin that generates [ERC-7730](https://eips.ethereum.org/EIPS/eip-7730) "clear-signing" descriptors for your compiled contracts. By default it produces a deterministic baseline straight from the ABI — no LLM, no API key required. Optionally, set `descriptor.provider` to an LLM (Anthropic Claude, Google Gemini, or any OpenAI-compatible endpoint) to author richer descriptors with humanised intents, sensible field formats, and EIP-712 typed-data support. The generated JSON tells wallets like Ledger, Trezor, and WalletConnect how to render your contract's calls — and EIP-712 typed-data signatures — as human-readable intents instead of opaque calldata.

The plugin auto-detects Hardhat Ignition deployments and reuses cached LLM responses, so re-running after a fresh deploy applies real addresses without an extra API call.

> **Review before publishing.** Generated descriptors — especially LLM output — may contain incorrect field labels, wrong formatter types, or hallucinated semantics. Always open each `descriptors/*.json`, verify it against your contract's actual behavior, and test it in a wallet preview before submitting to the [clear-signing registry](https://github.com/ethereum/clear-signing-erc7730-registry) or shipping it to users. The plugin is a starting point, not a substitute for human review.

## Install

```bash
npm install --save-dev hardhat-descriptor
```

Then in `hardhat.config.ts`:

```ts
import type { HardhatUserConfig } from "hardhat/config";
import descriptor from "hardhat-descriptor";

const config: HardhatUserConfig = {
  plugins: [descriptor],
  networks: {
    mainnet: { type: "http", chainType: "l1", url: "https://eth.drpc.org", chainId: 1 },
  },
  descriptor: {
    owner: "Acme Protocol",
    url: "https://acme.example",
    // provider: "anthropic", // opt in to LLM-authored descriptors; omit for the deterministic ABI-only baseline
  },
};

export default config;
```

If you opt in to an LLM provider, set your API key:

```bash
export LLM_PROVIDER_API_KEY=sk-ant-...
```

## Tasks

### `descriptor generate`

Reads compiled artifacts, authors ERC-7730 v2 descriptors, validates them against the official schema, and writes `descriptors/calldata-<Contract>.json` and/or `descriptors/eip712-<Contract>.json`.

By default (with no `provider` configured, or `provider: "none"`), descriptors are produced deterministically from the ABI — no LLM, no API key. Each external non-view function gets one `raw` field per argument (`address` arguments use `addressName`) with humanised intents. EIP-712 is skipped in this mode since parsing typed-data structs from source requires an LLM. Set `descriptor.provider` in `hardhat.config.ts` (and provide an API key) to opt in to richer LLM-authored output and EIP-712 support.

```bash
npx hardhat compile
npx hardhat descriptor generate
```

Flags (all optional):

- `--contract`  Contract name to generate for (defaults to every compiled contract).
- `--address`   Deployed address to inject. If omitted, the plugin reads the most recent `ignition/deployments/chain-<id>/` directory and uses those addresses.
- `--type`      `calldata`, `eip712`, or `both` (default `both`).
- `--dry-run`   Print to stdout instead of writing a file.
- `--force`     Bypass the fingerprint cache and regenerate from scratch.

`chainId` is read from the active Hardhat network (`--network <name>`); if no network is given the plugin falls back to the Ignition deployment's chain id, then `1`.

Re-running is cheap: the plugin caches both the LLM input fingerprint and the full output fingerprint. If nothing changed it skips. If only the deployed address changed (e.g. after `hardhat ignition deploy`), it re-applies the cached LLM response without a fresh API call.

### `descriptor lint`

Validates any descriptor file against the ERC-7730 v2 JSON Schema and cross-checks `display.formats` selectors against the on-disk ABI.

```bash
npx hardhat descriptor lint
npx hardhat descriptor lint descriptors/calldata-MyToken.json descriptors/eip712-MyToken.json
```

### `descriptor submit`

Opens a draft PR to [`ethereum/clear-signing-erc7730-registry`](https://github.com/ethereum/clear-signing-erc7730-registry) under `registry/<slug(owner)>/`. Requires the [`gh` CLI](https://cli.github.com) authenticated with a fork-capable account; cloning uses SSH. By default it submits every descriptor in `outDir`; pass paths to restrict.

```bash
npx hardhat descriptor submit
npx hardhat descriptor submit descriptors/calldata-MyToken.json
```

Before pushing or opening the PR you'll be shown the target repo, branch, and files and asked to confirm. The fork and clone steps run unattended; only the irreversible step (push + PR create/update) is gated.

Flags:

- `--registry`  Override the upstream registry slug (defaults to `ethereum/clear-signing-erc7730-registry`).
- `--yes`       Skip the confirmation prompt (use in CI; the prompt is required when stdin is a TTY).

## Configuration

```ts
descriptor: {
  provider?: "anthropic" | "gemini" | "openai-compatible" | "none"; // default "none" (deterministic ABI-only baseline; no API key required). Set to an LLM provider to opt in to richer output and EIP-712 support.
  apiKey?: string;            // falls back to LLM_PROVIDER_API_KEY
  baseUrl?: string;           // required for openai-compatible (Groq, OpenRouter, Ollama, …)
  model?: string;             // default per provider (claude-sonnet-4-6, gemini-2.5-flash, …)
  outDir?: string;            // default "descriptors"
  owner?: string;             // metadata.owner
  url?: string;               // metadata.info.url
  contracts?: string[];       // restrict generate to a subset
}
```

### Provider examples

```ts
// Anthropic Claude (default)
descriptor: { provider: "anthropic", model: "claude-sonnet-4-6" }

// Google Gemini — free tier at aistudio.google.com
descriptor: { provider: "gemini", model: "gemini-2.5-flash" }

// Groq — free tier at console.groq.com
descriptor: {
  provider: "openai-compatible",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "llama-3.3-70b-versatile",
}

// Local Ollama — no key needed, set apiKey to "ollama"
descriptor: {
  provider: "openai-compatible",
  baseUrl: "http://localhost:11434/v1",
  apiKey: "ollama",
  model: "qwen2.5-coder:14b",
}
```
