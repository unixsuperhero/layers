import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCallTree, frameAt } from '../src/core/calltree.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(
  readFileSync(path.join(__dirname, '../fixtures/example-ruby/layers.json'), 'utf8')
);
const trace = doc.trace;

function span(e) {
  return { file: e.file, start: e.start, end: e.end };
}

test('root has Invoice#initialize and Mailer#notify as children', () => {
  const root = buildCallTree(trace);
  assert.equal(root.kind, 'root');
  assert.equal(root.symbol, null);
  assert.equal(root.enter, 0);
  assert.equal(root.exit, trace.length - 1);
  assert.deepEqual(root.def, span(trace[0]));
  assert.equal(root.children.length, 2);

  const [init, notify] = root.children;
  assert.equal(init.kind, 'call');
  assert.equal(init.symbol, 'Invoice#initialize');
  assert.equal(init.enter, 1);
  assert.equal(init.exit, 3);
  assert.equal(init.value, trace[3].value);

  assert.equal(notify.symbol, 'Mailer#notify');
  assert.equal(notify.enter, 5);
  assert.equal(notify.exit, 23);
});

test('Mailer#notify has Invoice#summary and Mailer#deliver as children', () => {
  const root = buildCallTree(trace);
  const notify = root.children[1];
  assert.equal(notify.children.length, 2);

  const [summary, deliver] = notify.children;
  assert.equal(summary.symbol, 'Invoice#summary');
  assert.equal(summary.enter, 7);
  assert.equal(summary.exit, 18);
  assert.equal(summary.value, trace[18].value);

  assert.equal(deliver.symbol, 'Mailer#deliver');
  assert.equal(deliver.enter, 20);
  assert.equal(deliver.exit, 22);
});

test('Invoice#summary has two block children sharing the same call-site line', () => {
  const root = buildCallTree(trace);
  const summary = root.children[1].children[0];
  assert.equal(summary.children.length, 2);

  const [block1, block2] = summary.children;
  assert.equal(block1.kind, 'block');
  assert.equal(block1.symbol, null);
  assert.equal(block1.enter, 10);
  assert.equal(block1.exit, 12);
  assert.equal(block2.enter, 13);
  assert.equal(block2.exit, 15);

  assert.deepEqual(block1.site, span(trace[9]));
  assert.deepEqual(block2.site, span(trace[9]));
});

test('every node depth equals its enter events depth', () => {
  const root = buildCallTree(trace);
  assert.equal(root.depth, trace[root.enter].depth);
  (function walk(node) {
    for (const child of node.children) {
      assert.equal(child.depth, trace[child.enter].depth);
      walk(child);
    }
  })(root);
});

test('frameAt finds the innermost frame at each index', () => {
  const root = buildCallTree(trace);
  const notify = root.children[1];
  const summary = notify.children[0];
  const [block1, block2] = summary.children;

  assert.equal(frameAt(root, 0), root);
  assert.equal(frameAt(root, 2), root.children[0]);
  assert.equal(frameAt(root, 11), block1);
  assert.equal(frameAt(root, 14), block2);
  assert.equal(frameAt(root, 17), summary);
  assert.equal(frameAt(root, 19), notify);
  assert.equal(frameAt(root, 23), notify);
});

test('unterminated frames (truncated trace) get exit = last index', () => {
  const truncated = trace.slice(0, 12);
  const root = buildCallTree(truncated);
  const last = truncated.length - 1;
  assert.equal(last, 11);

  const notify = root.children[1];
  const summary = notify.children[0];
  const block1 = summary.children[0];

  assert.equal(notify.exit, last);
  assert.equal(notify.value, null);
  assert.equal(summary.exit, last);
  assert.equal(summary.value, null);
  assert.equal(block1.exit, last);
  assert.equal(block1.value, null);
});

test('a raise event does not open or close a frame', () => {
  const t = [
    { i: 0, event: 'call', file: 'a.rb', start: 0, end: 1, depth: 1, symbol: 'A#a', recv: 'A', locals: null, value: null },
    { i: 1, event: 'line', file: 'a.rb', start: 2, end: 3, depth: 1, symbol: null, recv: null, locals: {}, value: null },
    { i: 2, event: 'raise', file: 'a.rb', start: 2, end: 3, depth: 1, symbol: null, recv: null, locals: null, value: null },
    { i: 3, event: 'return', file: 'a.rb', start: 4, end: 5, depth: 1, symbol: 'A#a', recv: null, locals: null, value: 'nil' },
  ];
  const root = buildCallTree(t);
  assert.equal(root.children.length, 1);
  const a = root.children[0];
  assert.equal(a.enter, 0);
  assert.equal(a.exit, 3);
  assert.equal(a.value, 'nil');
});

test('a stray return with no open frame of matching kind is ignored, not thrown', () => {
  const t = [
    { i: 0, event: 'line', file: 'a.rb', start: 0, end: 1, depth: 0, symbol: null, recv: null, locals: {}, value: null },
    { i: 1, event: 'b_return', file: 'a.rb', start: 2, end: 3, depth: 0, symbol: null, recv: null, locals: null, value: null },
    { i: 2, event: 'call', file: 'a.rb', start: 4, end: 5, depth: 1, symbol: 'A#a', recv: 'A', locals: null, value: null },
    { i: 3, event: 'return', file: 'a.rb', start: 6, end: 7, depth: 1, symbol: 'A#a', recv: null, locals: null, value: '1' },
  ];
  assert.doesNotThrow(() => buildCallTree(t));
  const root = buildCallTree(t);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].exit, 3);
});

test('a malformed return at the wrong depth closes the innermost frame of matching kind', () => {
  const t = [
    { i: 0, event: 'call', file: 'a.rb', start: 0, end: 1, depth: 1, symbol: 'A#a', recv: 'A', locals: null, value: null },
    { i: 1, event: 'b_call', file: 'a.rb', start: 2, end: 3, depth: 2, symbol: null, recv: null, locals: null, value: null },
    { i: 2, event: 'return', file: 'a.rb', start: 4, end: 5, depth: 1, symbol: 'A#a', recv: null, locals: null, value: '1' },
    { i: 3, event: 'line', file: 'a.rb', start: 6, end: 7, depth: 0, symbol: null, recv: null, locals: {}, value: null },
  ];
  assert.doesNotThrow(() => buildCallTree(t));
  const root = buildCallTree(t);
  const a = root.children[0];
  assert.equal(a.exit, 2);
  assert.equal(a.value, '1');
  const block = a.children[0];
  assert.equal(block.exit, 3);
  assert.equal(block.value, null);
});

test('empty trace', () => {
  const root = buildCallTree([]);
  assert.equal(root.kind, 'root');
  assert.equal(root.enter, 0);
  assert.equal(root.exit, -1);
  assert.deepEqual(root.children, []);
  assert.equal(frameAt(root, 0), root);
});
