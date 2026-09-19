import { loadProject } from "./load.js";
import { createEditor } from "./editor.js";
import { createNav, decideJump } from "./nav.js";
import { assignPalette } from "./palette.js";
import { marksAtPosition, innermostSymbol } from "./marks-at.js";
import { flatten } from "../core/flatten.js";
import { buildLayout, renderFileList, renderFileTabs, renderLayerPanel, renderSymbolPanel, layerStylesheet } from "./panels.js";

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

function boot(app, projectDir, { project, doc, sources, offsets, index }, requestedFile) {
  const colours = assignPalette(doc.layers.map((l) => l.id));
  injectStylesheet(layerStylesheet(doc.layers, colours));

  const layout = buildLayout(app);

  const layerState = {};
  for (const layer of doc.layers) layerState[layer.id] = layer.kind === "static";

  let activeFile = project.files.includes(requestedFile) ? requestedFile : project.files[0];
  let selectedSymbol = null;
  let clickableMarks = []; // char-offset marks of enabled, non-exec layers in the active file

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
      if (!layerState[layer.id]) continue;
      for (const mark of layer.marks) {
        if (mark.file !== file) continue;
        marks.push({
          start: offsets[file].byteToChar(mark.start),
          end: offsets[file].byteToChar(mark.end),
          symbol: mark.symbol,
          role: mark.role,
          layer: layer.id,
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

  function paintFile(file) {
    clickableMarks = computeClickableMarks(file);
    const segments = flatten(clickableMarks.map((m) => ({ start: m.start, end: m.end, layer: m.layer })));
    editor.setLayerDecorations(segments);

    const execEnabled = !!layerState["exec.path"];
    const execLayer = execEnabled ? doc.layers.find((l) => l.id === "exec.path") : null;
    const execRanges = execLayer
      ? execLayer.marks
          .filter((m) => m.file === file)
          .map((m) => ({ start: offsets[file].byteToChar(m.start), end: offsets[file].byteToChar(m.end) }))
      : [];
    editor.setExecDecorations(execRanges, execEnabled);

    paintSelection();
  }

  function renderTabs() {
    renderFileList(layout.fileListEl, project.files, activeFile, openFile);
    renderFileTabs(layout.fileTabsEl, project.files, activeFile, openFile);
  }

  function syncURL() {
    const params = new URLSearchParams();
    params.set("project", projectDir);
    params.set("file", activeFile);
    history.replaceState(null, "", `?${params.toString()}`);
  }

  function openFile(file) {
    activeFile = file;
    editor.openFile(file, sources[file]);
    renderTabs();
    paintFile(file);
    syncURL();
  }

  function renderLayers() {
    renderLayerPanel(
      layout.layersEl,
      doc.layers,
      layerState,
      colours,
      (id, on) => {
        layerState[id] = on;
        paintFile(activeFile);
        renderLayers();
      },
      (ids, on) => {
        for (const id of ids) layerState[id] = on;
        paintFile(activeFile);
        renderLayers();
      },
    );
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

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearSelection();
    } else if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      nav.back();
    } else if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      nav.forward();
    }
  });

  layout.backBtn.addEventListener("click", () => nav.back());
  layout.forwardBtn.addEventListener("click", () => nav.forward());

  renderLayers();
  openFile(activeFile);
  selectSymbol(null);

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
      layerState,
    },
    openFile,
    toggleLayer(id, on) {
      layerState[id] = on;
      paintFile(activeFile);
      renderLayers();
    },
    selectSymbol,
    jumpToSymbol,
    back: () => nav.back(),
    forward: () => nav.forward(),
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

  boot(app, projectDir, result, params.get("file"));
}

main();
