import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeOffsetMap } from '../src/core/offsets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('ASCII text: byteToChar and charToByte are identity', () => {
  const text = 'hello world';
  const map = makeOffsetMap(text);
  assert.equal(map.bytes, 11);
  for (let i = 0; i <= text.length; i++) {
    assert.equal(map.charToByte(i), i);
    assert.equal(map.byteToChar(i), i);
  }
});

test('2-byte UTF-8 character (é)', () => {
  const text = 'café'; // 'café', é is 2 bytes
  const map = makeOffsetMap(text);
  assert.equal(map.bytes, 5); // c,a,f = 3 bytes, é = 2 bytes
  assert.equal(map.charToByte(0), 0);
  assert.equal(map.charToByte(3), 3); // start of é
  assert.equal(map.charToByte(4), 5); // end of string
  assert.equal(map.byteToChar(3), 3);
  assert.equal(map.byteToChar(5), 4);
});

test('3-byte UTF-8 character (em dash)', () => {
  const text = 'a—b'; // em dash is 3 bytes
  const map = makeOffsetMap(text);
  assert.equal(map.bytes, 5); // a=1, em-dash=3, b=1
  assert.equal(map.charToByte(0), 0);
  assert.equal(map.charToByte(1), 1);
  assert.equal(map.charToByte(2), 4);
  assert.equal(map.byteToChar(1), 1);
  assert.equal(map.byteToChar(4), 2);
});

test('4-byte UTF-8 character via surrogate pair (emoji)', () => {
  const text = 'a\u{1F600}b'; // grinning face emoji, 4 bytes, 2 UTF-16 units
  const map = makeOffsetMap(text);
  assert.equal(text.length, 4); // 'a' + surrogate pair (2 units) + 'b'
  assert.equal(map.bytes, 6); // a=1, emoji=4, b=1
  assert.equal(map.charToByte(0), 0);
  assert.equal(map.charToByte(1), 1); // start of emoji
  assert.equal(map.charToByte(3), 5); // end of emoji / start of 'b'
  assert.equal(map.charToByte(4), 6); // end of string
  assert.equal(map.byteToChar(1), 1);
  assert.equal(map.byteToChar(5), 3);
  assert.equal(map.byteToChar(6), 4);
});

test('round-trip charToByte(byteToChar(b)) === b for every char boundary', () => {
  const texts = ['hello', 'café — test', 'a\u{1F600}b\u{1F601}c', ''];
  for (const text of texts) {
    const map = makeOffsetMap(text);
    for (let b = 0; b <= map.bytes; b++) {
      let charIndex;
      try {
        charIndex = map.byteToChar(b);
      } catch (err) {
        assert.ok(err instanceof RangeError);
        continue; // mid-character byte offset, not a valid boundary
      }
      assert.equal(map.charToByte(charIndex), b);
    }
  }
});

test('byteToChar(bytes) === text.length (end-of-file offset)', () => {
  const text = 'a\u{1F600}b';
  const map = makeOffsetMap(text);
  assert.equal(map.byteToChar(map.bytes), text.length);
});

test('byteToChar throws RangeError for offset inside a multi-byte character', () => {
  const text = 'aéb'; // é starts at byte 1, spans bytes 1-2
  const map = makeOffsetMap(text);
  assert.throws(() => map.byteToChar(2), RangeError);
});

test('byteToChar throws RangeError for offset inside a 4-byte surrogate-pair character', () => {
  const text = 'a\u{1F600}b';
  const map = makeOffsetMap(text);
  assert.throws(() => map.byteToChar(2), RangeError);
  assert.throws(() => map.byteToChar(3), RangeError);
  assert.throws(() => map.byteToChar(4), RangeError);
});

test('byteToChar throws RangeError for out-of-range offsets', () => {
  const map = makeOffsetMap('hello');
  assert.throws(() => map.byteToChar(-1), RangeError);
  assert.throws(() => map.byteToChar(6), RangeError);
});

test('charToByte throws RangeError for out-of-range char index', () => {
  const map = makeOffsetMap('hello');
  assert.throws(() => map.charToByte(-1), RangeError);
  assert.throws(() => map.charToByte(6), RangeError);
});

test('charToByte throws RangeError for index inside a surrogate pair', () => {
  const text = 'a\u{1F600}b';
  const map = makeOffsetMap(text);
  assert.throws(() => map.charToByte(2), RangeError); // low surrogate of emoji
});

test('empty string', () => {
  const map = makeOffsetMap('');
  assert.equal(map.bytes, 0);
  assert.equal(map.byteToChar(0), 0);
  assert.equal(map.charToByte(0), 0);
});

test('fixture: every mark in layers.json round-trips through the offset map', () => {
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'example-ruby');
  const doc = JSON.parse(readFileSync(path.join(fixtureDir, 'layers.json'), 'utf8'));

  const fileTexts = {};
  const fileBuffers = {};
  const fileMaps = {};
  for (const file of Object.keys(doc.files)) {
    const buf = readFileSync(path.join(fixtureDir, 'src', file));
    fileBuffers[file] = buf;
    fileTexts[file] = buf.toString('utf8');
    fileMaps[file] = makeOffsetMap(fileTexts[file]);
  }

  let checked = 0;
  for (const layer of doc.layers) {
    for (const mark of layer.marks) {
      const map = fileMaps[mark.file];
      const text = fileTexts[mark.file];
      const buf = fileBuffers[mark.file];

      const startChar = map.byteToChar(mark.start);
      const endChar = map.byteToChar(mark.end);

      const fromChars = text.slice(startChar, endChar);
      const fromBytes = buf.subarray(mark.start, mark.end).toString('utf8');

      assert.equal(fromChars, fromBytes, `mismatch for ${layer.id} mark [${mark.start},${mark.end}) in ${mark.file}`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'expected at least one mark to be checked');
});
