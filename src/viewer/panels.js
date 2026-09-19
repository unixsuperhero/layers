import { lineOfOffset } from "./marks-at.js";

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
        <div class="editor-host" id="editor-host"></div>
      </div>
      <div class="col col-right">
        <div class="symbol-panel" id="symbol-panel"></div>
        <section id="stepper-panel" class="stepper-panel" hidden></section>
      </div>
    </div>
  `;
  return {
    fileListEl: app.querySelector("#file-list"),
    layersEl: app.querySelector("#layer-panel"),
    fileTabsEl: app.querySelector("#file-tabs"),
    editorEl: app.querySelector("#editor-host"),
    symbolEl: app.querySelector("#symbol-panel"),
    stepperEl: app.querySelector("#stepper-panel"),
    backBtn: app.querySelector("#nav-back"),
    forwardBtn: app.querySelector("#nav-forward"),
  };
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

export function renderLayerPanel(container, layers, layerState, colours, onToggleLayer, onToggleGroup) {
  container.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = "Layers";
  container.appendChild(h);

  for (const [ns, group] of groupByNamespace(layers)) {
    const groupEl = document.createElement("div");
    groupEl.className = "layer-group";

    const allOn = group.every((l) => layerState[l.id]);
    const noneOn = group.every((l) => !layerState[l.id]);

    const header = document.createElement("label");
    header.className = "layer-group-header";
    const groupCb = document.createElement("input");
    groupCb.type = "checkbox";
    groupCb.checked = allOn;
    groupCb.indeterminate = !allOn && !noneOn;
    groupCb.addEventListener("change", () => {
      onToggleGroup(
        group.map((l) => l.id),
        groupCb.checked,
      );
    });
    header.append(groupCb, document.createTextNode(` ${ns}.*`));
    groupEl.appendChild(header);

    for (const layer of group) {
      const row = document.createElement("label");
      row.className = "layer-row";
      row.dataset.layerId = layer.id;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!layerState[layer.id];
      cb.addEventListener("change", () => onToggleLayer(layer.id, cb.checked));

      const swatch = document.createElement("span");
      swatch.className = "layer-swatch";
      swatch.style.backgroundColor = colours[layer.id];

      const label = document.createElement("span");
      label.className = "layer-id";
      label.textContent = layer.id;

      const count = document.createElement("span");
      count.className = "layer-count";
      count.textContent = String(layer.marks.length);

      row.append(cb, swatch, label, count);
      groupEl.appendChild(row);
    }
    container.appendChild(groupEl);
  }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Per-layer CSS: namespace decides which properties carry the colour, so overlapping
// layers (different namespaces) never fight over the same property.
export function layerStylesheet(layers, colours) {
  const rules = [];
  for (const layer of layers) {
    const cls = "lyr-" + layer.id.replaceAll(".", "-");
    const ns = layer.id.split(".")[0];
    const colour = colours[layer.id];
    if (ns === "defs") {
      rules.push(`.${cls} { color: ${colour}; font-weight: 700; }`);
    } else if (ns === "refs") {
      rules.push(
        `.${cls} { text-decoration-line: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: ${colour}; }`,
      );
    } else if (ns === "vars") {
      rules.push(`.${cls} { background-color: ${hexToRgba(colour, 0.28)}; border-radius: 2px; }`);
      if (layer.id === "vars.temps") {
        rules.push(`.${cls} { border-bottom: 2px dashed ${colour}; }`);
      }
    }
    // exec.* is a line decoration styled statically in style.css, not per-layer colour.
  }
  return rules.join("\n");
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
  const h = document.createElement("h2");
  h.textContent = "Stepper";
  container.appendChild(h);

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
  const h = document.createElement("h2");
  h.textContent = "Symbol";
  container.appendChild(h);

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
