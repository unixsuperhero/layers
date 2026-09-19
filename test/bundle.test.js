import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleBundle, parseBundle, bundleKey, verifySources } from "../src/core/bundle.js";

const doc = JSON.parse(readFileSync(new URL("../fixtures/example-ruby/layers.json", import.meta.url)));
const project = JSON.parse(readFileSync(new URL("../fixtures/example-ruby/project.json", import.meta.url)));
const sources = {};
for (const file of project.files) {
  sources[file] = readFileSync(new URL(`../fixtures/example-ruby/src/${file}`, import.meta.url), "utf8");
}

function makeBundle() {
  return assembleBundle({ project, sources, doc });
}

test("assembleBundle fills defaults for presentation/selection/ui", () => {
  const bundle = makeBundle();
  assert.equal(bundle.bundle, 1);
  assert.deepEqual(bundle.project, project);
  assert.deepEqual(bundle.sources, sources);
  assert.deepEqual(bundle.presentation, { version: 1, scenes: [] });
  assert.equal(bundle.selection, null);
  assert.equal(bundle.ui, null);
});

test("assembleBundle carries through presentation/selection/ui when given", () => {
  const presentation = { version: 1, scenes: [{ id: "s1", name: "x", file: null, marks: [], step: null }] };
  const selection = ["defs.methods|invoice.rb|1|2"];
  const ui = { file: "invoice.rb", solo: null, focus: false, scene: null, i: 3, railWidth: 300 };
  const bundle = assembleBundle({ project, sources, doc, presentation, selection, ui });
  assert.deepEqual(bundle.presentation, presentation);
  assert.deepEqual(bundle.selection, selection);
  assert.deepEqual(bundle.ui, ui);
});

test("parseBundle round-trips a bundle produced by assembleBundle", () => {
  const bundle = makeBundle();
  const parsed = parseBundle(JSON.parse(JSON.stringify(bundle)));
  assert.deepEqual(parsed, bundle);
});

test("parseBundle throws a readable error on missing keys", () => {
  assert.throws(() => parseBundle({}), /unsupported bundle version/);
  assert.throws(() => parseBundle({ bundle: 1 }), /bundle\.project/);
  assert.throws(() => parseBundle({ bundle: 1, project }), /bundle\.sources/);
  assert.throws(() => parseBundle({ bundle: 1, project, sources }), /bundle\.doc/);
});

test("parseBundle throws on wrong bundle version", () => {
  const bundle = { ...makeBundle(), bundle: 2 };
  assert.throws(() => parseBundle(bundle), /unsupported bundle version/);
});

test("parseBundle throws on files/sources mismatch", () => {
  const bundle = makeBundle();
  const badSources = { ...bundle.sources };
  delete badSources["mailer.rb"];
  assert.throws(() => parseBundle({ ...bundle, sources: badSources }), /do not match/);

  const extraSources = { ...bundle.sources, "extra.rb": "# x" };
  assert.throws(() => parseBundle({ ...bundle, sources: extraSources }), /do not match/);
});

test("parseBundle rejects a non-object", () => {
  assert.throws(() => parseBundle(null), /must be an object/);
  assert.throws(() => parseBundle("nope"), /must be an object/);
  assert.throws(() => parseBundle([1, 2]), /must be an object/);
});

test("bundleKey is stable for the same bundle and differs when a sha changes", () => {
  const bundle = makeBundle();
  const key1 = bundleKey(bundle);
  const key2 = bundleKey(JSON.parse(JSON.stringify(bundle)));
  assert.equal(key1, key2);
  assert.ok(key1.startsWith(`${project.name}-`));

  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.doc.files["invoice.rb"].sha = "0".repeat(64);
  assert.notEqual(bundleKey(tampered), key1);
});

test("verifySources: unmodified bundle has no mismatches", async () => {
  const bundle = makeBundle();
  const mismatched = await verifySources(bundle);
  assert.deepEqual(mismatched, []);
});

test("verifySources: a tampered source is reported by name", async () => {
  const bundle = makeBundle();
  const tampered = { ...bundle, sources: { ...bundle.sources, "invoice.rb": bundle.sources["invoice.rb"] + " " } };
  const mismatched = await verifySources(tampered);
  assert.deepEqual(mismatched, ["invoice.rb"]);
});
