import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../src/core/validate.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/example-ruby/layers.json", import.meta.url)),
);

test("generated fixture validates OK", () => {
  const result = validate(fixture);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("schema failure: bad role", () => {
  const doc = structuredClone(fixture);
  doc.layers[0].marks[0].role = "bogus";
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("semantic rule 1: mark.file must be a key of files", () => {
  const doc = structuredClone(fixture);
  doc.layers[0].marks[0].file = "nope.rb";
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("nope.rb")));
});

test("semantic rule 1: trace[].file must be a key of files", () => {
  const doc = structuredClone(fixture);
  doc.trace[0].file = "nope.rb";
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("nope.rb")));
});

test("semantic rule 2: start <= end <= files[file].bytes", () => {
  const doc = structuredClone(fixture);
  doc.layers[0].marks[0].end = doc.files["invoice.rb"].bytes + 1000;
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("start <= end <= bytes")));
});

test("semantic rule 3: layer ids must be unique and sorted", () => {
  const doc = structuredClone(fixture);
  doc.layers[1].id = doc.layers[0].id;
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("duplicate layer id")));
});

test("semantic rule 3: layers must be sorted by id", () => {
  const doc = structuredClone(fixture);
  [doc.layers[0], doc.layers[1]] = [doc.layers[1], doc.layers[0]];
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("sorted by id")));
});

test("semantic rule 4: marks within a layer must be sorted", () => {
  const doc = structuredClone(fixture);
  const layer = doc.layers.find((l) => l.marks.length > 1);
  [layer.marks[0], layer.marks[1]] = [layer.marks[1], layer.marks[0]];
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("sorted by (file, start, end, symbol)")));
});

test("semantic rule 5: trace[n].i === n", () => {
  const doc = structuredClone(fixture);
  doc.trace[2].i = 99;
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === "/trace/2/i"));
});
