import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

// ajv-formats publishes a CJS default; under NodeNext ESM the callable
// function lives on `.default` at runtime but TS sees the module namespace.
const addFormats = (addFormatsModule as unknown as {
  default: (ajv: Ajv) => Ajv;
}).default;

const here = path.dirname(fileURLToPath(import.meta.url));

function findSchema(): string {
  // Walk up from this file looking for `schema/erc7730-v2.schema.json` so
  // the same code works when imported from `src/` (tests) or `dist/src/`.
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "schema", "erc7730-v2.schema.json");
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // continue
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `hardhat-descriptor: could not locate erc7730-v2.schema.json near ${here}. Run \`npm run fetch-schema\`.`,
  );
}

const SCHEMA_PATH = findSchema();

let cached: ValidateFunction | null = null;

export function loadValidator(): ValidateFunction {
  if (cached) return cached;
  const schemaText = readFileSync(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
  addFormats(ajv);
  // The ERC-7730 schema references Ethereum-specific formats ("eip55", "eip155")
  // that Ajv doesn't know natively — register lax matchers so they don't fail.
  // Accept any 0x-prefixed 40-char hex string. The registry CI enforces strict
  // EIP-55 checksumming, but local generation often produces lowercase forms.
  ajv.addFormat("eip55", /^0x[0-9a-fA-F]{40}$/);
  ajv.addFormat("eip155", { type: "number", validate: (n: number) => Number.isInteger(n) && n > 0 });
  cached = ajv.compile(schema);
  return cached!;
}

export function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "";
  return errors
    .map((e) => `  ${e.instancePath || "/"} ${e.message ?? "is invalid"}`)
    .join("\n");
}
