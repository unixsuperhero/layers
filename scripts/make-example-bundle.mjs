#!/usr/bin/env node
// Builds examples/example-ruby.layers-bundle.json from fixtures/example-ruby (project.json +
// layers.json + sources) and examples/presentation.example-ruby.json — a ready-made bundle
// to try Import with. Usage: node scripts/make-example-bundle.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assembleBundle, parseBundle } from "../src/core/bundle.js";
import { parsePresentation } from "../src/viewer/scenes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PROJECT_DIR = path.join(REPO_ROOT, "fixtures", "example-ruby");
const OUT_FILE = path.join(REPO_ROOT, "examples", "example-ruby.layers-bundle.json");

const project = JSON.parse(readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
const doc = JSON.parse(readFileSync(path.join(PROJECT_DIR, "layers.json"), "utf8"));

const sources = {};
for (const file of project.files) {
  sources[file] = readFileSync(path.join(PROJECT_DIR, project.root, file), "utf8");
}

const presentationJson = JSON.parse(readFileSync(path.join(REPO_ROOT, "examples", "presentation.example-ruby.json"), "utf8"));
const { presentation, dropped } = parsePresentation(presentationJson, doc);
if (dropped > 0) throw new Error(`presentation.example-ruby.json: ${dropped} mark(s) don't exist in the fixture doc`);

const bundle = assembleBundle({
  project,
  sources,
  doc,
  presentation,
  selection: null,
  ui: { file: "invoice.rb", solo: null, focus: false, scene: null, i: null, railWidth: 260 },
});

// Round-trip through parseBundle so a shape mistake here fails loudly, not silently.
parseBundle(JSON.parse(JSON.stringify(bundle)));

writeFileSync(OUT_FILE, JSON.stringify(bundle, null, 2) + "\n");
console.log(`${path.relative(REPO_ROOT, OUT_FILE)}: ${project.files.length} sources, ${presentation.scenes.length} scenes`);
