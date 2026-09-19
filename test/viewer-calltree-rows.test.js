import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildCallTree } from "../src/core/calltree.js";
import { groupCallTree, buildCallTreeRows, rowDepth, defaultExpandedIds } from "../src/viewer/calltree-rows.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "example-ruby", "layers.json"), "utf8"));
const trace = doc.trace;

test("Invoice#summary has one block ×2 group", () => {
  const root = buildCallTree(trace);
  const display = groupCallTree(root);
  const notify = display.children[1];
  const summary = notify.children[0];
  assert.equal(summary.kind, "call");
  assert.equal(summary.children.length, 1);
  const group = summary.children[0];
  assert.equal(group.kind, "blockGroup");
  assert.equal(group.blocks.length, 2);
  assert.equal(group.blocks[0].kind, "block");
  assert.equal(group.blocks[1].kind, "block");
});

test("buildCallTreeRows indexes every call/block node's enter to its row", () => {
  const root = buildCallTree(trace);
  const { rows, index } = buildCallTreeRows(root);

  const groupRow = rows.find((r) => r.kind === "blockGroup");
  assert.ok(groupRow);
  const [block1, block2] = groupRow.display.blocks;

  const entry1 = index.get(block1.node.enter);
  const entry2 = index.get(block2.node.enter);
  assert.equal(entry1.groupId, groupRow.id);
  assert.equal(entry2.groupId, groupRow.id);
  assert.equal(entry1.id, block1.id);
  assert.equal(entry2.id, block2.id);
  // the group id itself is never in an entry's auto-expand ancestors
  assert.ok(!entry1.ancestors.includes(groupRow.id));

  const summaryEntry = [...index.entries()].find(([, v]) => v.groupId === undefined && rows.find((r) => r.id === v.id)?.display.node.symbol === "Invoice#summary");
  assert.ok(summaryEntry);
});

test("row depth counts a block group as one extra level for its iterations", () => {
  const root = buildCallTree(trace);
  const { rows } = buildCallTreeRows(root);
  const groupRow = rows.find((r) => r.kind === "blockGroup");
  const iterRow = rows.find((r) => r.groupId === groupRow.id);
  assert.equal(rowDepth(iterRow), rowDepth(groupRow) + 1);
});

test("default expanded ids include root/notify/summary (depth <= 2) but not the block group (depth 3)", () => {
  const root = buildCallTree(trace);
  const { rows } = buildCallTreeRows(root);
  const ids = defaultExpandedIds(rows);
  const groupRow = rows.find((r) => r.kind === "blockGroup");
  assert.ok(ids.includes("root"));
  assert.ok(!ids.includes(groupRow.id));
});

function span(file, start, end) {
  return { file, start, end };
}

function makeNode(kind, overrides = {}) {
  return {
    kind,
    symbol: null,
    recv: null,
    enter: 0,
    exit: 0,
    site: null,
    def: span("a.rb", 0, 1),
    value: null,
    depth: 3,
    children: [],
    ...overrides,
  };
}

test("blocks from two different lines stay two groups", () => {
  const defA = span("a.rb", 10, 20);
  const defB = span("a.rb", 30, 40);
  const root = makeNode("root", {
    depth: 0,
    children: [
      makeNode("block", { enter: 1, exit: 2, def: defA }),
      makeNode("block", { enter: 3, exit: 4, def: defA }),
      makeNode("block", { enter: 5, exit: 6, def: defB }),
      makeNode("block", { enter: 7, exit: 8, def: defB }),
    ],
  });
  const display = groupCallTree(root);
  assert.equal(display.children.length, 2);
  assert.equal(display.children[0].kind, "blockGroup");
  assert.equal(display.children[0].blocks.length, 2);
  assert.equal(display.children[1].kind, "blockGroup");
  assert.equal(display.children[1].blocks.length, 2);
});

test("non-consecutive same-line blocks don't merge", () => {
  const defA = span("a.rb", 10, 20);
  const root = makeNode("root", {
    depth: 0,
    children: [
      makeNode("block", { enter: 1, exit: 2, def: defA }),
      makeNode("call", { enter: 3, exit: 4, symbol: "A#a" }),
      makeNode("block", { enter: 5, exit: 6, def: defA }),
    ],
  });
  const display = groupCallTree(root);
  assert.equal(display.children.length, 3);
  assert.equal(display.children[0].kind, "block");
  assert.equal(display.children[1].kind, "call");
  assert.equal(display.children[2].kind, "block");
});
