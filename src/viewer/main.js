import { loadProject } from "./load.js";
import { createEditor } from "./editor.js";
import { createNav, decideJump } from "./nav.js";
import { assignPalette } from "./palette.js";
import { marksAtPosition, innermostSymbol } from "./marks-at.js";
import { markKey, setKeys } from "./selection.js";
import { createRail } from "./rail.js";
import { wireRailResize } from "./resize.js";
import { createStepperController } from "./app-stepper.js";
import { createScenesController, loadInitialPresentation } from "./app-scenes.js";
import { wireAppKeys } from "./app-keys.js";
import { parseAppParams, buildAppQuery } from "./app-url.js";
import { wireToolbar } from "./toolbar.js";
import { createOpenDialog } from "./open-dialog.js";
import { assembleBundle, bundleKey } from "../core/bundle.js";
import { flatten } from "../core/flatten.js";
import { createStepper } from "../core/stepper.js";
import { buildCallTree } from "../core/calltree.js";
import { buildSymbolIndex } from "../core/symbols.js";
import { makeOffsetMap } from "../core/offsets.js";
import { createCallTreePanel } from "./calltree-panel.js";
import { buildLayout, wireRightSections, renderFileList, renderFileTabs, renderRailPanel, renderSymbolPanel, layerStylesheet } from "./panels.js";

const DEFAULT_PROJECT = "fixtures/example-ruby";

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

function deriveDocData(doc, sources) {
  const offsets = {};
  for (const file of Object.keys(sources)) offsets[file] = makeOffsetMap(sources[file]);
  return { offsets, index: buildSymbolIndex(doc) };
}

// Mounts a bundle into `app`, replacing whatever was there. Returns { unmount() } so the
// caller can cleanly tear down the old editor/listeners before mounting a different bundle —
// no page reload, no duplicate key handlers, no leaked CodeMirror views (docs/ROUND-3.md C).
//
// opts: { projectDir (string|null — set only when loaded via ?project=), requestedFile,
//   requestedI, requestedSolo, requestedFocus, requestedScene (all from the URL, first boot
//   only), openDialog (the Open… dialog singleton), remount(bundle, opts) }
export function mountApp(app, bundle, opts = {}) {
  const { project, sources, doc } = bundle;
  const { offsets, index } = deriveDocData(doc, sources);
  const storageKey = bundleKey(bundle);
  const projectDir = opts.projectDir ?? null;

  const controller = new AbortController();
  const { signal } = controller;

  const colours = assignPalette(doc.layers.map((l) => l.id));
  injectStylesheet(layerStylesheet(doc.layers, colours));

  const layout = buildLayout(app);
  wireRightSections(app, storageKey);

  const marksByKey = new Map();
  for (const layer of doc.layers) {
    for (const mark of layer.marks) marksByKey.set(markKey(layer.id, mark), { ...mark, layer: layer.id });
  }

  // A bundle's own `ui` acts like URL params for the very first boot of that bundle
  // (Import/Open…); actual URL params (only present on the page's initial load) win when both
  // are given, since only one of the two is ever populated at a time in practice.
  const requestedFile = opts.requestedFile ?? bundle.ui?.file ?? null;
  const requestedI = opts.requestedI ?? (bundle.ui?.i !== null && bundle.ui?.i !== undefined ? String(bundle.ui.i) : null);
  const requestedSolo = opts.requestedSolo ?? bundle.ui?.solo ?? null;
  const requestedFocus = opts.requestedFocus ?? (bundle.ui?.focus ? "1" : null);
  const requestedScene = opts.requestedScene ?? (bundle.ui?.scene !== null && bundle.ui?.scene !== undefined ? String(bundle.ui.scene) : null);

  const initialFile = project.files.includes(requestedFile) ? requestedFile : project.files[0];
  const rail = createRail(storageKey, doc, initialFile);
  // Bundle values win over localStorage on import (docs/ROUND-3.md C).
  if (Array.isArray(bundle.selection)) rail.setSelection(new Set(bundle.selection));

  const resizeHandles = wireRailResize(document.documentElement, { railHandle: layout.railResizeEl, rightHandle: layout.rightResizeEl }, { signal });

  const presentation = bundle.presentation;

  // `&scene=` takes precedence over `&solo=` (docs/SELECTION-AND-SCENES.md Part B).
  const sceneIdx = requestedScene !== null ? Number(requestedScene) : null;
  const initialActiveSceneId = Number.isInteger(sceneIdx) && presentation.scenes[sceneIdx - 1] ? presentation.scenes[sceneIdx - 1].id : null;
  if (!initialActiveSceneId && requestedSolo) rail.setSoloId(requestedSolo);
  if (requestedFocus === "1") rail.setFocus(true);

  let activeFile = initialFile;
  if (initialActiveSceneId) {
    const scene = presentation.scenes.find((s) => s.id === initialActiveSceneId);
    if (scene.file && project.files.includes(scene.file)) activeFile = scene.file;
  }

  const traceStepper = doc.trace && doc.trace.length ? createStepper(doc.trace) : null;
  let stepperPrimed = false;

  if (traceStepper && requestedI !== null) {
    const i = Number(requestedI);
    if (Number.isInteger(i)) {
      traceStepper.goto(i);
      stepperPrimed = true;
      activeFile = traceStepper.current().file;
    }
  }

  if (traceStepper && initialActiveSceneId) {
    const scene = presentation.scenes.find((s) => s.id === initialActiveSceneId);
    if (scene.step !== null) {
      traceStepper.goto(scene.step);
      stepperPrimed = true;
      activeFile = traceStepper.current().file;
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

  let selectedSymbol = null;
  let clickableMarks = []; // char-offset marks of ALL non-exec layers — clicks work whether or not a layer is painted

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

  // Precedence: an active scene > a name-click solo > Focus > plain selection painting
  // (docs/ROUND-3.md D — a solo/scene "temporarily overrides" Focus while active).
  function paintFile(file) {
    const scene = scenes.activeScene();
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
    stepper?.paint(activeFile);
  }

  function renderTabs() {
    renderFileList(layout.fileListEl, project.files, activeFile, openFile);
    renderFileTabs(layout.fileTabsEl, project.files, activeFile, openFile);
  }

  function syncURL() {
    const activeIdx = scenes.activeSceneId ? scenes.presentation.scenes.findIndex((s) => s.id === scenes.activeSceneId) : -1;
    const qs = buildAppQuery({
      project: projectDir,
      file: activeFile,
      i: stepper && stepper.active ? traceStepper.cursor : null,
      sceneIndex: activeIdx !== -1 ? activeIdx + 1 : null,
      solo: rail.solo ? rail.solo.id : null,
      focus: rail.focus,
    });
    history.replaceState(null, "", `?${qs}`);
  }

  // Switches the open file's editor/tabs without painting or re-rendering the rail — used by
  // scene activation, which paints/renders once afterward regardless of whether the file changed.
  function openFileSilent(file) {
    activeFile = file;
    rail.openFile(file);
    editor.openFile(file, sources[file]);
    renderTabs();
  }

  function openFile(file) {
    openFileSilent(file);
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
    scenes.render();
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
    const scene = scenes.activeScene();
    layout.soloChipEl.hidden = !scene && !rail.solo;
    if (!scene && !rail.solo) return;
    layout.soloChipEl.innerHTML = "";
    const text = document.createElement("span");
    if (scene) {
      const idx = scenes.presentation.scenes.findIndex((s) => s.id === scene.id) + 1;
      text.textContent = `scene ${idx}/${scenes.presentation.scenes.length}: ${scene.name}`;
    } else {
      text.textContent = `solo: ${rail.solo.label}`;
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "solo-chip-clear";
    clear.textContent = "✕";
    clear.addEventListener("click", () => (scene ? scenes.activate(null) : setSolo(null)));
    layout.soloChipEl.append(text, clear);
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

  function isBlockingFocus() {
    const el = document.activeElement;
    if (!el || el.classList?.contains("step-slider")) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
  }

  const stepper = traceStepper
    ? createStepperController(
        traceStepper,
        {
          editor,
          offsets,
          stepperPanelEl: layout.stepperEl,
          jumpToRef,
          openFile,
          getActiveFile: () => activeFile,
          syncURL,
          onCursorChange: () => callTree?.follow(traceStepper.cursor),
        },
        { initialActive: stepperPrimed },
      )
    : null;

  const callTree = traceStepper
    ? createCallTreePanel(buildCallTree(doc.trace), {
        containerEl: layout.callTreeEl,
        sources,
        offsets,
        trace: doc.trace,
        onGoto: (enterIndex) => {
          const event = doc.trace[enterIndex];
          jumpToRef({ file: event.file, start: event.start, end: event.end });
          stepper.goto(enterIndex);
        },
      })
    : null;

  const scenes = createScenesController(
    presentation,
    {
      doc,
      project,
      storageKey,
      getActiveFile: () => activeFile,
      openFileSilent,
      paintFile,
      renderRail,
      renderChip,
      syncURL,
      setSelection,
      rail: {
        get selection() {
          return rail.selection;
        },
        get solo() {
          return rail.solo;
        },
        setSoloNode: (node) => rail.setSoloNode(node),
      },
      stepper: stepper && { get cursor() { return traceStepper.cursor; }, goto: (i) => stepper.goto(i) },
      scenesPanelEl: layout.scenesEl,
    },
    { initialActiveSceneId },
  );

  layout.focusToggleEl.addEventListener("change", () => setFocus(layout.focusToggleEl.checked), { signal });
  layout.railResetEl.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      resetSelection();
    },
    { signal },
  );
  layout.backBtn.addEventListener("click", () => nav.back(), { signal });
  layout.forwardBtn.addEventListener("click", () => nav.forward(), { signal });

  wireAppKeys(
    {
      nav,
      scenes,
      stepper,
      rail: {
        get focus() {
          return rail.focus;
        },
      },
      setFocus,
      setSolo,
      soloCycle,
      clearSelection,
    },
    { signal },
  );

  function currentUi() {
    const activeIdx = scenes.activeSceneId ? scenes.presentation.scenes.findIndex((s) => s.id === scenes.activeSceneId) : -1;
    return {
      file: activeFile,
      solo: rail.solo ? rail.solo.id : null,
      focus: rail.focus,
      scene: activeIdx !== -1 ? activeIdx + 1 : null,
      i: stepper && stepper.active ? traceStepper.cursor : null,
      railWidth: resizeHandles.getRailWidth(),
    };
  }

  function buildCurrentBundle() {
    return assembleBundle({
      project,
      sources,
      doc,
      presentation: scenes.presentation,
      selection: [...rail.selection],
      ui: currentUi(),
    });
  }

  const toolbar = wireToolbar(
    {
      layout,
      projectName: project.name,
      buildExportBundle: buildCurrentBundle,
      onImportBundle: (importedBundle) => opts.remount?.(importedBundle, {}),
      onOpenDialog: () => opts.openDialog?.open(),
    },
    { signal },
  );

  renderRail();
  openFile(activeFile);
  selectSymbol(null);
  renderChip();
  scenes.render();

  if (stepper) {
    layout.stepperSectionEl.hidden = false;
    stepper.render();
    if (stepper.active) editor.scrollIntoView(offsets[activeFile].byteToChar(traceStepper.current().start));
  }
  if (callTree) {
    layout.callTreeSectionEl.hidden = false;
    callTree.render();
    if (stepper.active) callTree.follow(traceStepper.cursor);
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
        return traceStepper.cursor;
      },
      goto: (i) => stepper.goto(i),
      next: () => stepper.runAction("next"),
      prev: () => stepper.runAction("prev"),
      stepOver: () => stepper.runAction("stepOver"),
      stepBackOver: () => stepper.runAction("stepBackOver"),
      stepOut: () => stepper.runAction("stepOut"),
    },
    callTree: callTree && {
      rows: () => callTree.rows(),
      goto: (id) => callTree.goto(id),
    },
    scenes: {
      list: () => scenes.presentation.scenes.map((s) => ({ ...s, marks: [...s.marks] })),
      addFromView: (name, sceneOpts) => scenes.addFromView(name, sceneOpts),
      activate: (idOrNull) => scenes.activate(idOrNull),
      duplicate: (id) => scenes.duplicateById(id),
      move: (id, toIndex) => scenes.moveById(id, toIndex),
      rename: (id, name) => scenes.renameById(id, name),
      update: (id) => scenes.updateById(id),
      load: (id) => scenes.loadById(id),
      remove: (id) => scenes.removeById(id),
      get activeId() {
        return scenes.activeSceneId;
      },
    },
    bundle: {
      export: () => buildCurrentBundle(),
      import: (json) => toolbar.importJson(json),
    },
  };

  return {
    unmount() {
      controller.abort();
      editor.destroy();
    },
  };
}

async function loadBundleForProjectDir(projectDir) {
  const result = await loadProject(projectDir);
  if (!result.ok) return result;
  const storageKey = bundleKey({ project: result.project, doc: result.doc });
  const presentation = await loadInitialPresentation(storageKey, projectDir, result.doc);
  const bundle = assembleBundle({ project: result.project, sources: result.sources, doc: result.doc, presentation });
  return { ok: true, bundle };
}

async function main() {
  const app = document.getElementById("app");
  const params = parseAppParams(location.search);
  const projectDir = params.project || DEFAULT_PROJECT;

  let loaded;
  try {
    loaded = await loadBundleForProjectDir(projectDir);
  } catch (err) {
    renderError(app, [{ path: "", message: err.message }]);
    return;
  }
  if (!loaded.ok) {
    renderError(app, loaded.errors);
    return;
  }

  let currentApp = null;
  function remount(bundle, opts = {}) {
    currentApp?.unmount();
    currentApp = mountApp(app, bundle, { ...opts, openDialog, remount });
  }
  const openDialog = createOpenDialog((bundle) => remount(bundle, {}));

  remount(loaded.bundle, {
    projectDir,
    requestedFile: params.file,
    requestedI: params.i,
    requestedSolo: params.solo,
    requestedFocus: params.focus,
    requestedScene: params.scene,
  });
}

main();
