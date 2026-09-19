import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { flatten } from '../src/core/flatten.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('empty input returns []', () => {
  assert.deepEqual(flatten([]), []);
});

test('zero-length marks are ignored', () => {
  assert.deepEqual(flatten([{ start: 5, end: 5, layer: 'a' }]), []);
});

test('single mark produces a single segment', () => {
  const result = flatten([{ start: 0, end: 10, layer: 'a' }]);
  assert.deepEqual(result, [{ start: 0, end: 10, layers: ['a'], marks: [0] }]);
});

test('nested marks produce three segments', () => {
  const marks = [
    { start: 0, end: 10, layer: 'outer' },
    { start: 3, end: 6, layer: 'inner' },
  ];
  const result = flatten(marks);
  assert.deepEqual(result, [
    { start: 0, end: 3, layers: ['outer'], marks: [0] },
    { start: 3, end: 6, layers: ['inner', 'outer'], marks: [0, 1] },
    { start: 6, end: 10, layers: ['outer'], marks: [0] },
  ]);
});

test('partial overlap produces three segments', () => {
  const marks = [
    { start: 0, end: 6, layer: 'a' },
    { start: 3, end: 9, layer: 'b' },
  ];
  const result = flatten(marks);
  assert.deepEqual(result, [
    { start: 0, end: 3, layers: ['a'], marks: [0] },
    { start: 3, end: 6, layers: ['a', 'b'], marks: [0, 1] },
    { start: 6, end: 9, layers: ['b'], marks: [1] },
  ]);
});

test('identical spans from different layers merge into one segment listing both', () => {
  const marks = [
    { start: 0, end: 5, layer: 'a' },
    { start: 0, end: 5, layer: 'b' },
  ];
  const result = flatten(marks);
  assert.deepEqual(result, [{ start: 0, end: 5, layers: ['a', 'b'], marks: [0, 1] }]);
});

test('adjacent marks (touching, different marks) stay separate segments', () => {
  const marks = [
    { start: 0, end: 5, layer: 'a' },
    { start: 5, end: 10, layer: 'b' },
  ];
  const result = flatten(marks);
  assert.deepEqual(result, [
    { start: 0, end: 5, layers: ['a'], marks: [0] },
    { start: 5, end: 10, layers: ['b'], marks: [1] },
  ]);
});

test('adjacent marks in the same layer still stay separate segments (marks arrays differ)', () => {
  const marks = [
    { start: 0, end: 5, layer: 'a' },
    { start: 5, end: 10, layer: 'a' },
  ];
  const result = flatten(marks);
  assert.deepEqual(result, [
    { start: 0, end: 5, layers: ['a'], marks: [0] },
    { start: 5, end: 10, layers: ['a'], marks: [1] },
  ]);
});

test('marks are unsorted in the input but segments come out ascending', () => {
  const marks = [
    { start: 6, end: 9, layer: 'b' },
    { start: 0, end: 6, layer: 'a' },
  ];
  const result = flatten(marks);
  assert.deepEqual(result, [
    { start: 0, end: 6, layers: ['a'], marks: [1] },
    { start: 6, end: 9, layers: ['b'], marks: [0] },
  ]);
});

test('fixture: flattening invoice.rb marks across all layers covers the union with valid segments', () => {
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'example-ruby');
  const doc = JSON.parse(readFileSync(path.join(fixtureDir, 'layers.json'), 'utf8'));
  const fileName = 'invoice.rb';
  const fileBytes = doc.files[fileName].bytes;

  const marks = [];
  for (const layer of doc.layers) {
    for (const mark of layer.marks) {
      if (mark.file !== fileName) continue;
      marks.push({ start: mark.start, end: mark.end, layer: layer.id });
    }
  }

  const segments = flatten(marks);

  // Segments are ascending and non-overlapping and non-empty.
  for (let i = 0; i < segments.length; i++) {
    assert.ok(segments[i].start < segments[i].end, `segment ${i} is non-empty`);
    if (i > 0) {
      assert.ok(segments[i].start >= segments[i - 1].end, `segment ${i} does not overlap previous`);
    }
  }

  // Union of segments equals union of marks: paint both as boolean arrays and compare.
  const fromMarks = new Array(fileBytes).fill(false);
  for (const m of marks) {
    if (m.start >= m.end) continue;
    for (let b = m.start; b < m.end; b++) fromMarks[b] = true;
  }

  const fromSegments = new Array(fileBytes).fill(false);
  for (const seg of segments) {
    for (let b = seg.start; b < seg.end; b++) fromSegments[b] = true;
  }

  assert.deepEqual(fromSegments, fromMarks);

  // Every referenced mark index is valid, and layers/marks are sorted & unique.
  for (const seg of segments) {
    for (const idx of seg.marks) {
      assert.ok(idx >= 0 && idx < marks.length);
    }
    assert.deepEqual([...seg.marks].sort((a, b) => a - b), seg.marks);
    assert.deepEqual([...new Set(seg.marks)], seg.marks);
    assert.deepEqual([...seg.layers].sort(), seg.layers);
    assert.deepEqual([...new Set(seg.layers)], seg.layers);
  }
});
