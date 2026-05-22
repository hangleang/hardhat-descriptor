import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_URL =
  "https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json";
const FALLBACK_URL =
  "https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/master/specs/erc7730-v2.schema.json";

async function main(): Promise<void> {
  const outDir = path.resolve(process.cwd(), "schema");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "erc7730-v2.schema.json");

  for (const url of [SCHEMA_URL, FALLBACK_URL]) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`fetch ${url} → ${resp.status}`);
        continue;
      }
      const text = await resp.text();
      JSON.parse(text); // validate JSON
      writeFileSync(outFile, text);
      console.log(`wrote ${outFile} from ${url}`);
      return;
    } catch (err) {
      console.warn(`fetch ${url} failed: ${(err as Error).message}`);
    }
  }
  throw new Error("could not retrieve ERC-7730 v2 schema from any source");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
