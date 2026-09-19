#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validate } from "../src/core/validate.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: layers-validate.mjs <path/to/layers.json>");
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  console.error(`could not read ${path}: ${err.message}`);
  process.exit(2);
}

const result = validate(doc);
if (result.ok) {
  const layers = doc.layers.length;
  const marks = doc.layers.reduce((n, l) => n + l.marks.length, 0);
  const trace = (doc.trace ?? []).length;
  console.log(`OK: ${layers} layers, ${marks} marks, ${trace} trace events`);
  process.exit(0);
}

for (const error of result.errors) {
  console.log(`${error.path}: ${error.message}`);
}
process.exit(1);
