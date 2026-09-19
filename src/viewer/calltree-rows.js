// Pure transform: a src/core/calltree.js node tree -> a display tree + a flat row index,
// used by calltree-panel.js to render and to follow the stepper. No DOM, no imports beyond
// the core call tree shape.

function sameSpan(a, b) {
  return a.file === b.file && a.start === b.start && a.end === b.end;
}

// node -> { kind, node, children } ('root' | 'call' | 'block'), with runs of consecutive
// sibling BLOCK children sharing the same `def` span collapsed into
// { kind: 'blockGroup', def, depth, blocks: [...] } (blocks.length is always >= 2).
export function groupCallTree(node) {
  return { kind: node.kind, node, children: groupChildren(node.children) };
}

function groupChildren(children) {
  const out = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.kind === "block") {
      let j = i + 1;
      while (j < children.length && children[j].kind === "block" && sameSpan(children[j].def, child.def)) j++;
      const run = children.slice(i, j);
      if (run.length > 1) {
        out.push({ kind: "blockGroup", def: child.def, depth: child.depth, blocks: run.map(groupCallTree) });
      } else {
        out.push(groupCallTree(child));
      }
      i = j;
    } else {
      out.push(groupCallTree(child));
      i += 1;
    }
  }
  return out;
}

// Flattens a display tree into document-order rows plus a lookup from a raw call-tree
// node's `enter` index to its row: { id, ancestors, groupId? }. `ancestors` is the chain of
// auto-expandable row ids above this row (root/call/block rows) — a `blockGroup` id is never
// included, since a group is only ever expanded by an explicit click (docs/ROUND-3.md E).
function walk(node, ancestors, rows, index) {
  if (node.kind === "blockGroup") {
    const groupId = `g${node.blocks[0].node.enter}`;
    node.id = groupId;
    rows.push({ id: groupId, kind: "blockGroup", display: node, ancestors });
    node.blocks.forEach((b, i) => {
      const id = `n${b.node.enter}`;
      b.id = id;
      b.iterIndex = i + 1;
      index.set(b.node.enter, { id, ancestors, groupId });
      rows.push({ id, kind: "block", display: b, ancestors, groupId });
      for (const child of b.children) walk(child, [...ancestors, id], rows, index);
    });
    return;
  }
  const id = node.kind === "root" ? "root" : `n${node.node.enter}`;
  node.id = id;
  if (node.kind !== "root") index.set(node.node.enter, { id, ancestors });
  rows.push({ id, kind: node.kind, display: node, ancestors });
  for (const child of node.children) walk(child, [...ancestors, id], rows, index);
}

export function buildCallTreeRows(root) {
  const display = groupCallTree(root);
  const rows = [];
  const index = new Map();
  walk(display, [], rows, index);
  return { display, rows, index };
}

export function rowDepth(r) {
  return r.ancestors.length + (r.groupId ? 1 : 0);
}

function rowOwnDepth(r) {
  return r.kind === "blockGroup" ? r.display.depth : r.display.node.depth;
}

function rowHasChildren(r) {
  return r.kind === "blockGroup" ? r.display.blocks.length > 0 : r.display.children.length > 0;
}

// Default expand state: every row down to (call-tree) depth 2 is expanded, deeper collapsed
// (docs/ROUND-3.md E).
export function defaultExpandedIds(rows) {
  return rows.filter((r) => rowHasChildren(r) && rowOwnDepth(r) <= 2).map((r) => r.id);
}
