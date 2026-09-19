import { test } from "node:test";
import assert from "node:assert/strict";
import { marksAtPosition, innermostSymbol, lineOfOffset } from "../src/viewer/marks-at.js";

test("marksAtPosition finds marks covering a position, half-open", () => {
  const marks = [
    { start: 0, end: 10, symbol: "a" },
    { start: 5, end: 8, symbol: "b" },
    { start: 10, end: 12, symbol: "c" },
  ];
  assert.deepEqual(
    marksAtPosition(marks, 6).map((m) => m.symbol),
    ["a", "b"],
  );
  assert.deepEqual(
    marksAtPosition(marks, 10).map((m) => m.symbol),
    ["c"],
  );
});

test("innermostSymbol picks the shortest span, ignores null symbols", () => {
  const marks = [
    { start: 0, end: 20, symbol: "outer" },
    { start: 5, end: 8, symbol: "inner" },
    { start: 5, end: 15, symbol: null },
  ];
  assert.equal(innermostSymbol(marks), "inner");
});

test("innermostSymbol returns null when nothing has a symbol", () => {
  assert.equal(innermostSymbol([{ start: 0, end: 5, symbol: null }]), null);
  assert.equal(innermostSymbol([]), null);
});

test("lineOfOffset counts newlines, 1-based", () => {
  const text = "class Invoice\n  attr_reader :items\n\n  def initialize(items)\n";
  assert.equal(lineOfOffset(text, 0), 1);
  assert.equal(lineOfOffset(text, 14), 2);
  assert.equal(lineOfOffset(text, 35), 3);
  assert.equal(lineOfOffset(text, 36), 4);
});
