export function merge(docs) {
  const files = {};
  for (const doc of docs) {
    for (const [path, info] of Object.entries(doc.files)) {
      const existing = files[path];
      if (existing && existing.sha !== info.sha) {
        throw new Error(`file "${path}" has conflicting sha across docs`);
      }
      files[path] = info;
    }
  }

  const layersById = new Map();
  for (const doc of docs) {
    for (const layer of doc.layers) {
      const existing = layersById.get(layer.id);
      if (!existing) {
        layersById.set(layer.id, {
          id: layer.id,
          kind: layer.kind,
          producer: layer.producer,
          marks: [...layer.marks],
        });
        continue;
      }
      if (existing.kind !== layer.kind || existing.producer !== layer.producer) {
        throw new Error(`layer "${layer.id}" has conflicting kind/producer across docs`);
      }
      existing.marks.push(...layer.marks);
    }
  }

  const layers = [...layersById.values()]
    .map((layer) => ({ ...layer, marks: dedupeMarks(layer.marks).sort(compareMarks) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const traces = docs.map((doc) => doc.trace ?? []).filter((trace) => trace.length > 0);
  if (traces.length > 1) {
    throw new Error("at most one input doc may carry a non-empty trace");
  }

  const result = { version: 1, files, layers };
  if (traces.length === 1) {
    result.trace = traces[0];
  }
  return result;
}

function dedupeMarks(marks) {
  const seen = new Set();
  const result = [];
  for (const mark of marks) {
    const key = JSON.stringify(mark);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(mark);
  }
  return result;
}

function compareMarks(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.start !== b.start) return a.start - b.start;
  if (a.end !== b.end) return a.end - b.end;
  const as = a.symbol ?? "";
  const bs = b.symbol ?? "";
  if (as !== bs) return as < bs ? -1 : 1;
  return 0;
}
