import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLocals } from "../src/viewer/locals-diff.js";

test("changed value is reported", () => {
  assert.deepEqual(diffLocals({ total: "0" }, { total: "10" }), new Set(["total"]));
});

test("new name is reported", () => {
  assert.deepEqual(diffLocals({ total: "0" }, { total: "0", item: "10" }), new Set(["item"]));
});

test("unchanged names are not reported", () => {
  assert.deepEqual(diffLocals({ total: "10", item: "32" }, { total: "10", item: "32" }), new Set());
});

test("dropped names are not reported (only after's keys matter)", () => {
  assert.deepEqual(diffLocals({ total: "10", item: "32" }, { total: "10" }), new Set());
});

test("empty before: everything in after is reported as new", () => {
  assert.deepEqual(diffLocals({}, { total: "0", item: "10" }), new Set(["total", "item"]));
});
