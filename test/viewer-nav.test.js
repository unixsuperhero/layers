import { test } from "node:test";
import assert from "node:assert/strict";
import { decideJump } from "../src/viewer/nav.js";

test("no targets: select only", () => {
  assert.deepEqual(decideJump([], null), { action: "select" });
});

test("multiple targets: select only, don't guess", () => {
  const targets = [
    { file: "a.rb", start: 0, end: 5 },
    { file: "a.rb", start: 10, end: 15 },
  ];
  assert.deepEqual(decideJump(targets, null), { action: "select" });
});

test("single target different from the clicked mark: jump", () => {
  const targets = [{ file: "a.rb", start: 0, end: 5 }];
  const clicked = { file: "b.rb", start: 20, end: 25 };
  assert.deepEqual(decideJump(targets, clicked), { action: "jump", target: targets[0] });
});

test("single target equal to the clicked mark: select only, no self-jump", () => {
  const targets = [{ file: "a.rb", start: 0, end: 5 }];
  const clicked = { file: "a.rb", start: 0, end: 5 };
  assert.deepEqual(decideJump(targets, clicked), { action: "select" });
});
