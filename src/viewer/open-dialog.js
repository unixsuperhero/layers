// The "Open…" dialog (docs/ROUND-3.md C): pick .rb files or a folder, choose an entry point,
// name the project, and POST them to /api/analyze (server/analyze-plugin.js). A singleton
// <dialog>, created once and appended to <body> so it survives app remounts.
import { parseBundle } from "../core/bundle.js";

function basenameNoExt(path) {
  const base = path.split("/").pop();
  return base.replace(/\.rb$/i, "");
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

const DIALOG_HTML = `
  <form method="dialog" class="open-form">
    <h2>Open&hellip;</h2>
    <div class="open-row">
      <label class="open-add-btn">
        Add files
        <input id="open-add-files" type="file" multiple accept=".rb" hidden />
      </label>
      <label class="open-add-btn">
        Add folder
        <input id="open-add-folder" type="file" webkitdirectory hidden />
      </label>
      <a href="#" id="open-clear" class="open-clear">clear</a>
      <span class="open-ignored" id="open-ignored" hidden></span>
    </div>
    <div class="open-file-list" id="open-file-list"></div>
    <div class="open-row open-entry-row">
      <label>Entry point
        <select id="open-entry-select"></select>
      </label>
    </div>
    <p class="open-help">The entry point is the script that gets RUN to record the execution path. Static layers don't need one.</p>
    <div class="open-row">
      <label>Project name
        <input id="open-project-name" type="text" />
      </label>
    </div>
    <div class="open-status" id="open-status" hidden></div>
    <ul class="open-warnings" id="open-warnings" hidden></ul>
    <div class="open-actions">
      <button id="open-analyze" type="button">Analyze</button>
      <button id="open-cancel" type="button">Cancel</button>
    </div>
  </form>
`;

// onAnalyzed(bundle): called with the mounted-ready bundle on a successful analyze. This
// callback is stable across app remounts (defined once in main.js), so the dialog itself
// only needs to be created once.
export function createOpenDialog(onAnalyzed) {
  const dialog = document.createElement("dialog");
  dialog.id = "open-dialog";
  dialog.className = "open-dialog";
  dialog.innerHTML = DIALOG_HTML;
  document.body.appendChild(dialog);

  const els = {
    addFiles: dialog.querySelector("#open-add-files"),
    addFolder: dialog.querySelector("#open-add-folder"),
    clear: dialog.querySelector("#open-clear"),
    ignored: dialog.querySelector("#open-ignored"),
    fileList: dialog.querySelector("#open-file-list"),
    entrySelect: dialog.querySelector("#open-entry-select"),
    projectName: dialog.querySelector("#open-project-name"),
    status: dialog.querySelector("#open-status"),
    warnings: dialog.querySelector("#open-warnings"),
    analyze: dialog.querySelector("#open-analyze"),
    cancel: dialog.querySelector("#open-cancel"),
  };

  let files = new Map(); // path -> text, insertion order
  let ignoredCount = 0;
  let folderName = null;
  let entryTouched = false;
  let selectedEntry = null;
  let nameTouched = false;

  function defaultProjectName() {
    if (folderName) return folderName;
    const first = files.keys().next();
    return first.done ? "" : basenameNoExt(first.value);
  }

  function defaultEntry() {
    if (files.has("main.rb")) return "main.rb";
    if (files.size === 1) return files.keys().next().value;
    return null;
  }

  function renderFileList() {
    els.fileList.innerHTML = "";
    for (const path of files.keys()) {
      const row = document.createElement("div");
      row.className = "open-file-row";
      const label = document.createElement("span");
      label.className = "open-file-path";
      label.textContent = path;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "open-file-remove";
      remove.textContent = "✕";
      remove.title = `Remove ${path}`;
      remove.addEventListener("click", () => {
        files.delete(path);
        renderAll();
      });
      row.append(label, remove);
      els.fileList.appendChild(row);
    }
    els.ignored.hidden = ignoredCount === 0;
    els.ignored.textContent = ignoredCount > 0 ? `${ignoredCount} non-.rb file${ignoredCount === 1 ? "" : "s"} ignored` : "";
  }

  function renderEntrySelect() {
    if (!entryTouched || (selectedEntry && !files.has(selectedEntry))) selectedEntry = defaultEntry();
    els.entrySelect.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "none — static layers only";
    els.entrySelect.appendChild(noneOpt);
    for (const path of files.keys()) {
      const opt = document.createElement("option");
      opt.value = path;
      opt.textContent = path;
      els.entrySelect.appendChild(opt);
    }
    els.entrySelect.value = selectedEntry ?? "";
  }

  function renderProjectName() {
    if (!nameTouched) els.projectName.value = defaultProjectName();
  }

  function renderAll() {
    renderFileList();
    renderEntrySelect();
    renderProjectName();
  }

  async function addFileList(fileList, { stripFirstSegment }) {
    let added = false;
    for (const file of fileList) {
      const relPath = stripFirstSegment ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
      if (!relPath || !/\.rb$/i.test(relPath)) {
        ignoredCount++;
        continue;
      }
      const text = await readText(file);
      files.set(relPath, text);
      added = true;
    }
    if (added) entryTouched = false; // a fresh add re-derives the default entry
    renderAll();
  }

  function setStatus(text, type = "info") {
    if (!text) {
      els.status.hidden = true;
      els.status.textContent = "";
      return;
    }
    els.status.hidden = false;
    els.status.className = "open-status" + (type === "error" ? " error" : "");
    els.status.textContent = text;
  }

  function setWarnings(lines) {
    els.warnings.innerHTML = "";
    if (!lines || lines.length === 0) {
      els.warnings.hidden = true;
      return;
    }
    els.warnings.hidden = false;
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      els.warnings.appendChild(li);
    }
  }

  els.addFiles.addEventListener("change", () => {
    const list = [...els.addFiles.files];
    els.addFiles.value = "";
    addFileList(list, { stripFirstSegment: false });
  });

  els.addFolder.addEventListener("change", () => {
    const list = [...els.addFolder.files];
    if (list.length) folderName = list[0].webkitRelativePath.split("/")[0];
    els.addFolder.value = "";
    addFileList(list, { stripFirstSegment: true });
  });

  els.clear.addEventListener("click", (event) => {
    event.preventDefault();
    files = new Map();
    ignoredCount = 0;
    folderName = null;
    entryTouched = false;
    selectedEntry = null;
    nameTouched = false;
    setStatus(null);
    setWarnings(null);
    renderAll();
  });

  els.entrySelect.addEventListener("change", () => {
    entryTouched = true;
    selectedEntry = els.entrySelect.value || null;
  });

  els.projectName.addEventListener("input", () => {
    nameTouched = true;
  });

  els.cancel.addEventListener("click", () => dialog.close());

  els.analyze.addEventListener("click", async () => {
    if (files.size === 0) {
      setStatus("add at least one .rb file", "error");
      return;
    }
    setWarnings(null);
    setStatus("Analyzing…");
    els.analyze.disabled = true;
    try {
      const payload = {
        name: els.projectName.value.trim() || defaultProjectName() || "project",
        files: [...files.entries()].map(([path, text]) => ({ path, text })),
        entry: selectedEntry,
      };
      let res;
      try {
        res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        setStatus("Analyzing needs the dev server (npm run dev). Import still works.", "error");
        return;
      }
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setStatus("Analyzing needs the dev server (npm run dev). Import still works.", "error");
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setStatus(body.error || `analyze failed (${res.status})`, "error");
        return;
      }
      const bundle = parseBundle(body);
      onAnalyzed(bundle);
      // With warnings, leave the dialog open so they're actually readable — closing
      // immediately would mount the project and hide them in the same instant.
      if (body.warnings?.length) {
        setWarnings(body.warnings);
        setStatus(`Analyzed with ${body.warnings.length} warning(s) — the project is now open.`);
      } else {
        setStatus(null);
        dialog.close();
      }
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      els.analyze.disabled = false;
    }
  });

  renderAll();

  return {
    open: () => dialog.showModal(),
  };
}
