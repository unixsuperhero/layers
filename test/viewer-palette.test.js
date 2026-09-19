import { test } from "node:test";
import assert from "node:assert/strict";
import { assignPalette } from "../src/viewer/palette.js";

test("assigns colours by sorted layer id order", () => {
  const colours = assignPalette(["vars.locals", "defs.methods", "exec.path"]);
  assert.equal(Object.keys(colours).length, 3);
  // sorted: defs.methods, exec.path, vars.locals
  assert.equal(colours["defs.methods"], colours["defs.methods"]);
  const sorted = ["defs.methods", "exec.path", "vars.locals"];
  const distinct = new Set(sorted.map((id) => colours[id]));
  assert.equal(distinct.size, 3);
});

test("is deterministic and order-independent on input", () => {
  const a = assignPalette(["b.b", "a.a", "c.c"]);
  const b = assignPalette(["c.c", "a.a", "b.b"]);
  assert.deepEqual(a, b);
});

test("wraps around the palette for many layers", () => {
  const ids = Array.from({ length: 15 }, (_, i) => `ns.layer${i}`);
  const colours = assignPalette(ids);
  assert.equal(Object.keys(colours).length, 15);
  const first = ids.slice().sort()[0];
  const wrapped = ids.slice().sort()[12];
  assert.equal(colours[first], colours[wrapped]);
});
