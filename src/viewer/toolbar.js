// Toolbar (docs/ROUND-3.md C): Open…/Import/Export next to Back/Forward, the project name,
// and the dismissible inline message area errors are shown in (never alert()). Also wires
// "drop a bundle file anywhere on the window imports it".
import { downloadBundle, readFileAsJson } from "./bundle-io.js";
import { parseBundle, verifySources } from "../core/bundle.js";
import { createValidator } from "../core/validate-core.js";
import schema from "../../schema/layers.schema.json";

const validateDoc = createValidator(schema);

function renderMessage(el, message) {
  el.innerHTML = "";
  if (!message) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = "app-message" + (message.type === "error" ? " error" : "");
  const text = document.createElement("span");
  text.textContent = message.text;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "app-message-close";
  close.title = "Dismiss";
  close.textContent = "✕";
  close.addEventListener("click", () => renderMessage(el, null));
  el.append(text, close);
}

// host: { layout, projectName, buildExportBundle(): bundle, onImportBundle(bundle),
//   onOpenDialog() }
export function wireToolbar(host, { signal }) {
  host.layout.toolbarProjectNameEl.textContent = host.projectName;

  const showMessage = (text, type = "error") => renderMessage(host.layout.appMessageEl, { text, type });
  const clearMessage = () => renderMessage(host.layout.appMessageEl, null);

  async function importJson(json, sourceName) {
    let bundle;
    try {
      bundle = parseBundle(json);
    } catch (err) {
      showMessage(`${sourceName ? `${sourceName}: ` : ""}invalid bundle: ${err.message}`);
      return;
    }
    const result = validateDoc(bundle.doc);
    if (!result.ok) {
      showMessage(`bundle's layers.json failed validation: ${result.errors[0]?.message ?? "invalid"}`);
      return;
    }
    const mismatched = await verifySources(bundle);
    if (mismatched.length) {
      showMessage(`source mismatch, bundle not loaded: ${mismatched.join(", ")}`);
      return;
    }
    clearMessage();
    host.onImportBundle(bundle);
  }

  async function importFile(file) {
    let json;
    try {
      json = await readFileAsJson(file);
    } catch (err) {
      showMessage(err.message);
      return;
    }
    await importJson(json, file.name);
  }

  host.layout.toolbarExportBtn.addEventListener("click", () => downloadBundle(host.buildExportBundle()), { signal });
  host.layout.toolbarOpenBtn.addEventListener("click", () => host.onOpenDialog(), { signal });
  host.layout.toolbarImportBtn.addEventListener("click", () => host.layout.toolbarImportInput.click(), { signal });
  host.layout.toolbarImportInput.addEventListener(
    "change",
    () => {
      const file = host.layout.toolbarImportInput.files[0];
      host.layout.toolbarImportInput.value = "";
      if (file) importFile(file);
    },
    { signal },
  );

  window.addEventListener("dragover", (event) => event.preventDefault(), { signal });
  window.addEventListener(
    "drop",
    (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) importFile(file);
    },
    { signal },
  );

  return { showMessage, clearMessage, importFile, importJson };
}
