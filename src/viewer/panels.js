import { lineOfOffset } from "./marks-at.js";
import { matchesSolo } from "./solo.js";
import { itemsOfLayer, checkState, markKey } from "./selection.js";

export function buildLayout(app) {
  app.innerHTML = `
    <div class="layout">
      <div class="col col-left">
        <div class="nav-toolbar">
          <button id="nav-back" type="button" title="Back (Alt+Left)">&larr;</button>
          <button id="nav-forward" type="button" title="Forward (Alt+Right)">&rarr;</button>
        </div>
        <div class="file-list" id="file-list"></div>
        <div class="layer-panel" id="layer-panel"></div>
      </div>
      <div class="col col-center">
        <div class="file-tabs" id="file-tabs"></div>
        <div class="solo-chip" id="solo-chip" hidden></div>
        <div class="editor-host" id="editor-host"></div>
      </div>
      <div class="col col-right">
        <section class="right-section" data-section="scenes">
          <div class="right-section-header"><h2>Scenes</h2></div>
          <div class="right-section-body scenes-panel" id="scenes-panel"></div>
        </section>
        <section class="right-section" data-section="symbol">
          <div class="right-section-header"><h2>Symbol</h2></div>
          <div class="right-section-body symbol-panel" id="symbol-panel"></div>
        </section>
        <section class="right-section" data-section="stepper" id="stepper-section" hidden>
          <div class="right-section-header"><h2>Stepper</h2></div>
          <div class="right-section-body stepper-panel" id="stepper-panel"></div>
        </section>
      </div>
    </div>
  `;
  return {
    fileListEl: app.querySelector("#file-list"),
    layersEl: app.querySelector("#layer-panel"),
    fileTabsEl: app.querySelector("#file-tabs"),
    editorEl: app.querySelector("#editor-host"),
    soloChipEl: app.querySelector("#solo-chip"),
    scenesEl: app.querySelector("#scenes-panel"),
    symbolEl: app.querySelector("#symbol-panel"),
    stepperEl: app.querySelector("#stepper-panel"),
    stepperSectionEl: app.querySelector("#stepper-section"),
    backBtn: app.querySelector("#nav-back"),
    forwardBtn: app.querySelector("#nav-forward"),
  };
}

// Makes each right-column section's heading toggle its body, remembering collapsed state.
export function wireRightSections(app, projectDir) {
  const key = `layers:${projectDir}:rightCollapsed`;
  let collapsed;
  try {
    collapsed = new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    collapsed = new Set();
  }
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify([...collapsed]));
    } catch {
      // ignore
    }
  };
  for (const section of app.querySelectorAll(".right-section")) {
    const name = section.dataset.section;
    if (collapsed.has(name)) section.classList.add("collapsed");
    section.querySelector(".right-section-header").addEventListener("click", () => {
      section.classList.toggle("collapsed");
      if (section.classList.contains("collapsed")) collapsed.add(name);
      else collapsed.delete(name);
      persist();
    });
  }
}

export function renderFileList(container, files, activeFile, onSelect) {
  container.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = "Files";
  container.appendChild(h);
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "file-list-item" + (file === activeFile ? " active" : "");
    item.textContent = file;
    item.addEventListener("click", () => onSelect(file));
    container.appendChild(item);
  }
}

export function renderFileTabs(container, files, activeFile, onSelect) {
  container.innerHTML = "";
  for (const file of files) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "file-tab" + (file === activeFile ? " active" : "");
    tab.textContent = file;
    tab.addEventListener("click", () => onSelect(file));
    container.appendChild(tab);
  }
}

function groupByNamespace(layers) {
  const groups = new Map();
  for (const layer of layers) {
    const ns = layer.id.split(".")[0];
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push(layer);
  }
  return groups;
}

function countOn(selection, keys) {
  return keys.filter((k) => selection.has(k)).length;
}

// state: "all" | "none" | "some". prefix is prepended to the plain total (layers use "",
// multi-mark items use "×"); a partial count always reads "on/total" regardless of prefix.
function formatCount(state, on, total, prefix) {
  return state === "some" ? `${on}/${total}` : `${prefix}${total}`;
}

function markLine(mark, sources, offsets) {
  return lineOfOffset(sources[mark.file], offsets[mark.file].byteToChar(mark.start));
}

// Which mark a click on an item's label jumps to: its definition, else its first write,
// else its first mark (marks are already in first-appearance order).
function jumpTargetKey(item, marksByKey) {
  const marks = item.marks.map((key) => ({ key, ...marksByKey.get(key) }));
  const def = marks.find((m) => m.role === "definition");
  if (def) return def.key;
  const write = marks.find((m) => m.role === "write");
  if (write) return write.key;
  return marks[0].key;
}

function renderMarkRow(key, ctx, handlers) {
  const { selection, activeFile, marksByKey, sources, offsets } = ctx;
  const mark = marksByKey.get(key);

  const row = document.createElement("div");
  row.className = "mark-row" + (mark.file !== activeFile ? " dim" : "");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = selection.has(key);
  cb.addEventListener("change", () => handlers.onToggle([key], cb.checked));

  const label = document.createElement("span");
  label.className = "mark-label";
  const text = `${mark.role}  ${mark.file}:${markLine(mark, sources, offsets)}`;
  label.textContent = text;
  label.title = text;
  label.addEventListener("click", () => handlers.onJump(key));

  row.append(cb, label);
  return row;
}

function renderItemRow(layer, item, ctx, handlers) {
  const { selection, expandedItems, activeFile, marksByKey, sources, offsets } = ctx;
  const state = checkState(selection, item.marks);
  const multi = item.marks.length > 1;
  const itemId = `${layer.id}\0${item.symbol}`;
  const expanded = multi && expandedItems.has(itemId);
  const inFile = item.marks.some((k) => marksByKey.get(k).file === activeFile);
  const firstMark = marksByKey.get(item.marks[0]);

  const row = document.createElement("div");
  row.className = "item-row" + (state === "some" ? " partial" : "") + (inFile ? "" : " dim");

  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "tree-caret" + (multi ? "" : " empty");
  caret.disabled = !multi;
  if (multi) {
    caret.textContent = expanded ? "▾" : "▸";
    caret.addEventListener("click", () => handlers.onToggleItemCaret(layer.id, item.symbol));
  }

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = state === "all";
  cb.indeterminate = state === "some";
  cb.addEventListener("change", () => handlers.onToggle(item.marks, cb.checked));

  const label = document.createElement("span");
  label.className = "item-label";
  const labelText = item.symbol ?? firstMark.role;
  // "Invoice#summary/total" → dim shrinkable prefix "Invoice#summary/" + the name "total", which never truncates
  const cut = Math.max(labelText.lastIndexOf("#"), labelText.lastIndexOf("/")) + 1;
  const prefix = document.createElement("span");
  prefix.className = "item-prefix";
  prefix.textContent = labelText.slice(0, cut);
  const name = document.createElement("span");
  name.className = "item-name";
  name.textContent = labelText.slice(cut);
  label.append(prefix, name);
  label.title = labelText;
  label.addEventListener("click", () => handlers.onJump(jumpTargetKey(item, marksByKey)));

  const meta = document.createElement("span");
  meta.className = "item-meta";
  meta.textContent = multi
    ? formatCount(state, countOn(selection, item.marks), item.marks.length, "×")
    : `${firstMark.file}:${markLine(firstMark, sources, offsets)}`;

  row.append(caret, cb, label, meta);

  const wrap = document.createElement("div");
  wrap.className = "item-block";
  wrap.appendChild(row);

  if (expanded) {
    const marksEl = document.createElement("div");
    marksEl.className = "item-marks";
    for (const key of item.marks) marksEl.appendChild(renderMarkRow(key, ctx, handlers));
    wrap.appendChild(marksEl);
  }

  return wrap;
}

function renderLayerRow(layer, ctx, handlers) {
  const { selection, colours, solo, expandedLayers } = ctx;
  const items = itemsOfLayer(layer);
  const layerKeys = layer.marks.map((m) => markKey(layer.id, m));
  const state = checkState(selection, layerKeys);
  const isSoloed = matchesSolo(layer.id, solo);
  const expanded = expandedLayers.has(layer.id);

  const row = document.createElement("div");
  row.className = "layer-row" + (isSoloed ? " solo" : "") + (state === "some" ? " partial" : "");
  row.dataset.layerId = layer.id;

  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "tree-caret" + (items.length ? "" : " empty");
  caret.disabled = !items.length;
  if (items.length) {
    caret.textContent = expanded ? "▾" : "▸";
    caret.addEventListener("click", () => handlers.onToggleLayerCaret(layer.id));
  }

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = state === "all";
  cb.indeterminate = state === "some";
  cb.addEventListener("change", () => handlers.onToggle(layerKeys, cb.checked));

  const swatch = document.createElement("span");
  swatch.className = "layer-swatch";
  swatch.style.backgroundColor = colours[layer.id];
  swatch.addEventListener("click", () => handlers.onSoloLayer(layer.id));

  const label = document.createElement("span");
  label.className = "layer-id";
  label.textContent = layer.id;
  label.title = layer.id;
  label.addEventListener("click", () => handlers.onSoloLayer(layer.id));

  const count = document.createElement("span");
  count.className = "layer-count";
  count.textContent = formatCount(state, countOn(selection, layerKeys), layerKeys.length, "");

  row.append(caret, cb, swatch, label, count);
  if (isSoloed) {
    const badge = document.createElement("span");
    badge.className = "solo-badge";
    badge.textContent = "solo";
    row.appendChild(badge);
  }

  const wrap = document.createElement("div");
  wrap.className = "layer-block";
  wrap.appendChild(row);

  if (expanded && items.length) {
    const itemsEl = document.createElement("div");
    itemsEl.className = "layer-items";
    for (const item of items) itemsEl.appendChild(renderItemRow(layer, item, ctx, handlers));
    wrap.appendChild(itemsEl);
  }

  return wrap;
}

// ctx: { layers, selection, colours, solo, expandedLayers, expandedItems, activeFile,
//        marksByKey, sources, offsets }. handlers: { onToggle(keys, on), onSoloLayer(id),
// onSoloGroup(ns), onToggleLayerCaret(id), onToggleItemCaret(layerId, symbol), onJump(key),
// onReset() }.
export function renderLayerPanel(container, ctx, handlers) {
  const { layers, selection, solo } = ctx;
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "layer-panel-header";
  const h = document.createElement("h2");
  h.textContent = "Layers";
  const reset = document.createElement("a");
  reset.href = "#";
  reset.className = "layer-reset";
  reset.textContent = "reset";
  reset.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onReset();
  });
  header.append(h, reset);
  container.appendChild(header);

  for (const [ns, group] of groupByNamespace(layers)) {
    const groupEl = document.createElement("div");
    groupEl.className = "layer-group";

    const groupKeys = group.flatMap((l) => l.marks.map((m) => markKey(l.id, m)));
    const groupState = checkState(selection, groupKeys);
    const groupSolo = `${ns}.*`;
    const groupIsSoloed = solo === groupSolo;

    const groupHeader = document.createElement("div");
    groupHeader.className = "layer-group-header" + (groupIsSoloed ? " solo" : "");
    const groupCb = document.createElement("input");
    groupCb.type = "checkbox";
    groupCb.checked = groupState === "all";
    groupCb.indeterminate = groupState === "some";
    groupCb.addEventListener("change", () => handlers.onToggle(groupKeys, groupCb.checked));
    const groupName = document.createElement("span");
    groupName.className = "layer-group-name";
    groupName.textContent = groupSolo;
    groupName.addEventListener("click", () => handlers.onSoloGroup(ns));
    groupHeader.append(groupCb, groupName);
    if (groupIsSoloed) {
      const badge = document.createElement("span");
      badge.className = "solo-badge";
      badge.textContent = "solo";
      groupHeader.appendChild(badge);
    }
    groupEl.appendChild(groupHeader);

    for (const layer of group) groupEl.appendChild(renderLayerRow(layer, ctx, handlers));
    container.appendChild(groupEl);
  }
}

// Injects only the colour: `.lyr-<id> { --lyr: #… }`, sorted so the cascade consistently
// favours the alphabetically-last layer of a multi-layer segment (see editor.js). Every
// other visual (background tint, border, namespace cues) lives in style.css and reads
// `--lyr` / the inline `--lyr-bg` — colours are never hardcoded there.
export function layerStylesheet(layers, colours) {
  const sorted = [...layers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted.map((layer) => `.lyr-${layer.id.replaceAll(".", "-")} { --lyr: ${colours[layer.id]}; }`).join("\n");
}

const STEP_BUTTONS = [
  ["first", "First (Home)", "⏮"],
  ["stepBackOver", "Step back over (p)", "⇤"],
  ["prev", "Prev (← / k)", "←"],
  ["next", "Next (→ / j)", "→"],
  ["stepOver", "Step over (n)", "⇥"],
  ["stepOut", "Step out (o)", "↰"],
  ["last", "Last (End)", "⏭"],
];

export function renderStepperPanel(container, { stepper, changed, onAction, onSlide, onFrameJump }) {
  container.innerHTML = "";

  const controls = document.createElement("div");
  controls.className = "stepper-controls";
  for (const [action, title, label] of STEP_BUTTONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.textContent = label;
    btn.addEventListener("click", () => onAction(action));
    controls.appendChild(btn);
  }
  container.appendChild(controls);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "step-slider";
  slider.min = "0";
  slider.max = String(Math.max(0, stepper.length - 1));
  slider.value = String(stepper.cursor);
  slider.addEventListener("input", () => onSlide(Number(slider.value)));
  container.appendChild(slider);

  const event = stepper.current();

  const status = document.createElement("div");
  status.className = "step-status";
  status.textContent = `event ${stepper.cursor}/${stepper.length} · ${event.event} · depth ${event.depth}`;
  container.appendChild(status);

  if (event.event === "call" || event.event === "b_call") {
    const sym = document.createElement("div");
    sym.className = "step-symbol";
    sym.textContent = event.symbol ? `${event.symbol}${event.recv ? ` (recv ${event.recv})` : ""}` : "(block)";
    container.appendChild(sym);
  } else if (event.event === "return" || event.event === "b_return") {
    const val = document.createElement("div");
    val.className = "step-value";
    val.textContent = event.value;
    container.appendChild(val);
  }

  const stackH = document.createElement("h3");
  stackH.textContent = "Stack";
  container.appendChild(stackH);
  const stack = stepper.stack();
  stack.forEach((frame, i) => {
    const row = document.createElement("div");
    row.className = "step-frame" + (i === stack.length - 1 ? " current" : "");
    row.textContent = frame.symbol ?? "(block)";
    row.addEventListener("click", () => onFrameJump(frame));
    container.appendChild(row);
  });

  const localsH = document.createElement("h3");
  localsH.textContent = "Locals";
  container.appendChild(localsH);
  const table = document.createElement("table");
  table.className = "step-locals";
  for (const [name, value] of Object.entries(stepper.localsAt())) {
    const row = document.createElement("tr");
    row.dataset.name = name;
    if (changed.has(name)) row.className = "changed";
    const nameCell = document.createElement("td");
    nameCell.textContent = name;
    const valueCell = document.createElement("td");
    valueCell.textContent = value;
    row.append(nameCell, valueCell);
    table.appendChild(row);
  }
  container.appendChild(table);
}

function refRow(ref, sources, offsets, onJump) {
  const charStart = offsets[ref.file].byteToChar(ref.start);
  const line = lineOfOffset(sources[ref.file], charStart);
  const text = (sources[ref.file].split("\n")[line - 1] ?? "").trim();
  const row = document.createElement("div");
  row.className = "sym-row";
  row.textContent = `${ref.file}:${line}  ${text}`;
  row.addEventListener("click", () => onJump(ref));
  return row;
}

const ROLE_LABELS = [
  ["definitions", "Definitions"],
  ["references", "References"],
  ["writes", "Writes"],
  ["reads", "Reads"],
];

export function renderSymbolPanel(container, { symbol, entry, sources, offsets }, onJump) {
  container.innerHTML = "";

  if (!symbol || !entry) {
    const empty = document.createElement("p");
    empty.className = "sym-empty";
    empty.textContent = "No symbol selected";
    container.appendChild(empty);
    return;
  }

  const name = document.createElement("div");
  name.className = "sym-name";
  name.textContent = symbol;
  container.appendChild(name);

  for (const [role, label] of ROLE_LABELS) {
    const refs = entry[role];
    if (!refs.length) continue;
    const group = document.createElement("div");
    group.className = `sym-group sym-${role}`;
    const groupHeading = document.createElement("h3");
    groupHeading.textContent = `${label} (${refs.length})`;
    group.appendChild(groupHeading);
    for (const ref of refs) group.appendChild(refRow(ref, sources, offsets, onJump));
    container.appendChild(group);
  }
}
