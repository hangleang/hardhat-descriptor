import { describe, expect, it } from "vitest";
import {
  functionSignature,
  functionSelector,
  listExternalFunctions,
} from "../src/util/selectors.js";
import { erc20Abi } from "./fixtures/abi.js";

describe("selectors", () => {
  it("renders canonical signatures", () => {
    const externals = listExternalFunctions(erc20Abi);
    const sigs = externals.map(functionSignature);
    expect(sigs).toEqual(["transfer(address,uint256)", "approve(address,uint256)"]);
  });

  it("computes function selectors via viem", () => {
    const transfer = listExternalFunctions(erc20Abi)[0];
    expect(functionSelector(transfer)).toBe("0xa9059cbb");
  });

  it("excludes view/pure functions", () => {
    const names = listExternalFunctions(erc20Abi).map((f) => f.name);
    expect(names).not.toContain("balanceOf");
  });
});
