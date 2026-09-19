import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../src/viewer/history.js";

test("push then back returns to the previous entry", () => {
  const h = createHistory({ file: "main.rb", pos: 0 });
  h.push({ file: "invoice.rb", pos: 10 });
  assert.deepEqual(h.current(), { file: "invoice.rb", pos: 10 });
  assert.deepEqual(h.back(), { file: "main.rb", pos: 0 });
  assert.equal(h.canBack(), false);
});

test("forward re-plays an entry undone by back", () => {
  const h = createHistory({ file: "main.rb", pos: 0 });
  h.push({ file: "invoice.rb", pos: 10 });
  h.back();
  assert.deepEqual(h.forward(), { file: "invoice.rb", pos: 10 });
  assert.equal(h.canForward(), false);
});

test("pushing after back truncates the forward stack", () => {
  const h = createHistory({ file: "main.rb", pos: 0 });
  h.push({ file: "invoice.rb", pos: 10 });
  h.back();
  h.push({ file: "mailer.rb", pos: 5 });
  assert.equal(h.forward(), undefined);
  assert.deepEqual(h.current(), { file: "mailer.rb", pos: 5 });
});

test("back/forward on an empty or single-entry history are no-ops", () => {
  const h = createHistory();
  assert.equal(h.back(), undefined);
  assert.equal(h.forward(), undefined);
  assert.equal(h.current(), undefined);

  h.push({ file: "a.rb", pos: 0 });
  assert.equal(h.canBack(), false);
  assert.equal(h.canForward(), false);
});
