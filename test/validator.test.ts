import { describe, expect, it } from "vitest";
import { lintDescriptor } from "../src/validator/lint.js";
import { validDescriptor } from "./fixtures/abi.js";

describe("validator", () => {
  it("accepts a well-formed descriptor", () => {
    const result = lintDescriptor(validDescriptor);
    expect(result.ok, result.errors).toBe(true);
  });

  it("rejects a descriptor missing display.formats", () => {
    const broken = JSON.parse(JSON.stringify(validDescriptor));
    delete broken.display.formats;
    const result = lintDescriptor(broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toMatch(/formats/);
  });

  it("rejects a descriptor with wrong $schema type", () => {
    const broken = JSON.parse(JSON.stringify(validDescriptor));
    broken.context = 42;
    const result = lintDescriptor(broken);
    expect(result.ok).toBe(false);
  });
});
