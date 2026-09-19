// Call Tree panel: renders buildCallTreeRows() output into `containerEl`, tracks expand
// state + the row that follows the stepper's cursor, and turns row clicks into
// host.onGoto(enterIndex) (docs/ROUND-3.md E).
import { frameAt } from "../core/calltree.js";
import { lineOfOffset } from "./marks-at.js";
import { buildCallTreeRows, rowDepth, defaultExpandedIds } from "./calltree-rows.js";

function fileLine(sources, offsets, span) {
  const line = lineOfOffset(sources[span.file], offsets[span.file].byteToChar(span.start));
  return `${span.file}:${line}`;
}

function enterExitOf(r) {
  if (r.kind === "blockGroup") {
    const blocks = r.display.blocks;
    return [blocks[0].node.enter, blocks[blocks.length - 1].node.exit];
  }
  return [r.display.node.enter, r.display.node.exit];
}

// symbol split into a dim namespace prefix + a bright name, same idea as the rail's item rows.
function appendSymbol(el, symbol) {
  const cut = Math.max(symbol.lastIndexOf("#"), symbol.lastIndexOf("."), symbol.lastIndexOf("/")) + 1;
  const ns = document.createElement("span");
  ns.className = "ct-symbol-ns";
  ns.textContent = symbol.slice(0, cut);
  const name = document.createElement("span");
  name.className = "ct-symbol-name";
  name.textContent = symbol.slice(cut);
  el.append(ns, name);
}

// host: { containerEl, sources, offsets, trace, onGoto(enterIndex) }
export function createCallTreePanel(root, host) {
  const { containerEl, sources, offsets, trace, onGoto } = host;
  const { rows, index } = buildCallTreeRows(root);
  const expanded = new Set(defaultExpandedIds(rows));
  let activeId = null;
  let lastCursor = null;

  function isRaised(node) {
    if (node.value !== null) return false;
    if (node.exit !== trace.length - 1) return false;
    for (let i = node.enter; i <= node.exit; i++) if (trace[i].event === "raise") return true;
    return false;
  }

  function labelOf(r) {
    if (r.kind === "root") return r.display.node.def.file;
    if (r.kind === "blockGroup") return `block ×${r.display.blocks.length}`;
    if (r.kind === "block") return r.groupId ? `#${r.display.iterIndex}` : "block";
    return r.display.node.symbol ?? "(block)";
  }

  function metaOf(r) {
    if (r.kind === "root") return "(top level)";
    if (r.kind === "blockGroup") return fileLine(sources, offsets, r.display.def);
    if (r.kind === "block") return fileLine(sources, offsets, r.display.node.def);
    const node = r.display.node;
    const def = fileLine(sources, offsets, node.def);
    return node.site ? `${fileLine(sources, offsets, node.site)} → ${def}` : def;
  }

  function valueOf(r) {
    if (r.kind !== "call") return null;
    const node = r.display.node;
    if (node.value !== null && node.value !== undefined) return node.value;
    return isRaised(node) ? "(raised)" : null;
  }

  function visible(r) {
    for (const a of r.ancestors) if (!expanded.has(a)) return false;
    if (r.groupId && !expanded.has(r.groupId)) return false;
    return true;
  }

  function hasChildren(r) {
    return r.kind === "blockGroup" ? r.display.blocks.length > 0 : r.display.children.length > 0;
  }

  function resolveActiveId(cursor) {
    const frame = frameAt(root, cursor);
    if (frame.kind === "root") return "root";
    const entry = index.get(frame.enter);
    if (!entry) return null;
    for (const a of entry.ancestors) expanded.add(a);
    return entry.groupId && !expanded.has(entry.groupId) ? entry.groupId : entry.id;
  }

  function renderRow(r) {
    const el = document.createElement("div");
    el.className = `ct-row ct-${r.kind}` + (r.id === activeId ? " active" : "");
    el.dataset.rowId = r.id;
    el.style.paddingLeft = `${rowDepth(r) * 14 + 4}px`;
    const [enter, exit] = enterExitOf(r);
    el.title = `events [${enter}…${exit}]`;

    const caret = document.createElement("button");
    caret.type = "button";
    const expandable = hasChildren(r);
    caret.className = "tree-caret" + (expandable ? "" : " empty");
    caret.disabled = !expandable;
    if (expandable) {
      caret.textContent = expanded.has(r.id) ? "▾" : "▸";
      caret.addEventListener("click", (e) => {
        e.stopPropagation();
        if (expanded.has(r.id)) expanded.delete(r.id);
        else expanded.add(r.id);
        if (lastCursor !== null) activeId = resolveActiveId(lastCursor);
        render();
        scrollActiveIntoView();
      });
    }

    const body = document.createElement("div");
    body.className = "ct-body";
    body.addEventListener("click", () => onGoto(enter));

    const line1 = document.createElement("div");
    line1.className = "ct-line1";
    const symbolEl = document.createElement("span");
    symbolEl.className = "ct-symbol";
    if (r.kind === "call") appendSymbol(symbolEl, labelOf(r));
    else symbolEl.textContent = labelOf(r);
    line1.appendChild(symbolEl);
    const value = valueOf(r);
    if (value !== null) {
      const valueEl = document.createElement("span");
      valueEl.className = "ct-value";
      valueEl.textContent = `⇒ ${value}`;
      valueEl.title = value;
      line1.appendChild(valueEl);
    }
    body.appendChild(line1);

    const meta = document.createElement("div");
    meta.className = "ct-meta";
    meta.textContent = metaOf(r);
    body.appendChild(meta);

    el.append(caret, body);
    return el;
  }

  function render() {
    containerEl.innerHTML = "";
    for (const r of rows) {
      if (!visible(r)) continue;
      containerEl.appendChild(renderRow(r));
    }
  }

  function scrollActiveIntoView() {
    const el = activeId && containerEl.querySelector(`[data-row-id="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  function follow(cursor) {
    lastCursor = cursor;
    activeId = resolveActiveId(cursor);
    render();
    scrollActiveIntoView();
  }

  function debugRows() {
    return rows
      .filter(visible)
      .map((r) => {
        const [enter, exit] = enterExitOf(r);
        return { id: r.id, label: labelOf(r), enter, exit, depth: rowDepth(r), active: r.id === activeId };
      });
  }

  function debugGoto(id) {
    const r = rows.find((x) => x.id === id);
    if (r) onGoto(enterExitOf(r)[0]);
  }

  return { render, follow, rows: debugRows, goto: debugGoto };
}
