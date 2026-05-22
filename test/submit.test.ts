import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSubmit } from "../src/tasks/submit.js";

function fakeHre(outDir: string, owner: string | undefined = "Acme") {
  return {
    config: {
      descriptor: {
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        owner,
        outDir,
      },
    },
  } as any;
}

describe("runSubmit", () => {
  it("submits descriptors discovered in outDir", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "submit-"));
    writeFileSync(path.join(dir, "calldata-MyToken.json"), "{}");
    writeFileSync(path.join(dir, "eip712-MyToken.json"), "{}");
    writeFileSync(path.join(dir, "ignored.txt"), "");

    const submit = vi
      .fn()
      .mockResolvedValue({ prUrl: "https://github.com/x/y/pull/1", branch: "b", entity: "acme", updated: false });
    const pr = await runSubmit({}, fakeHre(dir), { submit });

    expect(submit).toHaveBeenCalledTimes(1);
    const arg = submit.mock.calls[0][0];
    expect(arg.owner).toBe("Acme");
    expect(arg.written).toHaveLength(2);
    expect(arg.written.some((p: string) => p.endsWith("calldata-MyToken.json"))).toBe(true);
    expect(arg.written.some((p: string) => p.endsWith("eip712-MyToken.json"))).toBe(true);
    expect(pr.prUrl).toMatch(/pull\/1$/);
  });

  it("uses explicit file args when provided", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "submit-"));
    const file = path.join(dir, "calldata-MyToken.json");
    writeFileSync(file, "{}");
    const other = path.join(dir, "eip712-MyToken.json");
    writeFileSync(other, "{}");

    const submit = vi
      .fn()
      .mockResolvedValue({ prUrl: "u", branch: "b", entity: "acme", updated: false });
    await runSubmit({ files: [file] }, fakeHre(dir), { submit });
    expect(submit.mock.calls[0][0].written).toEqual([file]);
  });

  it("throws when owner is missing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "submit-"));
    writeFileSync(path.join(dir, "calldata-MyToken.json"), "{}");
    const hre = fakeHre(dir);
    delete hre.config.descriptor.owner;
    await expect(runSubmit({}, hre, { submit: vi.fn() })).rejects.toThrow(
      /descriptor\.owner/,
    );
  });

  it("throws when no descriptors exist", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "submit-"));
    await expect(runSubmit({}, fakeHre(dir), { submit: vi.fn() })).rejects.toThrow(
      /no descriptors found/,
    );
  });

  it("passes registry override through", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "submit-"));
    writeFileSync(path.join(dir, "calldata-MyToken.json"), "{}");
    const submit = vi.fn().mockResolvedValue({ prUrl: "u", branch: "b", entity: "acme", updated: false });
    await runSubmit({ registry: "foo/bar" }, fakeHre(dir), { submit });
    expect(submit.mock.calls[0][0].registryRepo).toBe("foo/bar");
  });

  it("threads --yes through to the submitter", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "submit-"));
    writeFileSync(path.join(dir, "calldata-MyToken.json"), "{}");
    const submit = vi.fn().mockResolvedValue({ prUrl: "u", branch: "b", entity: "acme", updated: false });
    await runSubmit({ yes: true }, fakeHre(dir), { submit });
    expect(submit.mock.calls[0][0].assumeYes).toBe(true);

    const submit2 = vi.fn().mockResolvedValue({ prUrl: "u", branch: "b", entity: "acme", updated: false });
    await runSubmit({}, fakeHre(dir), { submit: submit2 });
    expect(submit2.mock.calls[0][0].assumeYes).toBe(false);
  });
});
