// DOM for the Scenes panel: toolbar (add/pin-step/import/export), the ordered scene list
// (activate, inline rename, drag reorder, duplicate/update/load/delete), and an inline
// message area for import feedback. All state mutation happens via `handlers`, called from
// main.js; this module owns only transient UI-only state (which row is being renamed, and
// which row is mid-drag).
//
// handlers: { onAddFromView(), onTogglePinStep(on), onActivate(id), onRename(id, name),
//   onDuplicate(id), onUpdate(id), onLoad(id), onRemove(id), onMove(id, toIndex),
//   onImportFile(file) }

function actionButton(label, title, cls, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `scene-action ${cls}`;
  btn.title = title;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

const DBLCLICK_WINDOW_MS = 280;

export function createScenesPanel(container, handlers) {
  let renamingId = null;
  let dragId = null;
  let lastExportUrl = null;
  let pinStepEl = null;
  let lastCtx = null;
  let clickTimer = null;

  function renderToolbar(ctx) {
    const toolbar = document.createElement("div");
    toolbar.className = "scenes-toolbar";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "scenes-add";
    addBtn.title = "New scene from the current view";
    addBtn.textContent = "+ from view";
    addBtn.addEventListener("click", () => handlers.onAddFromView());

    const pinLabel = document.createElement("label");
    pinLabel.className = "scenes-pin-step";
    pinLabel.title = "Also store the current stepper position";
    pinStepEl = document.createElement("input");
    pinStepEl.type = "checkbox";
    pinStepEl.id = "scenes-pin-step";
    pinStepEl.checked = !!ctx.pinStep;
    pinStepEl.addEventListener("change", () => handlers.onTogglePinStep(pinStepEl.checked));
    pinLabel.append(pinStepEl, document.createTextNode(" pin step"));

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "scenes-import";
    importBtn.title = "Import presentation.json";
    importBtn.textContent = "⇪ import";
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.id = "scenes-import-input";
    importInput.accept = "application/json";
    importInput.hidden = true;
    importBtn.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", () => {
      const file = importInput.files[0];
      importInput.value = "";
      if (file) handlers.onImportFile(file);
    });

    const exportLink = document.createElement("a");
    exportLink.className = "scenes-export";
    exportLink.id = "scenes-export-link";
    exportLink.title = "Export presentation.json";
    exportLink.textContent = "⇩ export";
    exportLink.download = "presentation.json";
    if (lastExportUrl) URL.revokeObjectURL(lastExportUrl);
    lastExportUrl = URL.createObjectURL(new Blob([JSON.stringify(ctx.presentation, null, 2)], { type: "application/json" }));
    exportLink.href = lastExportUrl;

    toolbar.append(addBtn, pinLabel, importBtn, importInput, exportLink);
    return toolbar;
  }

  function renderRow(scene, i, ctx) {
    const active = scene.id === ctx.activeId;
    const row = document.createElement("div");
    row.className = "scene-row" + (active ? " active" : "");
    row.dataset.id = scene.id;
    row.draggable = true;

    row.addEventListener("dragstart", (event) => {
      dragId = scene.id;
      event.dataTransfer.setData("text/plain", scene.id);
      event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (dragId && dragId !== scene.id) handlers.onMove(dragId, i);
      dragId = null;
    });

    const handle = document.createElement("span");
    handle.className = "scene-handle";
    handle.title = "Drag to reorder";
    handle.textContent = "⠿";

    const index = document.createElement("span");
    index.className = "scene-index";
    index.textContent = String(i + 1);

    const nameWrap = document.createElement("span");
    nameWrap.className = "scene-name-wrap";

    if (renamingId === scene.id) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "scene-name-input";
      input.value = scene.name;
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const value = input.value.trim();
        renamingId = null;
        if (value && value !== scene.name) handlers.onRename(scene.id, value);
        else render(lastCtx);
      };
      const cancel = () => {
        if (done) return;
        done = true;
        renamingId = null;
        render(lastCtx);
      };
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      });
      input.addEventListener("blur", commit);
      nameWrap.appendChild(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    } else {
      const name = document.createElement("span");
      name.className = "scene-name";
      name.textContent = scene.name;
      name.title = scene.name;
      // A double-click's first click also fires a plain "click" — delay activation so a
      // following dblclick (which starts a rename instead) can cancel it.
      name.addEventListener("click", (event) => {
        if (event.detail > 1) return;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => handlers.onActivate(scene.id), DBLCLICK_WINDOW_MS);
      });
      name.addEventListener("dblclick", () => {
        clearTimeout(clickTimer);
        renamingId = scene.id;
        render(lastCtx);
      });
      nameWrap.appendChild(name);
      if (active) {
        const badge = document.createElement("span");
        badge.className = "scene-active-badge";
        badge.textContent = "active";
        nameWrap.appendChild(badge);
      }
    }

    const stepBadge = document.createElement("span");
    stepBadge.className = "scene-step-badge";
    if (scene.step !== null) {
      stepBadge.textContent = `⏵${scene.step}`;
      stepBadge.title = `Pinned to stepper event ${scene.step}`;
    } else {
      stepBadge.hidden = true;
    }

    const actions = document.createElement("span");
    actions.className = "scene-actions";
    actions.append(
      actionButton("⧉", "Duplicate", "scene-dup", () => handlers.onDuplicate(scene.id)),
      actionButton("⟲", "Update from current view", "scene-update", () => handlers.onUpdate(scene.id)),
      actionButton("⇤", "Load into selection", "scene-load", () => handlers.onLoad(scene.id)),
      actionButton("✕", "Delete", "scene-remove", () => handlers.onRemove(scene.id)),
    );

    row.append(handle, index, nameWrap, stepBadge, actions);
    return row;
  }

  function render(ctx) {
    lastCtx = ctx;
    container.innerHTML = "";
    container.appendChild(renderToolbar(ctx));

    const message = document.createElement("div");
    message.className = "scenes-message" + (ctx.message?.type === "error" ? " error" : "");
    message.id = "scenes-message";
    message.textContent = ctx.message?.text ?? "";
    container.appendChild(message);

    const list = document.createElement("div");
    list.className = "scenes-list";
    list.id = "scenes-list";
    if (ctx.presentation.scenes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "scenes-empty";
      empty.textContent = "No scenes yet";
      list.appendChild(empty);
    } else {
      ctx.presentation.scenes.forEach((scene, i) => list.appendChild(renderRow(scene, i, ctx)));
    }
    container.appendChild(list);
  }

  return { render };
}
