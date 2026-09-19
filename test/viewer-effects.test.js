import { test } from "node:test";
import assert from "node:assert/strict";
import { effectLabel, titleForSegment } from "../src/viewer/effects.js";

test("effectLabel: io", () => {
  assert.equal(effectLabel({ data: { kind: "io", what: "output" } }), "io: output");
});

test("effectLabel: args names the mutated argument", () => {
  assert.equal(effectLabel({ data: { kind: "args", target: "log" } }), "mutates arg: log");
});

test("effectLabel: state and global are fixed generic labels", () => {
  assert.equal(effectLabel({ data: { kind: "state" } }), "mutates self");
  assert.equal(effectLabel({ data: { kind: "global" } }), "global state");
});

test("effectLabel: control uses the passed source text, else a generic fallback", () => {
  assert.equal(effectLabel({ data: { kind: "control" } }, "raise"), "control flow: raise");
  assert.equal(effectLabel({ data: { kind: "control" } }), "control flow");
});

test("effectLabel: calls names the impure callee and its effect kinds", () => {
  assert.equal(
    effectLabel({ data: { kind: "calls", via: "Mailer#deliver", effects: ["io"] } }),
    "calls impure Mailer#deliver → io",
  );
});

test("effectLabel: unknown names the call", () => {
  assert.equal(effectLabel({ data: { kind: "unknown", name: "frobnicate" } }), "unknown call: frobnicate");
});

test("effectLabel: unrecognised/missing data yields an empty string", () => {
  assert.equal(effectLabel({ data: {} }), "");
  assert.equal(effectLabel({}), "");
});

test("titleForSegment: finds the effects.* mark among a segment's contributing marks", () => {
  const painted = [
    { layer: "refs.calls", key: "refs.calls|mailer.rb|94|101" },
    { layer: "effects.calls", key: "effects.calls|mailer.rb|94|101" },
  ];
  const marksByKey = new Map([
    ["effects.calls|mailer.rb|94|101", { data: { kind: "calls", via: "Mailer#deliver", effects: ["io"] } }],
  ]);
  const seg = { marks: [0, 1] };
  assert.equal(titleForSegment(seg, painted, marksByKey), "calls impure Mailer#deliver → io");
});

test("titleForSegment: null when no effects.* layer is in the segment", () => {
  const painted = [{ layer: "refs.calls", key: "refs.calls|a.rb|0|1" }];
  const seg = { marks: [0] };
  assert.equal(titleForSegment(seg, painted, new Map()), null);
});

test("titleForSegment: passes the mark's own source text through for the control kind", () => {
  const painted = [{ layer: "effects.control", key: "k" }];
  const marksByKey = new Map([["k", { data: { kind: "control" } }]]);
  const seg = { marks: [0] };
  assert.equal(
    titleForSegment(seg, painted, marksByKey, () => "raise"),
    "control flow: raise",
  );
});
