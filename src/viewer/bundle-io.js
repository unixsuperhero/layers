// DOM-facing bundle helpers: trigger a download, read a File as JSON. Pure bundle logic
// (assemble/parse/verify) lives in src/core/bundle.js.
import { assembleBundle } from "../core/bundle.js";

export function buildExportBundle(parts) {
  return assembleBundle(parts);
}

export function downloadBundle(bundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${bundle.project.name}.layers-bundle.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error(`${file.name} is not valid JSON`));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error(`failed to read ${file.name}`));
    reader.readAsText(file);
  });
}
