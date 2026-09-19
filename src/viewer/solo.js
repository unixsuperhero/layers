// DOM-free solo/focus-mode logic: which layer ids a solo value picks out, and cycling
// through layers with `]` / `[`.

export function sortedLayerIds(ids) {
  return [...ids].sort();
}

// solo is either a specific layer id ("vars.locals") or a namespace group ("vars.*").
export function matchesSolo(id, solo) {
  if (!solo) return false;
  if (solo.endsWith(".*")) return id.split(".")[0] === solo.slice(0, -2);
  return id === solo;
}

export function layersForSolo(allIds, solo) {
  if (!solo) return [];
  return allIds.filter((id) => matchesSolo(id, solo));
}

// Which layer ids get painted: soloed layers alone (ignoring checkbox state) when a solo
// is set, otherwise the enabled set.
export function paintedLayerIds({ allIds, enabledIds, solo }) {
  if (solo) return layersForSolo(allIds, solo);
  return allIds.filter((id) => enabledIds.has(id));
}

// Next/prev through the sorted layer ids. Starts at the first id when nothing is soloed,
// or when the current solo value (e.g. a namespace group) isn't a plain layer id.
export function cycleSolo(allIds, current, direction) {
  const sorted = sortedLayerIds(allIds);
  if (sorted.length === 0) return null;
  const idx = current === null ? -1 : sorted.indexOf(current);
  if (idx === -1) return sorted[0];
  return sorted[(idx + direction + sorted.length) % sorted.length];
}
