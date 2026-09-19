import { createValidator } from "../core/validate-core.js";
import { buildSymbolIndex } from "../core/symbols.js";
import { makeOffsetMap } from "../core/offsets.js";
import schema from "../../schema/layers.schema.json";

const validate = createValidator(schema);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

// Loads a project dir, validates layers.json, fetches sources and builds offset maps + symbol index.
// Returns { ok: false, errors } on validation failure, otherwise { ok: true, project, doc, sources, offsets, index }.
export async function loadProject(projectDir) {
  const project = await fetchJson(`/${projectDir}/project.json`);
  const doc = await fetchJson(`/${projectDir}/layers.json`);

  const result = validate(doc);
  if (!result.ok) return { ok: false, errors: result.errors };

  const sources = {};
  const offsets = {};
  for (const file of project.files) {
    const text = await fetchText(`/${projectDir}/${project.root}/${file}`);
    sources[file] = text;
    offsets[file] = makeOffsetMap(text);
  }

  const index = buildSymbolIndex(doc);

  return { ok: true, project, doc, sources, offsets, index };
}
