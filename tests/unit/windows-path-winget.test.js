import test from "node:test";
import assert from "node:assert/strict";
import { WindowsAdapter } from "../../os-adapters/windows/src/windows-adapter.js";

test("windows adapter path splitting and joining is stable", () => {
  const adapter = new WindowsAdapter();
  const value = "C:\\A\\;C:\\B;C:\\A\\";
  const split = adapter.splitPath(value);
  assert.deepEqual(split, ["C:\\A", "C:\\B", "C:\\A"]);
  const joined = adapter.joinPath(["C:\\A\\", "C:\\B\\"]);
  assert.equal(joined, "C:\\A;C:\\B");
});

