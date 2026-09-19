import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSolo, layersForSolo, paintedLayerIds, cycleSolo } from "../src/viewer/solo.js";

const ALL = ["defs.methods", "exec.path", "vars.ivars", "vars.locals", "vars.temps"];

test("matchesSolo: exact id vs namespace group", () => {
  assert.equal(matchesSolo("vars.locals", "vars.locals"), true);
  assert.equal(matchesSolo("vars.temps", "vars.locals"), false);
  assert.equal(matchesSolo("vars.locals", "vars.*"), true);
  assert.equal(matchesSolo("vars.temps", "vars.*"), true);
  assert.equal(matchesSolo("defs.methods", "vars.*"), false);
  assert.equal(matchesSolo("defs.methods", null), false);
});

test("layersForSolo: single id and group", () => {
  assert.deepEqual(layersForSolo(ALL, "vars.locals"), ["vars.locals"]);
  assert.deepEqual(layersForSolo(ALL, "vars.*"), ["vars.ivars", "vars.locals", "vars.temps"]);
  assert.deepEqual(layersForSolo(ALL, null), []);
});

test("paintedLayerIds: solo overrides enabled set entirely", () => {
  const enabledIds = new Set(["defs.methods"]);
  assert.deepEqual(paintedLayerIds({ allIds: ALL, enabledIds, solo: "vars.locals" }), ["vars.locals"]);
  assert.deepEqual(paintedLayerIds({ allIds: ALL, enabledIds, solo: "vars.*" }), ["vars.ivars", "vars.locals", "vars.temps"]);
});

test("paintedLayerIds: no solo -> the enabled set", () => {
  const enabledIds = new Set(["defs.methods", "vars.locals"]);
  assert.deepEqual(paintedLayerIds({ allIds: ALL, enabledIds, solo: null }), ["defs.methods", "vars.locals"]);
});

test("cycleSolo: starts at first id when nothing soloed, for next and prev", () => {
  const sorted = [...ALL].sort();
  assert.equal(cycleSolo(ALL, null, 1), sorted[0]);
  assert.equal(cycleSolo(ALL, null, -1), sorted[0]);
});

test("cycleSolo: wraps forward and backward through sorted ids", () => {
  const sorted = [...ALL].sort();
  assert.equal(cycleSolo(ALL, sorted[0], 1), sorted[1]);
  assert.equal(cycleSolo(ALL, sorted[sorted.length - 1], 1), sorted[0]);
  assert.equal(cycleSolo(ALL, sorted[0], -1), sorted[sorted.length - 1]);
});

test("cycleSolo: a group solo value falls back to the first id", () => {
  const sorted = [...ALL].sort();
  assert.equal(cycleSolo(ALL, "vars.*", 1), sorted[0]);
});
