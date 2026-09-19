import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSymbolIndex, jumpTargets } from '../src/core/symbols.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(
  readFileSync(path.join(__dirname, '../fixtures/example-ruby/layers.json'), 'utf8')
);
const index = buildSymbolIndex(doc);

test('Invoice#summary has 1 definition and 2 references sorted by file', () => {
  const entry = index['Invoice#summary'];
  assert.equal(entry.definitions.length, 1);
  assert.equal(entry.definitions[0].file, 'invoice.rb');
  assert.equal(entry.references.length, 2);
  assert.deepEqual(
    entry.references.map((r) => r.file),
    ['invoice.rb', 'mailer.rb']
  );
});

test('Invoice has a definition in invoice.rb and a reference in main.rb', () => {
  const entry = index['Invoice'];
  assert.equal(entry.definitions.length, 1);
  assert.equal(entry.definitions[0].file, 'invoice.rb');
  assert.equal(entry.references.length, 1);
  assert.equal(entry.references[0].file, 'main.rb');
});

test('Invoice#summary/total has 2 writes and 1 read; jumpTargets returns the writes', () => {
  const entry = index['Invoice#summary/total'];
  assert.equal(entry.writes.length, 2);
  assert.equal(entry.reads.length, 1);
  assert.equal(entry.definitions.length, 0);
  assert.deepEqual(jumpTargets(index, 'Invoice#summary/total'), entry.writes);
});

test('duplicate marks across vars.locals and vars.temps dedupe to one ref, layer vars.locals wins', () => {
  const entry = index['Invoice#summary/label'];
  assert.equal(entry.writes.length, 1);
  assert.equal(entry.writes[0].layer, 'vars.locals');
  assert.equal(entry.reads.length, 1);
  assert.equal(entry.reads[0].layer, 'vars.locals');
});

test('jumpTargets for an unknown symbol returns []', () => {
  assert.deepEqual(jumpTargets(index, 'NoSuchSymbol'), []);
});

test('jumpTargets prefers definitions over writes', () => {
  const entry = index['Invoice'];
  assert.deepEqual(jumpTargets(index, 'Invoice'), entry.definitions);
});

test('marks with symbol null are skipped', () => {
  for (const entry of Object.values(index)) {
    for (const list of [entry.definitions, entry.references, entry.writes, entry.reads]) {
      for (const ref of list) {
        assert.notEqual(ref.file, undefined);
      }
    }
  }
  assert.equal(index[null], undefined);
  assert.equal(index.undefined, undefined);
});
