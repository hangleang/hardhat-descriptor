# Adding a new LLM provider

`hardhat-descriptor` ships with three providers: Anthropic (`anthropic`), Google Gemini (`gemini`), and a generic OpenAI-compatible client (`openai-compatible`). The `openai-compatible` provider already covers most hosted endpoints (OpenAI, Groq, OpenRouter, Together, Ollama, vLLM, …) via `baseUrl`, so a first-class provider is only worth adding when the upstream API doesn't speak the OpenAI chat-completions protocol or needs provider-specific features (Anthropic's `system` field, Gemini's safety settings, native JSON mode, etc.).

This document walks through the full integration.

## Overview

The generator flow is:

```
tasks/generate.ts
  → factory.createLLMClient(cfg)        // picks provider
    → createXxxClient({ apiKey, model }) // your new client
      → makeJsonClient(callOnce)         // shared JSON loop + retry
```

Each provider only has to implement a `CallOnce` function:

```ts
type CallOnce = (system: string, user: string) => Promise<string>;
```

`makeJsonClient` handles prompt construction, fence stripping, and one retry on invalid JSON. You do **not** parse JSON or build prompts yourself.

## Checklist

1. Add the provider name to the `LLMProvider` union.
2. Add a default model for it.
3. Write the client module under `src/generator/`.
4. Wire it into the factory.
5. Document the new option in `README.md`.
6. Add a unit test covering the new client.

## Step 1 — Extend the config union

In [`src/config.ts`](../src/config.ts):

```ts
export type LLMProvider =
  | "anthropic"
  | "gemini"
  | "openai-compatible"
  | "mistral"; // new
```

Add a default model:

```ts
export const DEFAULT_MODEL_BY_PROVIDER: Record<LLMProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  "openai-compatible": "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
};
```

If your provider needs a new top-level option (e.g. a project ID, a region), add it to both `DescriptorUserConfig` and `DescriptorConfig` and pass it through `resolveConfig`. Prefer reusing `baseUrl` and `apiKey` when you can — every new field is a new surface to document and validate.

## Step 2 — Implement the client

Create `src/generator/mistral.ts`:

```ts
import { makeJsonClient } from "./jsonLoop.js";
import type { LLMClient } from "./factory.js";

export interface MistralOptions {
  apiKey: string;
  model: string;
}

export function createMistralClient(opts: MistralOptions): LLMClient {
  return makeJsonClient(async (system, user) => {
    const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      throw new Error(`mistral: ${resp.status} ${await resp.text()}`);
    }
    const json = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices[0]?.message.content ?? "";
  });
}
```

Guidelines:

- **Return raw text**, not parsed JSON. `makeJsonClient` parses, strips fences, and retries.
- **Throw on non-2xx** with the status and body so users can debug auth and quota errors.
- **Use native JSON mode** if the provider offers it (`response_format`, `responseMimeType`, tool-call return, etc.). It dramatically reduces the retry rate. Look at [`gemini.ts`](../src/generator/gemini.ts) for an example.
- **Don't add a new dependency** unless the provider has no plain-HTTP API. Most do.
- **Set `max_tokens` / `max_output_tokens` generously.** ERC-7730 descriptors can be 4–6k tokens; the existing clients use 8000.
- Keep the file roughly the shape of [`claude.ts`](../src/generator/claude.ts) — one `createXxxClient` export, one options interface.

## Step 3 — Wire it into the factory

In [`src/generator/factory.ts`](../src/generator/factory.ts):

```ts
import { createMistralClient } from "./mistral.js";

// in createLLMClient:
case "mistral":
  return createMistralClient({ apiKey: cfg.apiKey, model: cfg.model });
```

TypeScript's exhaustive `switch` will fail to compile if you forget a case — that's the signal you're done with the wiring.

## Step 4 — Document the provider

Add a snippet to the **Provider examples** section of `README.md`:

```ts
// Mistral
descriptor: { provider: "mistral", model: "mistral-large-latest" }
```

If the provider has a notable free tier, mention it (the existing entries do).

## Step 5 — Test the client

Create `test/mistral.test.ts`. Mock `fetch` (or the SDK) — tests must not make real network calls and must not require an API key.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMistralClient } from "../src/generator/mistral.js";

describe("mistral client", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"context":{}}' } }],
      }),
    }) as any;
  });

  it("parses JSON responses", async () => {
    const client = createMistralClient({ apiKey: "k", model: "m" });
    const out = await client.generate({ name: "X", abi: [] } as any);
    expect(out).toEqual({ context: {} });
  });

  it("retries on invalid JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "not json" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
      });
    global.fetch = fetchMock as any;
    const client = createMistralClient({ apiKey: "k", model: "m" });
    await client.generate({ name: "X", abi: [] } as any);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

At minimum, cover: happy path, retry on malformed JSON, error on non-2xx.

## Common pitfalls

- **Streaming.** The generator expects a single complete string. If your SDK only supports streaming, accumulate the chunks before returning.
- **System prompt placement.** Some providers fold `system` into the first user message instead of a dedicated field — see how [`claude.ts`](../src/generator/claude.ts) and [`openaiCompatible.ts`](../src/generator/openaiCompatible.ts) differ. Don't drop the system prompt; it carries the ERC-7730 schema guidance.
- **Token limits.** A truncated response will fail `JSON.parse` and burn a retry. Set output limits to at least 8k.
- **Rate limits.** Don't add retry-with-backoff in the client; one JSON-validity retry is intentional. Surfacing rate-limit errors clearly is more useful than silently retrying.
- **Caching.** You don't need to touch the fingerprint cache — it lives above the client in `tasks/generate.ts` and is keyed on the artifact, not the provider response.

## When to extend `openai-compatible` instead

If your provider speaks the OpenAI chat-completions protocol, prefer telling users to set:

```ts
descriptor: {
  provider: "openai-compatible",
  baseUrl: "https://api.your-provider.com/v1",
  model: "...",
}
```

A new first-class provider is only justified when the upstream API is non-OpenAI-shaped, or when provider-specific features (native JSON mode, large context windows, distinct auth) materially improve descriptor quality.
