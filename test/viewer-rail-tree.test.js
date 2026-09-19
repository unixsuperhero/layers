import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildRailTree, resolveSoloId } from "../src/viewer/rail-tree.js";
import { markKey } from "../src/viewer/selection.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "example-ruby", "layers.json"), "utf8"));
const allLayerIds = doc.layers.map((l) => l.id);

function byId(tree, id) {
  return tree.byId.get(id);
}

test("All Files subtree equals today's grouping: one namespace node per namespace, each holding its layers", () => {
  const tree = buildRailTree(doc, []);
  const all = byId(tree, "all");
  assert.equal(all.label, "ALL FILES");
  const namespaces = all.children.map((c) => c.label);
  assert.deepEqual(namespaces, ["defs.*", "exec.*", "refs.*", "vars.*"]);

  const varsGroup = all.children.find((c) => c.label === "vars.*");
  assert.deepEqual(
    varsGroup.children.map((l) => l.layerId),
    ["vars.ivars", "vars.locals", "vars.temps"],
  );

  const varsLocals = byId(tree, "all/vars.locals");
  assert.equal(varsLocals.kind, "layer");
  const expected = doc.layers.find((l) => l.id === "vars.locals").marks.map((m) => markKey("vars.locals", m));
  assert.deepEqual(varsLocals.keys.slice().sort(), expected.slice().sort());
});

test("per-file filtering: Whole file only lists layers that have marks in that file, restricted to it", () => {
  const tree = buildRailTree(doc, ["invoice.rb"]);
  const whole = byId(tree, "file/invoice.rb/whole");
  assert.equal(whole.label, "Whole file");
  const varsLocalsInFile = whole.children.find((c) => c.layerId === "vars.locals");
  const allInvoiceVarsLocals = doc.layers
    .find((l) => l.id === "vars.locals")
    .marks.filter((m) => m.file === "invoice.rb")
    .map((m) => markKey("vars.locals", m));
  assert.deepEqual(varsLocalsInFile.keys.slice().sort(), allInvoiceVarsLocals.slice().sort());
  // every key under Whole file belongs to invoice.rb
  for (const key of whole.keys) assert.equal(key.split("|")[1], "invoice.rb");
});

test("per-method grouping: one group per method with marks, in source order, short label + full title", () => {
  const tree = buildRailTree(doc, ["invoice.rb"]);
  const fileNode = byId(tree, "file/invoice.rb");
  const methodNodes = fileNode.children.filter((c) => c.kind === "method");
  assert.deepEqual(
    methodNodes.map((n) => n.label),
    ["initialize", "summary", "overdue?"],
  );
  assert.deepEqual(
    methodNodes.map((n) => n.title),
    ["Invoice#initialize", "Invoice#summary", "Invoice#overdue?"],
  );

  const summary = byId(tree, "file/invoice.rb/scope/Invoice#summary");
  const summaryLayerIds = summary.children.map((c) => c.layerId);
  assert.ok(summaryLayerIds.includes("vars.locals"));
  assert.ok(summaryLayerIds.includes("vars.temps"));
  assert.ok(summaryLayerIds.includes("defs.methods"));
});

test("top-level bucket lists exactly the scope-null marks of that file, and is absent when there are none", () => {
  const tree = buildRailTree(doc, ["invoice.rb", "main.rb"]);
  const mainFile = byId(tree, "file/main.rb");
  const topLevel = mainFile.children.find((c) => c.kind === "top-level");
  assert.ok(topLevel, "main.rb has top-level marks");
  const expected = [];
  for (const layer of doc.layers) {
    for (const mark of layer.marks) {
      if (mark.file === "main.rb" && (mark.data?.scope ?? null) === null) expected.push(markKey(layer.id, mark));
    }
  }
  assert.deepEqual(topLevel.keys.slice().sort(), expected.slice().sort());

  // A doc with no scope-null marks anywhere gets no top-level bucket.
  const onlyScoped = {
    layers: [
      {
        id: "vars.locals",
        marks: [{ file: "a.rb", start: 0, end: 5, symbol: "A#b/x", role: "write", data: { scope: "A#b" } }],
      },
      { id: "defs.methods", marks: [{ file: "a.rb", start: 0, end: 5, symbol: "A#b", role: "definition", data: { scope: "A#b" } }] },
    ],
  };
  const tree2 = buildRailTree(onlyScoped, ["a.rb"]);
  const fileNode2 = byId(tree2, "file/a.rb");
  assert.ok(!fileNode2.children.some((c) => c.kind === "top-level"));
});

test("node ids follow the node-path scheme from docs/ROUND-3.md", () => {
  const tree = buildRailTree(doc, ["invoice.rb"]);
  assert.ok(byId(tree, "all/vars.locals"));
  assert.ok(byId(tree, "all/vars.*"));
  assert.ok(byId(tree, "file/invoice.rb"));
  assert.ok(byId(tree, "file/invoice.rb/scope/Invoice#summary"));
  assert.ok(byId(tree, "file/invoice.rb/scope/Invoice#summary/vars.temps"));
});

test("keys of a method node = all marks with that scope in that file, across every layer", () => {
  const tree = buildRailTree(doc, ["invoice.rb"]);
  const summary = byId(tree, "file/invoice.rb/scope/Invoice#summary");
  const expected = [];
  for (const layer of doc.layers) {
    for (const mark of layer.marks) {
      if (mark.file === "invoice.rb" && mark.data?.scope === "Invoice#summary") expected.push(markKey(layer.id, mark));
    }
  }
  assert.deepEqual(summary.keys.slice().sort(), expected.slice().sort());
});

test("resolveSoloId: legacy plain layer id resolves independent of visibleFiles", () => {
  const tree = buildRailTree(doc, []);
  const resolved = resolveSoloId(tree, doc, allLayerIds, "vars.locals");
  assert.equal(resolved.id, "vars.locals");
  const expected = doc.layers.find((l) => l.id === "vars.locals").marks.map((m) => markKey("vars.locals", m));
  assert.deepEqual(resolved.keys.slice().sort(), expected.slice().sort());
});

test("resolveSoloId: legacy namespace group id resolves to every layer in the group", () => {
  const tree = buildRailTree(doc, []);
  const resolved = resolveSoloId(tree, doc, allLayerIds, "vars.*");
  const expectedLayerIds = ["vars.ivars", "vars.locals", "vars.temps"];
  const expected = [];
  for (const layer of doc.layers) {
    if (!expectedLayerIds.includes(layer.id)) continue;
    for (const mark of layer.marks) expected.push(markKey(layer.id, mark));
  }
  assert.deepEqual(resolved.keys.slice().sort(), expected.slice().sort());
});

test("resolveSoloId: node-path id resolves via the tree", () => {
  const tree = buildRailTree(doc, ["invoice.rb"]);
  const resolved = resolveSoloId(tree, doc, allLayerIds, "file/invoice.rb/scope/Invoice#summary");
  assert.equal(resolved.label, "summary");
  const expected = byId(tree, "file/invoice.rb/scope/Invoice#summary").keys;
  assert.deepEqual(resolved.keys.slice().sort(), expected.slice().sort());
});

test("resolveSoloId: unknown id resolves to null", () => {
  const tree = buildRailTree(doc, ["invoice.rb"]);
  assert.equal(resolveSoloId(tree, doc, allLayerIds, "file/nope.rb"), null);
  assert.equal(resolveSoloId(tree, doc, allLayerIds, null), null);
});
