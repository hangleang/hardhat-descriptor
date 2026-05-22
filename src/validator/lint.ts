import { readFileSync } from "node:fs";
import { loadValidator, formatErrors } from "./schema.js";

export interface LintResult {
  file: string;
  ok: boolean;
  errors: string;
}

export function lintFile(file: string): LintResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return {
      file,
      ok: false,
      errors: `  unable to parse JSON: ${(err as Error).message}`,
    };
  }
  const validator = loadValidator();
  const ok = validator(parsed) as boolean;
  return {
    file,
    ok,
    errors: ok ? "" : formatErrors(validator.errors),
  };
}

export function lintDescriptor(descriptor: unknown): { ok: boolean; errors: string } {
  const validator = loadValidator();
  const ok = validator(descriptor) as boolean;
  return { ok, errors: ok ? "" : formatErrors(validator.errors) };
}
