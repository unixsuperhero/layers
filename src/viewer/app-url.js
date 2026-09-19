// URL state (docs/VIEWER.md "URL state"): ?project=&file=&i=&solo=&scene=&focus=, kept in
// sync via history.replaceState. Pure param parsing/building here; the actual
// history.replaceState call is the only DOM touch, done by syncURL.

export function parseAppParams(search) {
  const params = new URLSearchParams(search);
  return {
    project: params.get("project"),
    file: params.get("file"),
    i: params.get("i"),
    solo: params.get("solo"),
    focus: params.get("focus"),
    scene: params.get("scene"),
  };
}

// state: { project (nullable — omitted for a bundle not loaded via ?project=), file,
// i (nullable), sceneIndex (1-based, nullable), solo (id, nullable), focus (boolean) }.
// `scene` takes precedence over `solo` (docs/SELECTION-AND-SCENES.md Part B).
export function buildAppQuery(state) {
  const params = new URLSearchParams();
  if (state.project) params.set("project", state.project);
  if (state.file) params.set("file", state.file);
  if (state.i !== null && state.i !== undefined) params.set("i", String(state.i));
  if (state.sceneIndex !== null && state.sceneIndex !== undefined) params.set("scene", String(state.sceneIndex));
  else if (state.solo) params.set("solo", state.solo);
  if (state.focus) params.set("focus", "1");
  return params.toString();
}

export function syncURL(state) {
  history.replaceState(null, "", `?${buildAppQuery(state)}`);
}
