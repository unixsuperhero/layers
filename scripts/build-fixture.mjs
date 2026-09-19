#!/usr/bin/env node
// Builds <project>/layers.json from <project>/fixture.spec.json.
// The spec locates marks by (line, text, nth) so byte offsets are computed, never hand-typed.
// Usage: node scripts/build-fixture.mjs fixtures/example-ruby
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("usage: build-fixture.mjs <projectDir>");
  process.exit(2);
}

const project = JSON.parse(readFileSync(join(projectDir, "project.json"), "utf8"));
const spec = JSON.parse(readFileSync(join(projectDir, "fixture.spec.json"), "utf8"));

const sources = {};
for (const file of project.files) {
  const buf = readFileSync(join(projectDir, project.root, file));
  const lineStarts = [0];
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) lineStarts.push(i + 1);
  sources[file] = { buf, lineStarts };
}

function lineRange(file, line) {
  const src = sources[file];
  if (!src) throw new Error(`unknown file ${file}`);
  const start = src.lineStarts[line - 1];
  if (start === undefined) throw new Error(`${file}: no line ${line}`);
  let end = src.lineStarts[line] === undefined ? src.buf.length : src.lineStarts[line] - 1;
  return { start, end };
}

function locate(file, line, text, nth = 1) {
  const { start, end } = lineRange(file, line);
  const hay = sources[file].buf.subarray(start, end);
  const needle = Buffer.from(text, "utf8");
  let at = -1;
  for (let n = 0; n < nth; n++) {
    at = hay.indexOf(needle, at + 1);
    if (at === -1) throw new Error(`${file}:${line}: occurrence ${nth} of ${JSON.stringify(text)} not found`);
  }
  return { start: start + at, end: start + at + needle.length };
}

function trimmedLine(file, line) {
  let { start, end } = lineRange(file, line);
  const buf = sources[file].buf;
  while (start < end && (buf[start] === 0x20 || buf[start] === 0x09)) start++;
  while (end > start && (buf[end - 1] === 0x20 || buf[end - 1] === 0x09)) end--;
  return { start, end };
}

const byLayer = new Map();
function addMark(layerId, kind, mark) {
  if (!byLayer.has(layerId)) byLayer.set(layerId, { id: layerId, kind, producer: spec.producer, marks: [] });
  byLayer.get(layerId).marks.push(mark);
}

for (const [layer, file, line, text, symbol, role, nth] of spec.marks) {
  addMark(layer, "static", { file, ...locate(file, line, text, nth), symbol, role, data: {} });
}

const trace = spec.trace.map(([event, file, line, depth, extra], i) => ({
  i,
  event,
  file,
  ...trimmedLine(file, line),
  depth,
  symbol: extra.symbol ?? null,
  recv: extra.recv ?? null,
  locals: extra.locals ?? null,
  value: extra.value ?? null,
}));

const seen = new Set();
for (const ev of trace) {
  const key = `${ev.file}:${ev.start}:${ev.end}`;
  if (seen.has(key)) continue;
  seen.add(key);
  addMark("exec.path", "dynamic", { file: ev.file, start: ev.start, end: ev.end, symbol: null, role: "executed", data: {} });
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const layers = [...byLayer.values()].sort((a, b) => cmp(a.id, b.id));
for (const layer of layers) {
  layer.marks.sort((a, b) => cmp(a.file, b.file) || a.start - b.start || a.end - b.end || cmp(a.symbol ?? "", b.symbol ?? ""));
}

const files = {};
for (const file of [...project.files].sort()) {
  const { buf } = sources[file];
  files[file] = { sha: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

const doc = { version: 1, files, layers, trace };
writeFileSync(join(projectDir, "layers.json"), JSON.stringify(doc, null, 2) + "\n");
console.log(`${projectDir}/layers.json: ${layers.length} layers, ${layers.reduce((n, l) => n + l.marks.length, 0)} marks, ${trace.length} trace events`);
