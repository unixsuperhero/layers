// Rail wiring: selection/expanded/solo/focus state, persistence, and solo/focus resolution
// for the Layers rail v2 (docs/ROUND-3.md "D"). DOM rendering itself lives in panels.js
// (renderRailPanel); this module owns state + glue so main.js only wires it to the editor.
import { buildRailTree, resolveSoloId } from "./rail-tree.js";
import { defaultSelection, setKeys, pruneSelection } from "./selection.js";
import { cycleSolo } from "./solo.js";

const storageKey = (projectDir) => `layers:${projectDir}:rail`;

const VERDICT_FILTERS = ["all", "impure", "pure", "unknown"];

function loadStored(projectDir, doc) {
  try {
    const raw = localStorage.getItem(storageKey(projectDir));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      selection: pruneSelection(new Set(parsed.selection ?? []), doc),
      expanded: new Set(parsed.expanded ?? []),
      focus: !!parsed.focus,
      filters: new Map(Object.entries(parsed.filters ?? {})),
    };
  } catch {
    return null;
  }
}

// projectDir, doc: as elsewhere. initialFile: the file the viewer opens with (drives the
// default-open accordion + the initial tree's visibleFiles).
export function createRail(projectDir, doc, initialFile) {
  const allLayerIds = doc.layers.map((l) => l.id);
  const stored = loadStored(projectDir, doc);

  // Default open state (docs/ROUND-3.md D): ALL FILES open, its namespace groups open too
  // (today's rail always showed every layer row) — the visible file's accordion open with
  // Whole file and its methods collapsed.
  const defaultExpanded = (file) => {
    const namespaces = new Set(doc.layers.map((l) => l.id.split(".")[0]));
    return new Set(["all", ...[...namespaces].map((ns) => `all/${ns}.*`), `file/${file}`]);
  };

  let selection = stored ? stored.selection : defaultSelection(doc);
  let expanded = stored ? stored.expanded : defaultExpanded(initialFile);
  let focus = stored ? stored.focus : false;
  let filters = stored ? stored.filters : new Map(); // file -> "all" | "impure" | "pure" | "unknown"
  let solo = null; // never persisted (URL-only, like today)
  let visibleFiles = [initialFile];
  let tree = buildRailTree(doc, visibleFiles);

  function persist() {
    try {
      localStorage.setItem(
        storageKey(projectDir),
        JSON.stringify({ selection: [...selection], expanded: [...expanded], focus, filters: Object.fromEntries(filters) }),
      );
    } catch {
      // ignore (private browsing, quota, etc.)
    }
  }

  function setSelection(next) {
    selection = next;
    persist();
  }

  function toggleKeys(keys, on) {
    setSelection(setKeys(selection, keys, on));
  }

  function reset() {
    selection = defaultSelection(doc);
    expanded = defaultExpanded(visibleFiles[0]);
    filters = new Map();
    try {
      localStorage.removeItem(storageKey(projectDir));
    } catch {
      // ignore
    }
  }

  function getFilter(file) {
    return filters.get(file) ?? "all";
  }

  function setFilter(file, value) {
    if (!VERDICT_FILTERS.includes(value)) return;
    if (value === "all") filters.delete(file);
    else filters.set(file, value);
    persist();
  }

  function toggleExpanded(id) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    persist();
  }

  // Rebuilds the tree for a new open file; the per-file accordion "follows" the open file
  // by always appearing open for it (docs/ROUND-3.md D).
  function openFile(file) {
    visibleFiles = [file];
    tree = buildRailTree(doc, visibleFiles);
    expanded.add(`file/${file}`);
    persist();
  }

  function setSoloNode(node) {
    solo = node ? { id: node.id, label: node.label, keys: node.keys } : null;
  }

  function toggleSoloNode(node) {
    setSoloNode(node && solo?.id === node.id ? null : node);
  }

  // Accepts a node-path id or a legacy plain layer id / "ns.*" group id (or null).
  function setSoloId(id) {
    solo = resolveSoloId(tree, doc, allLayerIds, id);
  }

  // "]" / "[" with no scenes keep cycling the All Files layers (legacy behaviour); resumes
  // from the current solo only when it is itself a plain layer id.
  function soloCycle(direction) {
    const current = solo && allLayerIds.includes(solo.id) ? solo.id : null;
    setSoloId(cycleSolo(allLayerIds, current, direction));
  }

  function setFocus(value) {
    focus = value;
    persist();
  }

  return {
    get selection() {
      return selection;
    },
    get expanded() {
      return expanded;
    },
    get solo() {
      return solo;
    },
    get focus() {
      return focus;
    },
    get tree() {
      return tree;
    },
    setSelection,
    toggleKeys,
    reset,
    toggleExpanded,
    openFile,
    setSoloNode,
    toggleSoloNode,
    setSoloId,
    soloCycle,
    setFocus,
    getFilter,
    setFilter,
  };
}
