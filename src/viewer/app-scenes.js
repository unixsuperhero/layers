// Scenes wiring (docs/SELECTION-AND-SCENES.md Part B): owns `presentation`, the active scene
// id, the "pin step" toggle, and every scene CRUD/activation operation. DOM is scenes-panel.js;
// pure scene-list logic is scenes.js. main.js supplies the cross-cutting pieces (painting,
// rail state, the stepper, syncing the URL) via `host`.
import { addScene, duplicateScene, moveScene, renameScene, updateScene, removeScene, cycleScene, parsePresentation } from "./scenes.js";
import { createScenesPanel } from "./scenes-panel.js";

export const presentationStorageKey = (storageKey) => `layers:${storageKey}:presentation`;

function loadStoredPresentation(storageKey, doc) {
  try {
    const raw = localStorage.getItem(presentationStorageKey(storageKey));
    if (!raw) return null;
    return parsePresentation(JSON.parse(raw), doc).presentation;
  } catch {
    return null;
  }
}

// A 404, or the dev server's SPA fallback (HTML instead of JSON), both mean "no presentation
// file" — never an error.
async function fetchPresentationFile(projectDir) {
  try {
    const res = await fetch(`/${projectDir}/presentation.json`);
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

// projectDir is null for a bundle not loaded via ?project= (e.g. Import/Open…) — there is
// nothing on disk to fetch a presentation.json from in that case.
export async function loadInitialPresentation(storageKey, projectDir, doc) {
  const stored = loadStoredPresentation(storageKey, doc);
  if (stored) return stored;
  const fetched = projectDir ? await fetchPresentationFile(projectDir) : null;
  if (!fetched) return { version: 1, scenes: [] };
  try {
    return parsePresentation(fetched, doc).presentation;
  } catch {
    return { version: 1, scenes: [] };
  }
}

// host: { doc, project, storageKey, editor, sources,
//   getActiveFile(), openFileSilent(file) — switches file/editor/tabs without painting,
//   paintFile(file), renderRail(), renderChip(), syncURL(),
//   rail: { get selection(), get solo(), setSoloNode(node|null) },
//   stepper: stepperController | null }
export function createScenesController(initialPresentation, host, { initialActiveSceneId = null } = {}) {
  let presentation = initialPresentation;
  let activeSceneId = initialActiveSceneId;
  let pinStep = false;
  let message = null;

  function persist() {
    try {
      localStorage.setItem(presentationStorageKey(host.storageKey), JSON.stringify(presentation));
    } catch {
      // ignore
    }
  }

  function activeScene() {
    return activeSceneId ? presentation.scenes.find((s) => s.id === activeSceneId) : null;
  }

  // Exactly what is painted right now (selection, or the solo override) across ALL files —
  // grouped by real layer id, "selected ones, else the whole layer" per group (the
  // project-wide analogue of the per-file solo fallback, docs/VIEWER.md "Deviations").
  function currentPaintedKeys() {
    const { selection, solo } = host.rail;
    if (!solo) return [...selection];
    const byLayer = new Map();
    for (const key of solo.keys) {
      const layerId = key.split("|")[0];
      if (!byLayer.has(layerId)) byLayer.set(layerId, []);
      byLayer.get(layerId).push(key);
    }
    const keys = [];
    for (const layerKeys of byLayer.values()) {
      const selected = layerKeys.filter((k) => selection.has(k));
      keys.push(...(selected.length > 0 ? selected : layerKeys));
    }
    return keys;
  }

  function captureView() {
    return { file: host.getActiveFile(), marks: currentPaintedKeys() };
  }

  function render() {
    scenesPanel.render({ presentation, activeId: activeSceneId, message, pinStep });
  }

  function defaultSceneName() {
    return `Scene ${presentation.scenes.length + 1}`;
  }

  function addFromView(name, { pinStep: pinStepOverride } = {}) {
    const usePinStep = pinStepOverride ?? pinStep;
    const { file, marks } = captureView();
    const step = usePinStep && host.stepper ? host.stepper.cursor : null;
    presentation = addScene(presentation, { name, file, marks, step });
    persist();
    render();
  }

  function duplicateById(id) {
    presentation = duplicateScene(presentation, id);
    persist();
    render();
    host.renderChip();
  }

  function moveById(id, toIndex) {
    presentation = moveScene(presentation, id, toIndex);
    persist();
    render();
    host.renderChip();
  }

  function renameById(id, name) {
    presentation = renameScene(presentation, id, name);
    persist();
    render();
    host.renderChip();
  }

  function updateById(id) {
    const { file, marks } = captureView();
    const step = pinStep && host.stepper ? host.stepper.cursor : null;
    presentation = updateScene(presentation, id, { file, marks, step });
    persist();
    if (id === activeSceneId) host.paintFile(host.getActiveFile());
    render();
  }

  function loadById(id) {
    const scene = presentation.scenes.find((s) => s.id === id);
    if (scene) host.setSelection(new Set(scene.marks));
  }

  function removeById(id) {
    presentation = removeScene(presentation, id);
    persist();
    if (activeSceneId === id) activate(null);
    else render();
  }

  // Raw activation setter: paints scene.marks as a strong override (or clears the override
  // for id === null), opens scene.file, and goes to scene.step through the stepper's own
  // goto path. Does NOT touch `selection`. Mutually exclusive with solo.
  function activate(id) {
    const scene = id ? presentation.scenes.find((s) => s.id === id) : null;
    activeSceneId = scene ? scene.id : null;
    if (scene) host.rail.setSoloNode(null);

    const activeFile = host.getActiveFile();
    const nextFile = scene?.file && host.project.files.includes(scene.file) ? scene.file : activeFile;
    if (nextFile !== activeFile) host.openFileSilent(nextFile);

    host.paintFile(host.getActiveFile());
    host.renderRail();
    host.renderChip();
    render();
    if (scene && scene.step !== null && host.stepper) host.stepper.goto(scene.step);
    host.syncURL();
  }

  function toggle(id) {
    activate(activeSceneId === id ? null : id);
  }

  function cycle(direction) {
    activate(cycleScene(presentation, activeSceneId, direction));
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        const { presentation: parsed, dropped } = parsePresentation(json, host.doc);
        presentation = parsed;
        if (activeSceneId && !parsed.scenes.some((s) => s.id === activeSceneId)) activeSceneId = null;
        persist();
        message = { type: "info", text: `imported ${parsed.scenes.length} scenes, dropped ${dropped} unknown marks` };
      } catch (err) {
        message = { type: "error", text: err.message };
      }
      host.paintFile(host.getActiveFile());
      host.renderRail();
      host.renderChip();
      render();
      host.syncURL();
    };
    reader.readAsText(file);
  }

  const scenesPanel = createScenesPanel(host.scenesPanelEl, {
    onAddFromView: () => addFromView(defaultSceneName()),
    onTogglePinStep: (on) => {
      pinStep = on;
    },
    onActivate: toggle,
    onRename: renameById,
    onDuplicate: duplicateById,
    onUpdate: updateById,
    onLoad: loadById,
    onRemove: removeById,
    onMove: moveById,
    onImportFile: importFile,
  });

  return {
    get presentation() {
      return presentation;
    },
    get activeSceneId() {
      return activeSceneId;
    },
    activeScene,
    render,
    addFromView,
    duplicateById,
    moveById,
    renameById,
    updateById,
    loadById,
    removeById,
    activate,
    toggle,
    cycle,
    importFile,
  };
}
