function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function flatten(marks) {
  const active = marks
    .map((m, idx) => ({ start: m.start, end: m.end, layer: m.layer, idx }))
    .filter((m) => m.start < m.end);

  if (active.length === 0) return [];

  const boundarySet = new Set();
  for (const m of active) {
    boundarySet.add(m.start);
    boundarySet.add(m.end);
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);

  const segments = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    const covering = active.filter((m) => m.start <= segStart && m.end >= segEnd);
    if (covering.length === 0) continue;

    const markIdxs = covering.map((m) => m.idx).sort((a, b) => a - b);
    const layerIds = [...new Set(covering.map((m) => m.layer))].sort();
    segments.push({ start: segStart, end: segEnd, layers: layerIds, marks: markIdxs });
  }

  const merged = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.end === seg.start && arraysEqual(last.marks, seg.marks)) {
      last.end = seg.end;
    } else {
      merged.push(seg);
    }
  }

  return merged;
}
