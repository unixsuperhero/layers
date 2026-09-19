import { loadProject } from "./load.js";
import { createEditor } from "./editor.js";
import { createNav, decideJump } from "./nav.js";
import { assignPalette } from "./palette.js";
import { marksAtPosition, innermostSymbol } from "./marks-at.js";
import { diffLocals } from "./locals-diff.js";
import { markKey, setKeys } from "./selection.js";
import { createRail } from "./rail.js";
import { wireRailResize } from "./resize.js";
import { addScene, duplicateScene, moveScene, renameScene, updateScene, removeScene, cycleScene, parsePresentation } from "./scenes.js";
import { createScenesPanel } from "./scenes-panel.js";
import { flatten } from "../core/flatten.js";
import { createStepper } from "../core/stepper.js";
import {
  buildLayout,
  wireRightSections,
  renderFileList,
  renderFileTabs,
  renderRailPanel,
  renderSymbolPanel,
  renderStepperPanel,
  layerStylesheet,
} from "./panels.js";

const DEFAULT_PROJECT = "fixtures/example-ruby";

const presentationStorageKey = (projectDir) => `layers:${projectDir}:presentation`;

function loadStoredPresentation(projectDir, doc) {
  try {
    const raw = localStorage.getItem(presentationStorageKey(projectDir));
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

async function loadInitialPresentation(projectDir, doc) {
  const stored = loadStoredPresentation(projectDir, doc);
  if (stored) return stored;
  const fetched = await fetchPresentationFile(projectDir);
  if (!fetched) return { version: 1, scenes: [] };
  try {
    return parsePresentation(fetched, doc).presentation;
  } catch {
    return { version: 1, scenes: [] };
  }
}

const STEP_KEYS = {
  ArrowLeft: "prev",
  k: "prev",
  ArrowRight: "next",
  j: "next",
  n: "stepOver",
  p: "stepBackOver",
  o: "stepOut",
  Home: "first",
  End: "last",
};

function renderError(app, errors) {
  app.innerHTML = "";
  const box = document.createElement("div");
  box.className = "error-screen";
  const h1 = document.createElement("h1");
  h1.textContent = "layers.json failed validation";
  box.appendChild(h1);
  const list = document.createElement("ul");
  for (const e of errors) {
    const li = document.createElement("li");
    li.textContent = `${e.path || "/"}: ${e.message}`;
    list.appendChild(li);
  }
  box.appendChild(list);
  app.appendChild(box);
}

function injectStylesheet(css) {
  const style = document.createElement("style");
  style.id = "lyr-generated";
  style.textContent = css;
  document.head.appendChild(style);
}

function boot(
  app,
  projectDir,
  { project, doc, sources, offsets, index },
  requestedFile,
  requestedI,
  requestedSolo,
  requestedFocus,
  initialPresentation,
  requestedScene,
) {
  const colours = assignPalette(doc.layers.map((l) => l.id));
  injectStylesheet(layerStylesheet(doc.layers, colours));

  const layout = buildLayout(app);
  wireRightSections(app, projectDir);

  const marksByKey = new Map();
  for (const layer of doc.layers) {
    for (const mark of layer.marks) marksByKey.set(markKey(layer.id, mark), { ...mark, layer: layer.id });
  }

  const initialFile = project.files.includes(requestedFile) ? requestedFile : project.files[0];
  const rail = createRail(projectDir, doc, initialFile);

  wireRailResize(document.documentElement, { railHandle: layout.railResizeEl, rightHandle: layout.rightResizeEl }, projectDir);

  let presentation = initialPresentation;
  let scenesMessage = null;
  let pinStep = false;

  function persistPresentation() {
    try {
      localStorage.setItem(presentationStorageKey(projectDir), JSON.stringify(presentation));
    } catch {
      // ignore
    }
  }

  // `&scene=` takes precedence over `&solo=` (docs/SELECTION-AND-SCENES.md Part B).
  const sceneIdx = requestedScene !== null ? Number(requestedScene) : null;
  let activeSceneId = Number.isInteger(sceneIdx) && presentation.scenes[sceneIdx - 1] ? presentation.scenes[sceneIdx - 1].id : null;
  if (!activeSceneId && requestedSolo) rail.setSoloId(requestedSolo);
  if (requestedFocus === "1") rail.setFocus(true);

  let activeFile = initialFile;
  if (activeSceneId) {
    const scene = presentation.scenes.find((s) => s.id === activeSceneId);
    if (scene.file && project.files.includes(scene.file)) activeFile = scene.file;
  }
  let selectedSymbol = null;
  let clickableMarks = []; // char-offset marks of ALL non-exec layers — clicks work whether or not a layer is painted

  const stepper = doc.trace && doc.trace.length ? createStepper(doc.trace) : null;
  // Stepper starts driving the editor (file switches, decoration, URL `i=`) only once the
  // user interacts with it, or `i=` was present on load — so the default view is unchanged.
  let stepperActive = false;
  let lastStepperLocals = null;

  if (stepper && requestedI !== null) {
    const i = Number(requestedI);
    if (Number.isInteger(i)) {
      stepper.goto(i);
      stepperActive = true;
      activeFile = stepper.current().file;
    }
  }

  if (stepper && activeSceneId) {
    const scene = presentation.scenes.find((s) => s.id === activeSceneId);
    if (scene.step !== null) {
      stepper.goto(scene.step);
      stepperActive = true;
      activeFile = stepper.current().file;
    }
  }

  const editor = createEditor(layout.editorEl, { onClick: handleClick });
  const nav = createNav({ index, onNavigate });

  function onNavigate({ file, pos }) {
    if (file !== activeFile) openFile(file);
    editor.scrollTo(pos.start, pos.end);
  }

  function computeClickableMarks(file) {
    const marks = [];
    for (const layer of doc.layers) {
      if (layer.id.startsWith("exec.")) continue; // exec is line-level, not clickable inline
      for (const mark of layer.marks) {
        if (mark.file !== file) continue;
        marks.push({
          start: offsets[file].byteToChar(mark.start),
          end: offsets[file].byteToChar(mark.end),
          symbol: mark.symbol,
          role: mark.role,
          layer: layer.id,
          key: markKey(layer.id, mark),
        });
      }
    }
    return marks;
  }

  function paintSelection() {
    if (!selectedSymbol) {
      editor.setSelectionDecorations([]);
      return;
    }
    const ranges = clickableMarks
      .filter((m) => m.symbol === selectedSymbol)
      .map((m) => ({ start: m.start, end: m.end }));
    editor.setSelectionDecorations(ranges);
  }

  // Which of a set of file-scoped marks get painted: only selected ones, unless the
  // override's key set intersects nothing selected (e.g. a soloed layer fully off) — then
  // paint the whole override set instead (see docs/SELECTION-AND-SCENES.md, Part A "Painting").
  function selectMarksToPaint(marksInFile, overrideKeys) {
    if (!overrideKeys) return marksInFile.filter((m) => rail.selection.has(m.key));
    const inOverride = marksInFile.filter((m) => overrideKeys.has(m.key));
    const selectedInOverride = inOverride.filter((m) => rail.selection.has(m.key));
    return selectedInOverride.length > 0 ? selectedInOverride : inOverride;
  }

  function activeScene() {
    return activeSceneId ? presentation.scenes.find((s) => s.id === activeSceneId) : null;
  }

  // Precedence: an active scene > a name-click solo > Focus > plain selection painting
  // (docs/ROUND-3.md D — a solo/scene "temporarily overrides" Focus while active).
  function paintFile(file) {
    const scene = activeScene();
    const sceneKeys = scene ? new Set(scene.marks) : null;
    const soloKeys = rail.solo ? new Set(rail.solo.keys) : null;
    const focusOn = rail.focus && !sceneKeys && !soloKeys;

    clickableMarks = computeClickableMarks(file);
    let painted;
    let overrideKeysForDim;
    if (sceneKeys) {
      painted = clickableMarks.filter((m) => sceneKeys.has(m.key));
      overrideKeysForDim = sceneKeys;
    } else if (soloKeys) {
      painted = selectMarksToPaint(clickableMarks, soloKeys);
      overrideKeysForDim = soloKeys;
    } else if (focusOn) {
      painted = clickableMarks.filter((m) => rail.selection.has(m.key));
      overrideKeysForDim = rail.selection;
    } else {
      painted = clickableMarks.filter((m) => rail.selection.has(m.key));
      overrideKeysForDim = null;
    }
    const strong = !!overrideKeysForDim;
    const segments = flatten(painted.map((m) => ({ start: m.start, end: m.end, layer: m.layer })));
    editor.setLayerDecorations(segments, colours, strong);

    const execLayer = doc.layers.find((l) => l.id === "exec.path");
    const execMarksInFile = execLayer
      ? execLayer.marks
          .filter((m) => m.file === file)
          .map((m) => ({
            start: offsets[file].byteToChar(m.start),
            end: offsets[file].byteToChar(m.end),
            layer: "exec.path",
            key: markKey("exec.path", m),
          }))
      : [];
    const execRanges = sceneKeys
      ? execMarksInFile.filter((m) => sceneKeys.has(m.key))
      : overrideKeysForDim
        ? selectMarksToPaint(execMarksInFile, overrideKeysForDim)
        : execMarksInFile.filter((m) => rail.selection.has(m.key));
    editor.setExecDecorations(execRanges, execRanges.length > 0);

    // Dim everything but the override's marks — except an override made only of exec.path
    // marks, which has no inline marks and is shown via the line highlight + dimming above.
    const onlyExec = overrideKeysForDim && [...overrideKeysForDim].every((k) => k.split("|")[0].startsWith("exec."));
    const dim = overrideKeysForDim && !onlyExec;
    editor.setSoloDim(dim ? segments.map((s) => ({ start: s.start, end: s.end })) : null);

    paintSelection();
    paintStepper();
  }

  // "current statement" decoration: only in the file the stepper is currently on, and only
  // once the stepper is active (unstarted stepper must not mark up the default-opened file).
  function paintStepper() {
    if (!stepper) return;
    const event = stepper.current();
    if (!stepperActive || !event || event.file !== activeFile) {
      editor.setStepperDecoration(null);
      return;
    }
    editor.setStepperDecoration(offsets[activeFile].byteToChar(event.start), offsets[activeFile].byteToChar(event.end));
  }

  function renderTabs() {
    renderFileList(layout.fileListEl, project.files, activeFile, openFile);
    renderFileTabs(layout.fileTabsEl, project.files, activeFile, openFile);
  }

  function syncURL() {
    const params = new URLSearchParams();
    params.set("project", projectDir);
    params.set("file", activeFile);
    if (stepper && stepperActive) params.set("i", String(stepper.cursor));
    if (activeSceneId) {
      const idx = presentation.scenes.findIndex((s) => s.id === activeSceneId);
      if (idx !== -1) params.set("scene", String(idx + 1));
    } else if (rail.solo) {
      params.set("solo", rail.solo.id);
    }
    if (rail.focus) params.set("focus", "1");
    history.replaceState(null, "", `?${params.toString()}`);
  }

  function openFile(file) {
    activeFile = file;
    rail.openFile(file);
    editor.openFile(file, sources[file]);
    renderTabs();
    paintFile(file);
    renderRail();
    syncURL();
  }

  function setSelection(next) {
    rail.setSelection(next);
    paintFile(activeFile);
    renderRail();
  }

  function jumpToMark(key) {
    const mark = marksByKey.get(key);
    goToJump({
      file: mark.file,
      pos: { start: offsets[mark.file].byteToChar(mark.start), end: offsets[mark.file].byteToChar(mark.end) },
    });
  }

  function resetSelection() {
    rail.reset();
    paintFile(activeFile);
    renderRail();
  }

  function renderRail() {
    renderRailPanel(
      layout.railEl,
      {
        tree: rail.tree,
        selection: rail.selection,
        solo: rail.solo,
        focus: rail.focus,
        expanded: rail.expanded,
        colours,
        activeFile,
        marksByKey,
        sources,
        offsets,
      },
      {
        onToggleKeys: (keys, on) => setSelection(setKeys(rail.selection, keys, on)),
        onToggleExpand: (id) => {
          rail.toggleExpanded(id);
          renderRail();
        },
        onSoloNode: (node) => setSolo(node),
        onJump: jumpToMark,
      },
    );
    layout.focusToggleEl.checked = rail.focus;
  }

  // Common refresh after anything changes which override (solo/focus) is painted.
  function refreshOverride() {
    paintFile(activeFile);
    renderRail();
    renderChip();
    renderScenes();
    syncURL();
  }

  // Name click on a layer/namespace-group/file/method — toggles that node as the solo, off
  // if it is already the soloed node (docs/ROUND-3.md D).
  function setSolo(node) {
    rail.toggleSoloNode(node);
    refreshOverride();
  }

  function soloCycle(direction) {
    rail.soloCycle(direction);
    refreshOverride();
  }

  function setFocus(value) {
    rail.setFocus(value);
    refreshOverride();
  }

  // Chip above the editor: shows whichever display override (scene or solo) is active.
  function renderChip() {
    const scene = activeScene();
    layout.soloChipEl.hidden = !scene && !rail.solo;
    if (!scene && !rail.solo) return;
    layout.soloChipEl.innerHTML = "";
    const text = document.createElement("span");
    if (scene) {
      const idx = presentation.scenes.findIndex((s) => s.id === scene.id) + 1;
      text.textContent = `scene ${idx}/${presentation.scenes.length}: ${scene.name}`;
    } else {
      text.textContent = `solo: ${rail.solo.label}`;
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "solo-chip-clear";
    clear.textContent = "✕";
    clear.addEventListener("click", () => (scene ? activateScene(null) : setSolo(null)));
    layout.soloChipEl.append(text, clear);
  }

  // --- Scenes ---

  // Exactly what is painted right now (selection, or the solo override) across ALL files —
  // the capture used by "+ from view" and "⟲ update" (docs/SELECTION-AND-SCENES.md Part B).
  // Generalized for any solo node: grouped by real layer id (as encoded in each markKey),
  // "selected ones, else the whole layer" per group — the project-wide analogue of a
  // per-file solo fallback (docs/VIEWER.md "Deviations").
  function currentPaintedKeys() {
    if (!rail.solo) return [...rail.selection];
    const byLayer = new Map();
    for (const key of rail.solo.keys) {
      const layerId = key.split("|")[0];
      if (!byLayer.has(layerId)) byLayer.set(layerId, []);
      byLayer.get(layerId).push(key);
    }
    const keys = [];
    for (const layerKeys of byLayer.values()) {
      const selected = layerKeys.filter((k) => rail.selection.has(k));
      keys.push(...(selected.length > 0 ? selected : layerKeys));
    }
    return keys;
  }

  function captureView() {
    return { file: activeFile, marks: currentPaintedKeys() };
  }

  function defaultSceneName() {
    return `Scene ${presentation.scenes.length + 1}`;
  }

  function addSceneFromView(name, { pinStep: pinStepOverride } = {}) {
    const usePinStep = pinStepOverride ?? pinStep;
    const { file, marks } = captureView();
    const step = usePinStep && stepper ? stepper.cursor : null;
    presentation = addScene(presentation, { name, file, marks, step });
    persistPresentation();
    renderScenes();
  }

  function duplicateSceneById(id) {
    presentation = duplicateScene(presentation, id);
    persistPresentation();
    renderScenes();
    renderChip();
  }

  function moveSceneById(id, toIndex) {
    presentation = moveScene(presentation, id, toIndex);
    persistPresentation();
    renderScenes();
    renderChip();
  }

  function renameSceneById(id, name) {
    presentation = renameScene(presentation, id, name);
    persistPresentation();
    renderScenes();
    renderChip();
  }

  function updateSceneById(id) {
    const { file, marks } = captureView();
    const step = pinStep && stepper ? stepper.cursor : null;
    presentation = updateScene(presentation, id, { file, marks, step });
    persistPresentation();
    if (id === activeSceneId) paintFile(activeFile);
    renderScenes();
  }

  function loadSceneById(id) {
    const scene = presentation.scenes.find((s) => s.id === id);
    if (scene) setSelection(new Set(scene.marks));
  }

  function removeSceneById(id) {
    presentation = removeScene(presentation, id);
    persistPresentation();
    if (activeSceneId === id) activateScene(null);
    else renderScenes();
  }

  // Raw activation setter: paints scene.marks as a strong override (or clears the override
  // for id === null), opens scene.file, and goes to scene.step through the stepper's own
  // goto path. Does NOT touch `selection`. Mutually exclusive with solo.
  function activateScene(id) {
    const scene = id ? presentation.scenes.find((s) => s.id === id) : null;
    activeSceneId = scene ? scene.id : null;
    if (scene) rail.setSoloNode(null);

    const nextFile = scene?.file && project.files.includes(scene.file) ? scene.file : activeFile;
    if (nextFile !== activeFile) {
      activeFile = nextFile;
      rail.openFile(activeFile);
      editor.openFile(activeFile, sources[activeFile]);
      renderTabs();
    }
    paintFile(activeFile);
    renderRail();
    renderChip();
    renderScenes();
    if (scene && scene.step !== null && stepper) gotoStepper(scene.step);
    syncURL();
  }

  function toggleScene(id) {
    activateScene(activeSceneId === id ? null : id);
  }

  function importPresentationFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        const { presentation: parsed, dropped } = parsePresentation(json, doc);
        presentation = parsed;
        if (activeSceneId && !parsed.scenes.some((s) => s.id === activeSceneId)) activeSceneId = null;
        persistPresentation();
        scenesMessage = { type: "info", text: `imported ${parsed.scenes.length} scenes, dropped ${dropped} unknown marks` };
      } catch (err) {
        scenesMessage = { type: "error", text: err.message };
      }
      paintFile(activeFile);
      renderRail();
      renderChip();
      renderScenes();
      syncURL();
    };
    reader.readAsText(file);
  }

  const scenesPanel = createScenesPanel(layout.scenesEl, {
    onAddFromView: () => addSceneFromView(defaultSceneName()),
    onTogglePinStep: (on) => {
      pinStep = on;
    },
    onActivate: toggleScene,
    onRename: renameSceneById,
    onDuplicate: duplicateSceneById,
    onUpdate: updateSceneById,
    onLoad: loadSceneById,
    onRemove: removeSceneById,
    onMove: moveSceneById,
    onImportFile: importPresentationFile,
  });

  function renderScenes() {
    scenesPanel.render({ presentation, activeId: activeSceneId, message: scenesMessage, pinStep });
  }

  function selectSymbol(symbol) {
    selectedSymbol = symbol;
    paintSelection();
    renderSymbolPanel(layout.symbolEl, { symbol, entry: symbol ? index[symbol] : null, sources, offsets }, jumpToRef);
  }

  // A jump pushes history, but the position we're jumping FROM also needs to be on the
  // stack for back() to work; seed it lazily the first time we jump away from it.
  function goToJump(entry) {
    const current = nav.history.current();
    if (!current || current.file !== activeFile) {
      nav.history.push({ file: activeFile, pos: { start: 0, end: 0 } });
    }
    nav.goTo(entry);
  }

  function jumpToRef(ref) {
    goToJump({
      file: ref.file,
      pos: { start: offsets[ref.file].byteToChar(ref.start), end: offsets[ref.file].byteToChar(ref.end) },
    });
  }

  function jumpToSymbol(symbol) {
    const targets = nav.resolveTargets(symbol);
    if (targets.length !== 1) {
      selectSymbol(symbol);
      return;
    }
    const [target] = targets;
    goToJump({
      file: target.file,
      pos: { start: offsets[target.file].byteToChar(target.start), end: offsets[target.file].byteToChar(target.end) },
    });
    selectSymbol(symbol);
  }

  function handleClick(pos, { jump }) {
    const hits = marksAtPosition(clickableMarks, pos);
    const symbol = innermostSymbol(hits);
    if (!symbol) return;

    if (!jump) {
      selectSymbol(symbol);
      return;
    }

    const clicked = hits
      .filter((m) => m.symbol === symbol)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    const clickedByte = {
      file: activeFile,
      start: offsets[activeFile].charToByte(clicked.start),
      end: offsets[activeFile].charToByte(clicked.end),
    };
    const targets = nav.resolveTargets(symbol);
    const decision = decideJump(targets, clickedByte);

    if (decision.action === "select") {
      selectSymbol(symbol);
      return;
    }

    const { target } = decision;
    goToJump({
      file: target.file,
      pos: { start: offsets[target.file].byteToChar(target.start), end: offsets[target.file].byteToChar(target.end) },
    });
    selectSymbol(symbol);
  }

  function clearSelection() {
    selectSymbol(null);
  }

  function renderStepper() {
    if (!stepper) return;
    const locals = stepper.localsAt();
    const changed = lastStepperLocals ? diffLocals(lastStepperLocals, locals) : new Set();
    lastStepperLocals = locals;
    renderStepperPanel(layout.stepperEl, {
      stepper,
      changed,
      onAction: runStepperAction,
      onSlide: gotoStepper,
      onFrameJump: (frame) => jumpToRef({ file: frame.file, start: frame.start, end: frame.end }),
    });
  }

  // Stepping never pushes jump history (only explicit jumps, e.g. a stack-frame click, do).
  function syncStepperToEditor() {
    const event = stepper.current();
    if (event.file !== activeFile) {
      openFile(event.file);
    } else {
      paintStepper();
      syncURL();
    }
    editor.scrollIntoView(offsets[event.file].byteToChar(event.start));
  }

  function stepAction(fn) {
    stepperActive = true;
    fn();
    renderStepper();
    syncStepperToEditor();
  }

  function gotoStepper(i) {
    stepAction(() => stepper.goto(i));
  }

  function runStepperAction(id) {
    stepAction(() => {
      if (id === "first") stepper.goto(0);
      else if (id === "last") stepper.goto(stepper.length - 1);
      else stepper[id]();
    });
  }

  function isBlockingFocus() {
    const el = document.activeElement;
    if (!el || el.classList?.contains("step-slider")) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
  }

  layout.focusToggleEl.addEventListener("change", () => setFocus(layout.focusToggleEl.checked));
  layout.railResetEl.addEventListener("click", (event) => {
    event.preventDefault();
    resetSelection();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      activateScene(null);
      clearSelection();
      setSolo(null);
      return;
    } else if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      nav.back();
      return;
    } else if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      nav.forward();
      return;
    }

    if (isBlockingFocus()) return;

    if (event.key === "]") {
      if (presentation.scenes.length > 0) activateScene(cycleScene(presentation, activeSceneId, 1));
      else soloCycle(1);
      return;
    }
    if (event.key === "[") {
      if (presentation.scenes.length > 0) activateScene(cycleScene(presentation, activeSceneId, -1));
      else soloCycle(-1);
      return;
    }
    if (event.key === "f") {
      setFocus(!rail.focus);
      return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && activeSceneId) {
      event.preventDefault();
      const idx = presentation.scenes.findIndex((s) => s.id === activeSceneId);
      moveSceneById(activeSceneId, idx + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }

    if (!stepper) return;
    const action = STEP_KEYS[event.key];
    if (!action) return;
    event.preventDefault();
    runStepperAction(action);
  });

  layout.backBtn.addEventListener("click", () => nav.back());
  layout.forwardBtn.addEventListener("click", () => nav.forward());

  renderRail();
  openFile(activeFile);
  selectSymbol(null);
  renderChip();
  renderScenes();

  if (stepper) {
    layout.stepperSectionEl.hidden = false;
    renderStepper();
    if (stepperActive) editor.scrollIntoView(offsets[activeFile].byteToChar(stepper.current().start));
  }

  window.__layers = {
    state: {
      project,
      doc,
      index,
      offsets,
      sources,
      get activeFile() {
        return activeFile;
      },
      get selectedSymbol() {
        return selectedSymbol;
      },
      get solo() {
        return rail.solo;
      },
      get focus() {
        return rail.focus;
      },
      get selection() {
        return [...rail.selection];
      },
      // Derived: true when ANY mark of the layer is selected (kept for existing callers).
      get layerState() {
        const result = {};
        for (const layer of doc.layers) result[layer.id] = layer.marks.some((m) => rail.selection.has(markKey(layer.id, m)));
        return result;
      },
    },
    openFile,
    toggleLayer(id, on) {
      const layer = doc.layers.find((l) => l.id === id);
      if (!layer) return;
      setSelection(setKeys(rail.selection, layer.marks.map((m) => markKey(id, m)), on));
    },
    setMarks: (keys, on) => setSelection(setKeys(rail.selection, keys, on)),
    resetSelection,
    selectSymbol,
    jumpToSymbol,
    solo: (idOrNull) => {
      rail.setSoloId(idOrNull);
      refreshOverride();
    },
    focus: (value) => setFocus(!!value),
    back: () => nav.back(),
    forward: () => nav.forward(),
    stepper: stepper && {
      get cursor() {
        return stepper.cursor;
      },
      goto: gotoStepper,
      next: () => runStepperAction("next"),
      prev: () => runStepperAction("prev"),
      stepOver: () => runStepperAction("stepOver"),
      stepBackOver: () => runStepperAction("stepBackOver"),
      stepOut: () => runStepperAction("stepOut"),
    },
    scenes: {
      list: () => presentation.scenes.map((s) => ({ ...s, marks: [...s.marks] })),
      addFromView: (name, opts) => addSceneFromView(name, opts),
      activate: (idOrNull) => activateScene(idOrNull),
      duplicate: (id) => duplicateSceneById(id),
      move: (id, toIndex) => moveSceneById(id, toIndex),
      rename: (id, name) => renameSceneById(id, name),
      update: (id) => updateSceneById(id),
      load: (id) => loadSceneById(id),
      remove: (id) => removeSceneById(id),
      get activeId() {
        return activeSceneId;
      },
    },
  };
}

async function main() {
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const projectDir = params.get("project") || DEFAULT_PROJECT;

  let result;
  try {
    result = await loadProject(projectDir);
  } catch (err) {
    renderError(app, [{ path: "", message: err.message }]);
    return;
  }

  if (!result.ok) {
    renderError(app, result.errors);
    return;
  }

  const presentation = await loadInitialPresentation(projectDir, result.doc);

  boot(
    app,
    projectDir,
    result,
    params.get("file"),
    params.get("i"),
    params.get("solo"),
    params.get("focus"),
    presentation,
    params.get("scene"),
  );
}

main();
