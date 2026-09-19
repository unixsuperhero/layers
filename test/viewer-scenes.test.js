import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addScene,
  duplicateScene,
  moveScene,
  renameScene,
  updateScene,
  removeScene,
  cycleScene,
  parsePresentation,
} from "../src/viewer/scenes.js";

const K1 = "defs.methods|invoice.rb|97|107";
const K2 = "defs.methods|invoice.rb|147|154";
const K3 = "defs.methods|mailer.rb|47|53";

function presentation(scenes = []) {
  return { version: 1, scenes };
}

const DOC = {
  layers: [
    {
      id: "defs.methods",
      marks: [
        { file: "invoice.rb", start: 97, end: 107 },
        { file: "invoice.rb", start: 147, end: 154 },
        { file: "mailer.rb", start: 47, end: 53 },
      ],
    },
  ],
};

test("addScene appends with a deterministic next id, defaulting file/step to null", () => {
  const p0 = presentation();
  const p1 = addScene(p0, { name: "A", marks: [K1] });
  assert.equal(p1.scenes.length, 1);
  assert.deepEqual(p1.scenes[0], { id: "s1", name: "A", file: null, marks: [K1], step: null });
  assert.deepEqual(p0.scenes, []); // immutable

  const p2 = addScene(p1, { name: "B", file: "invoice.rb", marks: [K2], step: 5 });
  assert.deepEqual(p2.scenes[1], { id: "s2", name: "B", file: "invoice.rb", marks: [K2], step: 5 });
});

test("addScene picks the next free id given the existing list (not random)", () => {
  const p0 = presentation([
    { id: "s1", name: "A", file: null, marks: [], step: null },
    { id: "s3", name: "C", file: null, marks: [], step: null },
  ]);
  const p1 = addScene(p0, { name: "D", marks: [] });
  assert.equal(p1.scenes[2].id, "s4");
});

test("duplicateScene inserts right after the source with a ' copy' suffix and a fresh id", () => {
  const p0 = presentation([
    { id: "s1", name: "First", file: "invoice.rb", marks: [K1], step: 3 },
    { id: "s2", name: "Second", file: null, marks: [K2], step: null },
  ]);
  const p1 = duplicateScene(p0, "s1");
  assert.equal(p1.scenes.length, 3);
  assert.equal(p1.scenes[0].id, "s1");
  assert.equal(p1.scenes[1].id, "s3");
  assert.equal(p1.scenes[1].name, "First copy");
  assert.deepEqual(p1.scenes[1].marks, [K1]);
  assert.equal(p1.scenes[1].step, 3);
  assert.equal(p1.scenes[2].id, "s2");
  assert.deepEqual(p0.scenes.map((s) => s.id), ["s1", "s2"]); // immutable

  // marks array is copied, not shared
  const dup = p1.scenes[1];
  assert.notEqual(dup.marks, p0.scenes[0].marks);
});

test("duplicateScene is a no-op for an unknown id", () => {
  const p0 = presentation([{ id: "s1", name: "A", file: null, marks: [], step: null }]);
  assert.deepEqual(duplicateScene(p0, "nope"), p0);
});

test("moveScene reorders and clamps out-of-range indices", () => {
  const p0 = presentation([
    { id: "s1", name: "A", file: null, marks: [], step: null },
    { id: "s2", name: "B", file: null, marks: [], step: null },
    { id: "s3", name: "C", file: null, marks: [], step: null },
  ]);
  assert.deepEqual(moveScene(p0, "s3", 0).scenes.map((s) => s.id), ["s3", "s1", "s2"]);
  assert.deepEqual(moveScene(p0, "s1", 99).scenes.map((s) => s.id), ["s2", "s3", "s1"]);
  assert.deepEqual(moveScene(p0, "s1", -99).scenes.map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(moveScene(p0, "nope", 0), p0);
});

test("renameScene renames only the target scene, immutably", () => {
  const p0 = presentation([
    { id: "s1", name: "A", file: null, marks: [], step: null },
    { id: "s2", name: "B", file: null, marks: [], step: null },
  ]);
  const p1 = renameScene(p0, "s2", "Renamed");
  assert.equal(p1.scenes[0].name, "A");
  assert.equal(p1.scenes[1].name, "Renamed");
  assert.equal(p0.scenes[1].name, "B");
});

test("updateScene overwrites file/marks/step, tolerating null file and null step", () => {
  const p0 = presentation([{ id: "s1", name: "A", file: "invoice.rb", marks: [K1], step: 3 }]);
  const p1 = updateScene(p0, "s1", { file: null, marks: [K2, K3], step: null });
  assert.deepEqual(p1.scenes[0], { id: "s1", name: "A", file: null, marks: [K2, K3], step: null });
});

test("removeScene drops the scene, immutably", () => {
  const p0 = presentation([
    { id: "s1", name: "A", file: null, marks: [], step: null },
    { id: "s2", name: "B", file: null, marks: [], step: null },
  ]);
  const p1 = removeScene(p0, "s1");
  assert.deepEqual(p1.scenes.map((s) => s.id), ["s2"]);
  assert.deepEqual(p0.scenes.map((s) => s.id), ["s1", "s2"]);
});

test("cycleScene wraps forward and backward, including from 'none active'", () => {
  const p = presentation([
    { id: "s1", name: "A", file: null, marks: [], step: null },
    { id: "s2", name: "B", file: null, marks: [], step: null },
    { id: "s3", name: "C", file: null, marks: [], step: null },
  ]);
  assert.equal(cycleScene(p, null, 1), "s1");
  assert.equal(cycleScene(p, null, -1), "s3");
  assert.equal(cycleScene(p, "s1", 1), "s2");
  assert.equal(cycleScene(p, "s3", 1), "s1");
  assert.equal(cycleScene(p, "s1", -1), "s3");
});

test("cycleScene returns null when the list is empty", () => {
  assert.equal(cycleScene(presentation(), null, 1), null);
  assert.equal(cycleScene(presentation(), "s1", 1), null);
});

test("parsePresentation: throws on bad shape", () => {
  assert.throws(() => parsePresentation(null, DOC));
  assert.throws(() => parsePresentation({}, DOC));
  assert.throws(() => parsePresentation({ version: 2, scenes: [] }, DOC));
  assert.throws(() => parsePresentation({ version: 1, scenes: "nope" }, DOC));
  assert.throws(() => parsePresentation({ version: 1, scenes: [{ id: "s1" }] }, DOC));
  assert.throws(() => parsePresentation({ version: 1, scenes: [{ id: "s1", name: "A", marks: "nope" }] }, DOC));
});

test("parsePresentation: drops unknown mark keys and reports the count", () => {
  const json = {
    version: 1,
    scenes: [{ id: "s1", name: "A", file: "invoice.rb", marks: [K1, "gone.layer|invoice.rb|0|1", K2, "also.gone|x|0|1"], step: null }],
  };
  const { presentation: p, dropped } = parsePresentation(json, DOC);
  assert.equal(dropped, 2);
  assert.deepEqual(p.scenes[0].marks, [K1, K2]);
});

test("parsePresentation: tolerates step: null / file: null (and missing)", () => {
  const json = {
    version: 1,
    scenes: [
      { id: "s1", name: "A", marks: [] },
      { id: "s2", name: "B", file: null, marks: [], step: null },
    ],
  };
  const { presentation: p, dropped } = parsePresentation(json, DOC);
  assert.equal(dropped, 0);
  assert.equal(p.scenes[0].file, null);
  assert.equal(p.scenes[0].step, null);
  assert.equal(p.scenes[1].file, null);
  assert.equal(p.scenes[1].step, null);
});
