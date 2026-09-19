import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markKey,
  parseMarkKey,
  itemsOfLayer,
  defaultSelection,
  isDefaultOff,
  checkState,
  setKeys,
  pruneSelection,
} from "../src/viewer/selection.js";

test("markKey / parseMarkKey round trip", () => {
  const mark = { file: "invoice.rb", start: 147, end: 154 };
  const key = markKey("defs.methods", mark);
  assert.equal(key, "defs.methods|invoice.rb|147|154");
  assert.deepEqual(parseMarkKey(key), { layer: "defs.methods", file: "invoice.rb", start: 147, end: 154 });
});

test("itemsOfLayer groups marks by symbol in first-appearance (file, start) order", () => {
  const layer = {
    id: "defs.methods",
    marks: [
      { file: "mailer.rb", start: 47, end: 53, symbol: "Mailer#notify", role: "definition" },
      { file: "invoice.rb", start: 147, end: 154, symbol: "Invoice#summary", role: "definition" },
      { file: "invoice.rb", start: 97, end: 107, symbol: "Invoice#initialize", role: "definition" },
    ],
  };
  const items = itemsOfLayer(layer);
  assert.deepEqual(
    items.map((i) => i.symbol),
    ["Invoice#initialize", "Invoice#summary", "Mailer#notify"],
  );
  assert.deepEqual(items[0].marks, ["defs.methods|invoice.rb|97|107"]);
});

test("itemsOfLayer groups multiple marks of the same symbol into one item, marks ordered by start", () => {
  const layer = {
    id: "vars.locals",
    marks: [
      { file: "invoice.rb", start: 12, end: 16, symbol: "Invoice#summary/item", role: "read" },
      { file: "invoice.rb", start: 8, end: 12, symbol: "Invoice#summary/item", role: "write" },
    ],
  };
  const items = itemsOfLayer(layer);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].marks, ["vars.locals|invoice.rb|8|12", "vars.locals|invoice.rb|12|16"]);
});

test("itemsOfLayer: marks with symbol === null are each their own item", () => {
  const layer = {
    id: "exec.path",
    marks: [
      { file: "invoice.rb", start: 0, end: 10, symbol: null, role: "executed" },
      { file: "invoice.rb", start: 10, end: 20, symbol: null, role: "executed" },
    ],
  };
  const items = itemsOfLayer(layer);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.symbol),
    [null, null],
  );
});

test("defaultSelection: static layers fully on, dynamic layers off", () => {
  const doc = {
    layers: [
      { id: "defs.methods", kind: "static", marks: [{ file: "a.rb", start: 0, end: 5 }] },
      { id: "exec.path", kind: "dynamic", marks: [{ file: "a.rb", start: 5, end: 10 }] },
    ],
  };
  const selection = defaultSelection(doc);
  assert.equal(selection.has(markKey("defs.methods", doc.layers[0].marks[0])), true);
  assert.equal(selection.has(markKey("exec.path", doc.layers[1].marks[0])), false);
});

test("defaultSelection: effects.* layers are off by default even though they're static (docs/ROUND-4.md)", () => {
  const doc = {
    layers: [
      { id: "defs.methods", kind: "static", marks: [{ file: "a.rb", start: 0, end: 5 }] },
      { id: "effects.io", kind: "static", marks: [{ file: "a.rb", start: 5, end: 10 }] },
      { id: "defs.constants", kind: "static", marks: [{ file: "a.rb", start: 10, end: 15 }] },
    ],
  };
  const selection = defaultSelection(doc);
  assert.equal(selection.has(markKey("defs.methods", doc.layers[0].marks[0])), true);
  assert.equal(selection.has(markKey("effects.io", doc.layers[1].marks[0])), false);
  assert.equal(selection.has(markKey("defs.constants", doc.layers[2].marks[0])), true);
});

test("isDefaultOff: dynamic kind or an effects.* id, data-driven (not a hardcoded id list)", () => {
  assert.equal(isDefaultOff({ id: "exec.path", kind: "dynamic" }), true);
  assert.equal(isDefaultOff({ id: "effects.io", kind: "static" }), true);
  assert.equal(isDefaultOff({ id: "effects.anything.new", kind: "static" }), true);
  assert.equal(isDefaultOff({ id: "defs.constants", kind: "static" }), false);
  assert.equal(isDefaultOff({ id: "vars.locals", kind: "static" }), false);
});

test("checkState: all / none / some", () => {
  const selection = new Set(["a", "b"]);
  assert.equal(checkState(selection, ["a", "b"]), "all");
  assert.equal(checkState(selection, ["c", "d"]), "none");
  assert.equal(checkState(selection, ["a", "c"]), "some");
  assert.equal(checkState(selection, []), "none");
});

test("setKeys is immutable and toggles the given keys on/off", () => {
  const original = new Set(["a"]);
  const withB = setKeys(original, ["b", "c"], true);
  assert.deepEqual([...original], ["a"]);
  assert.deepEqual([...withB].sort(), ["a", "b", "c"]);

  const withoutA = setKeys(withB, ["a"], false);
  assert.deepEqual([...withB].sort(), ["a", "b", "c"]);
  assert.deepEqual([...withoutA].sort(), ["b", "c"]);
});

test("pruneSelection drops keys that no longer exist in doc", () => {
  const doc = {
    layers: [{ id: "defs.methods", kind: "static", marks: [{ file: "a.rb", start: 0, end: 5 }] }],
  };
  const known = markKey("defs.methods", doc.layers[0].marks[0]);
  const selection = new Set([known, "defs.methods|a.rb|99|100", "gone.layer|a.rb|0|1"]);
  const pruned = pruneSelection(selection, doc);
  assert.deepEqual([...pruned], [known]);
});
