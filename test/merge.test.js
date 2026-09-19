import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { merge } from "../src/core/merge.js";
import { validate } from "../src/core/validate.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/example-ruby/layers.json", import.meta.url)),
);

test("merge of fixture split into static/dynamic docs equals the original", () => {
  const staticDoc = {
    version: 1,
    files: fixture.files,
    layers: fixture.layers.filter((l) => l.kind === "static"),
  };
  const dynamicDoc = {
    version: 1,
    files: fixture.files,
    layers: fixture.layers.filter((l) => l.kind === "dynamic"),
    trace: fixture.trace,
  };
  const merged = merge([staticDoc, dynamicDoc]);
  assert.deepEqual(merged, fixture);
  assert.equal(validate(merged).ok, true);
});

test("merge conflict on sha throws", () => {
  const docA = { version: 1, files: { "a.rb": { sha: "a".repeat(64), bytes: 1 } }, layers: [] };
  const docB = { version: 1, files: { "a.rb": { sha: "b".repeat(64), bytes: 1 } }, layers: [] };
  assert.throws(() => merge([docA, docB]), /sha/);
});

test("merge throws when more than one doc carries a non-empty trace", () => {
  const traceEvent = (i) => ({ i, event: "line", file: "a.rb", start: 0, end: 1, depth: 0 });
  const docA = {
    version: 1,
    files: { "a.rb": { sha: "a".repeat(64), bytes: 1 } },
    layers: [],
    trace: [traceEvent(0)],
  };
  const docB = {
    version: 1,
    files: { "a.rb": { sha: "a".repeat(64), bytes: 1 } },
    layers: [],
    trace: [traceEvent(0)],
  };
  assert.throws(() => merge([docA, docB]), /trace/);
});

test("merge throws on kind/producer mismatch for the same layer id", () => {
  const files = { "a.rb": { sha: "a".repeat(64), bytes: 10 } };
  const docA = {
    version: 1,
    files,
    layers: [{ id: "defs.methods", kind: "static", producer: "p@1", marks: [] }],
  };
  const docB = {
    version: 1,
    files,
    layers: [{ id: "defs.methods", kind: "dynamic", producer: "p@1", marks: [] }],
  };
  assert.throws(() => merge([docA, docB]), /kind\/producer/);
});

test("merge drops exact-duplicate marks", () => {
  const files = { "a.rb": { sha: "a".repeat(64), bytes: 10 } };
  const mark = { file: "a.rb", start: 0, end: 1, symbol: null, role: "executed", data: {} };
  const docA = {
    version: 1,
    files,
    layers: [{ id: "defs.methods", kind: "static", producer: "p@1", marks: [mark] }],
  };
  const docB = {
    version: 1,
    files,
    layers: [{ id: "defs.methods", kind: "static", producer: "p@1", marks: [{ ...mark }] }],
  };
  const merged = merge([docA, docB]);
  assert.equal(merged.layers[0].marks.length, 1);
});

test("merge([x]) is idempotent", () => {
  const once = merge([fixture]);
  const twice = merge([once]);
  assert.deepEqual(once, twice);
  assert.deepEqual(once, fixture);
});
