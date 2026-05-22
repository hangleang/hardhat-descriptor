# Contributing to hardhat-descriptor

Thanks for your interest in improving `hardhat-descriptor`. This document covers how to set up the project, the workflow we expect for changes, and how to get your pull request merged.

## Getting started

### Prerequisites

- Node.js 20+
- npm 10+
- An API key for at least one supported LLM provider (Anthropic, Gemini, or any OpenAI-compatible endpoint) if you plan to run the `generate` task end-to-end.

### Setup

```bash
git clone https://github.com/hangleang/hardhat-descriptor.git
cd hardhat-descriptor
npm install
npm run build
npm test
```

The `example/` directory contains a working Hardhat 3 project that uses the local build of the plugin. It is the fastest way to validate changes against a real contract.

## Project layout

```
src/
  config.ts          Plugin config schema and defaults
  index.ts           Plugin entry point
  hooks/             Hardhat lifecycle hooks
  tasks/             `descriptor generate` and `descriptor lint`
  generator/         LLM client abstractions and prompt construction
  validator/         ERC-7730 schema + ABI cross-checks
  util/              Shared helpers (fingerprinting, paths, ignition lookup)
scripts/
  fetch-schema.ts    Refreshes the cached ERC-7730 v2 JSON Schema
schema/              Cached ERC-7730 JSON Schema
test/                Vitest unit + fixture tests
example/             Sample Hardhat project for manual testing
```

## Development workflow

1. **Open an issue first** for non-trivial changes (new providers, schema changes, breaking config). For small fixes and docs, a PR is fine.
2. **Branch from `main`** with a descriptive name (`fix/lint-selector-mismatch`, `feat/openrouter-provider`).
3. **Keep changes focused.** One concern per PR. Refactors should be separate from behavior changes.
4. **Add or update tests** for any code change. Bug fixes need a regression test that fails without the fix.
5. **Update `README.md`** if you change public configuration, task flags, or supported providers.

For adding a new LLM provider, follow [docs/adding-a-provider.md](docs/adding-a-provider.md).

## Running locally

```bash
npm run build           # Compile TypeScript to dist/
npm test                # Run the vitest suite once
npm run test:watch      # Watch mode while iterating
npm run fetch-schema    # Refresh the cached ERC-7730 schema
```

To exercise the plugin against the example project:

```bash
npm run build
cd example
npx hardhat compile
npx hardhat descriptor generate --dry-run
```

## Coding guidelines

- TypeScript strict mode. No `any` without a comment explaining why.
- Prefer pure functions in `util/` and `validator/`; keep I/O in `tasks/` and `hooks/`.
- Don't add new runtime dependencies without discussing it in the issue first.
- Match the existing import style (ESM, `.js` extensions on relative imports).
- Error messages should tell the user what to do, not just what failed.

## Testing

- Unit tests live next to fixtures under `test/`.
- Network calls and LLM responses must be mocked. Tests must not require an API key.
- Run `npm test` before opening a PR. CI runs the same command.

## Commit and PR style

- Write commit messages in the imperative mood (`add gemini retry`, not `added gemini retry`).
- Squash trivial fixup commits before review.
- In the PR description, explain *why* the change is needed and link any related issue.
- Note any user-visible changes to config, tasks, or output format.

## Reporting bugs

Open an issue with:

- Plugin version and Hardhat version.
- Provider and model in use.
- Minimal config and contract that reproduces the problem.
- The full error message or generated descriptor (redact any keys).

## License

By contributing, you agree that your contributions are licensed under the project's [GPL-3.0 license](LICENSE).
