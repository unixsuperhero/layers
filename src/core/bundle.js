// Bundle: one file holding a whole project (sources + doc + presentation + selection + ui).
// Pure, DOM-free — runs in the browser (crypto.subtle) and in node (node:crypto's webcrypto,
// exposed as the same global `crypto` since Node 20). See docs/CONTRACT.md "Bundle".

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

// { project, sources, doc, presentation, selection, ui } -> bundle (fills defaults).
export function assembleBundle({ project, sources, doc, presentation = null, selection = null, ui = null }) {
  return {
    bundle: 1,
    project: { name: project.name, root: project.root, files: [...project.files], entry: project.entry ?? null },
    sources: { ...sources },
    doc,
    presentation: presentation ?? { version: 1, scenes: [] },
    selection: selection ?? null,
    ui: ui ?? null,
  };
}

// Structural validation only (envelope shape) — does not run schema/semantic validation on
// `doc` itself (callers run createValidator separately, per docs/ROUND-3.md C).
export function parseBundle(json) {
  if (!isPlainObject(json)) throw new Error("bundle must be an object");
  if (json.bundle !== 1) throw new Error(`unsupported bundle version: ${JSON.stringify(json.bundle)}`);

  if (!isPlainObject(json.project)) throw new Error("bundle.project must be an object");
  const { name, root, files, entry } = json.project;
  if (typeof name !== "string" || !name) throw new Error("bundle.project.name must be a non-empty string");
  if (typeof root !== "string" || !root) throw new Error("bundle.project.root must be a non-empty string");
  if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === "string")) {
    throw new Error("bundle.project.files must be a non-empty array of strings");
  }
  if (entry !== null && entry !== undefined && typeof entry !== "string") {
    throw new Error("bundle.project.entry must be a string or null");
  }

  if (!isPlainObject(json.sources)) throw new Error("bundle.sources must be an object");
  const sourceFiles = Object.keys(json.sources).sort();
  const projectFiles = [...files].sort();
  if (JSON.stringify(sourceFiles) !== JSON.stringify(projectFiles)) {
    throw new Error(
      `bundle.sources files do not match bundle.project.files (sources: ${sourceFiles.join(", ") || "(none)"}; project: ${projectFiles.join(", ")})`,
    );
  }
  for (const file of files) {
    if (typeof json.sources[file] !== "string") throw new Error(`bundle.sources["${file}"] must be a string`);
  }

  if (!isPlainObject(json.doc)) throw new Error("bundle.doc must be an object");

  const presentation =
    isPlainObject(json.presentation) && Array.isArray(json.presentation.scenes)
      ? { version: 1, scenes: json.presentation.scenes }
      : { version: 1, scenes: [] };
  const selection = Array.isArray(json.selection) ? [...json.selection] : null;
  const ui = isPlainObject(json.ui) ? { ...json.ui } : null;

  return {
    bundle: 1,
    project: { name, root, files: [...files], entry: entry ?? null },
    sources: { ...json.sources },
    doc: json.doc,
    presentation,
    selection,
    ui,
  };
}

// Small synchronous string hash (FNV-1a) — bundleKey must be sync, unlike verifySources'
// sha256 (crypto.subtle is async-only), and doesn't need to be cryptographic: it only
// namespaces localStorage keys per project+content.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Stable id = project name + short hash of the doc's file shas (sorted, so key order in
// doc.files never matters), used to namespace localStorage per bundle.
export function bundleKey(bundle) {
  const shas = [...bundle.project.files]
    .sort()
    .map((f) => `${f}:${bundle.doc.files?.[f]?.sha ?? ""}`)
    .join(",");
  return `${bundle.project.name}-${fnv1a(shas)}`;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Recomputes sha256 of every source against doc.files[file].sha; returns the list of files
// whose hash differs (empty = ok). A file with no sha recorded in doc.files is skipped.
export async function verifySources(bundle) {
  const mismatched = [];
  for (const file of bundle.project.files) {
    const expected = bundle.doc.files?.[file]?.sha;
    if (!expected) continue;
    const actual = await sha256Hex(bundle.sources[file] ?? "");
    if (actual !== expected) mismatched.push(file);
  }
  return mismatched;
}
