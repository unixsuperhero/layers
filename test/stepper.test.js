import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStepper } from '../src/core/stepper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(
  readFileSync(path.join(__dirname, '../fixtures/example-ruby/layers.json'), 'utf8')
);
const trace = doc.trace;

test('starts at cursor 0', () => {
  const s = createStepper(trace);
  assert.equal(s.cursor, 0);
  assert.equal(s.length, 24);
  assert.equal(s.current().i, 0);
});

test('next/prev clamp at both ends', () => {
  const s = createStepper(trace);
  s.prev();
  assert.equal(s.cursor, 0);
  s.goto(trace.length - 1);
  s.next();
  assert.equal(s.cursor, trace.length - 1);
  s.prev();
  assert.equal(s.cursor, trace.length - 2);
});

test('stepOver from event 6 skips the whole summary call, landing on 19', () => {
  const s = createStepper(trace);
  s.goto(6);
  assert.equal(trace[6].event, 'line');
  assert.equal(trace[6].file, 'mailer.rb');
  assert.equal(trace[6].depth, 1);
  s.stepOver();
  assert.equal(s.cursor, 19);
  assert.equal(trace[19].depth, 1);
});

test('stepOut from event 11 (depth 3) lands on 16', () => {
  const s = createStepper(trace);
  s.goto(11);
  assert.equal(trace[11].depth, 3);
  s.stepOut();
  assert.equal(s.cursor, 16);
  assert.equal(trace[16].depth, 2);
});

test('stepBackOver from event 19 lands back on 6', () => {
  const s = createStepper(trace);
  s.goto(19);
  s.stepBackOver();
  assert.equal(s.cursor, 6);
});

test('localsAt(7): call event opening its frame, own locals null -> {}', () => {
  const s = createStepper(trace);
  assert.equal(trace[7].event, 'call');
  assert.equal(trace[7].locals, null);
  assert.deepEqual(s.localsAt(7), {});
});

test('localsAt(10): b_call event opening its frame, own locals null -> {}', () => {
  const s = createStepper(trace);
  assert.equal(trace[10].event, 'b_call');
  assert.equal(trace[10].locals, null);
  assert.deepEqual(s.localsAt(10), {});
});

test('localsAt(18): return with null locals falls back to locals of event 17', () => {
  const s = createStepper(trace);
  assert.equal(trace[18].event, 'return');
  assert.equal(trace[18].locals, null);
  assert.deepEqual(s.localsAt(18), trace[17].locals);
});

test('stack(11) has symbols [Mailer#notify, Invoice#summary, null]', () => {
  const s = createStepper(trace);
  const frames = s.stack(11);
  assert.deepEqual(
    frames.map((f) => f.symbol),
    ['Mailer#notify', 'Invoice#summary', null]
  );
});

test('stack(18) still includes Invoice#summary (frame open at its own return event)', () => {
  const s = createStepper(trace);
  const frames = s.stack(18);
  assert.deepEqual(
    frames.map((f) => f.symbol),
    ['Mailer#notify', 'Invoice#summary']
  );
});

test('stack(19) no longer includes Invoice#summary', () => {
  const s = createStepper(trace);
  const frames = s.stack(19);
  assert.deepEqual(
    frames.map((f) => f.symbol),
    ['Mailer#notify']
  );
});

test('goto clamps to [0, length-1]', () => {
  const s = createStepper(trace);
  s.goto(-5);
  assert.equal(s.cursor, 0);
  s.goto(1000);
  assert.equal(s.cursor, trace.length - 1);
});

test('forward-then-back round trip returns to the same cursor and localsAt', () => {
  const s = createStepper(trace);
  s.goto(9);
  const localsBefore = s.localsAt();
  s.stepOver();
  s.stepBackOver();
  assert.equal(s.cursor, 9);
  assert.deepEqual(s.localsAt(), localsBefore);
});

test('empty trace behaviour', () => {
  const s = createStepper([]);
  assert.equal(s.length, 0);
  assert.equal(s.cursor, 0);
  assert.equal(s.current(), null);
  assert.equal(s.next(), null);
  assert.equal(s.prev(), null);
  assert.equal(s.stepOver(), null);
  assert.equal(s.stepBackOver(), null);
  assert.equal(s.stepOut(), null);
  assert.deepEqual(s.localsAt(), {});
  assert.deepEqual(s.stack(), []);
});
