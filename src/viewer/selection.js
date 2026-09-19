// Pure, DOM-free selection logic: which marks are on, grouped as items for the layer tree.
// selection = Set<markKey>. markKey identifies one mark: "layer|file|startByte|endByte".

export function markKey(layerId, mark) {
  return `${layerId}|${mark.file}|${mark.start}|${mark.end}`;
}

export function parseMarkKey(key) {
  const [layer, file, start, end] = key.split("|");
  return { layer, file, start: Number(start), end: Number(end) };
}

function cmpMark(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start;
}

// Groups a layer's marks by symbol, in first-appearance order (sorted by file, start).
// Marks with symbol === null are each their own item.
export function itemsOfLayer(layer) {
  const marks = [...layer.marks].sort(cmpMark);
  const items = [];
  const bySymbol = new Map();
  for (const mark of marks) {
    const key = markKey(layer.id, mark);
    if (mark.symbol === null || mark.symbol === undefined) {
      items.push({ symbol: null, marks: [key] });
      continue;
    }
    let item = bySymbol.get(mark.symbol);
    if (!item) {
      item = { symbol: mark.symbol, marks: [] };
      bySymbol.set(mark.symbol, item);
      items.push(item);
    }
    item.marks.push(key);
  }
  return items;
}

// A layer starts unticked: dynamic layers (exec.*) always have, and now effects.* too
// (docs/ROUND-4.md "B. Web viewer") — they overlap other layers by design, so they'd
// otherwise clutter every file by default.
export function isDefaultOff(layer) {
  return layer.kind === "dynamic" || layer.id.startsWith("effects.");
}

// Default selection: every mark of every default-on layer, per isDefaultOff above.
export function defaultSelection(doc) {
  const keys = new Set();
  for (const layer of doc.layers) {
    if (isDefaultOff(layer)) continue;
    for (const mark of layer.marks) keys.add(markKey(layer.id, mark));
  }
  return keys;
}

export function checkState(selection, keys) {
  if (keys.length === 0) return "none";
  let on = 0;
  for (const key of keys) if (selection.has(key)) on++;
  if (on === 0) return "none";
  if (on === keys.length) return "all";
  return "some";
}

export function setKeys(selection, keys, on) {
  const next = new Set(selection);
  for (const key of keys) {
    if (on) next.add(key);
    else next.delete(key);
  }
  return next;
}

// Drops mark keys that no longer exist in doc (e.g. a stale localStorage value).
export function pruneSelection(selection, doc) {
  const known = new Set();
  for (const layer of doc.layers) {
    for (const mark of layer.marks) known.add(markKey(layer.id, mark));
  }
  const next = new Set();
  for (const key of selection) if (known.has(key)) next.add(key);
  return next;
}
