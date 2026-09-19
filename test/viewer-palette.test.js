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

test("many layers sharing one namespace still get pairwise-distinct colours", () => {
  const ids = Array.from({ length: 15 }, (_, i) => `ns.layer${i}`);
  const colours = assignPalette(ids);
  assert.equal(Object.keys(colours).length, 15);
  const distinct = new Set(Object.values(colours));
  assert.equal(distinct.size, 15);
});

test("namespace-aware: the ~17 real layer ids (defs/vars/refs/exec/effects) are all pairwise distinct", () => {
  const ids = [
    "defs.attributes", "defs.classes", "defs.methods", "defs.constants",
    "vars.locals", "vars.ivars", "vars.temps",
    "refs.calls", "refs.constants",
    "exec.path",
    "effects.state", "effects.global", "effects.args", "effects.io", "effects.control", "effects.calls", "effects.unknown",
  ];
  const colours = assignPalette(ids);
  const distinct = new Set(Object.values(colours));
  assert.equal(distinct.size, ids.length);
});

test("layers in different namespaces don't share a colour even when few in each", () => {
  const colours = assignPalette(["defs.classes", "vars.locals", "refs.calls", "exec.path", "effects.io"]);
  assert.equal(new Set(Object.values(colours)).size, 5);
});
