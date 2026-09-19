// Round 4 (docs/ROUND-4.md "B. Web viewer"): fixtures/example-ruby/layers.json's STATIC
// layers must be IDENTICAL (layer ids, marks, symbols, roles, full data) to what
// `bin/layers-analyze fixtures/example-ruby/src --stdout` really emits — not just a superset
// (that relaxed check already lives in test/analyze-cli.test.js). This is what lets the
// viewer's fixture stand in for a real analyzed project in tests/smoke/guide-shots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLI = path.join(REPO_ROOT, "bin", "layers-analyze");
const FIXTURE_SRC = path.join(REPO_ROOT, "fixtures", "example-ruby", "src");
const FIXTURE_JSON = path.join(REPO_ROOT, "fixtures", "example-ruby", "layers.json");

function markKey(m) {
  return `${m.file}\0${m.start}\0${m.end}\0${m.symbol}\0${m.role}`;
}

test("fixtures/example-ruby/layers.json static layers exactly match `bin/layers-analyze --stdout`", (t) => {
  const result = spawnSync(CLI, [FIXTURE_SRC, "--stdout"], { encoding: "utf8" });
  if (result.status !== 0 || result.error) {
    t.skip(`bin/layers-analyze unavailable (adapters/ruby gems not installed?): ${result.stderr || result.error}`);
    return;
  }

  const real = JSON.parse(result.stdout);
  const fixture = JSON.parse(readFileSync(FIXTURE_JSON, "utf8"));

  const realStatic = real.layers; // --stdout without --entry: only static layers are produced
  const fixtureStatic = fixture.layers.filter((l) => l.kind === "static");

  assert.deepEqual(
    fixtureStatic.map((l) => l.id).sort(),
    realStatic.map((l) => l.id).sort(),
    "static layer ids differ",
  );

  for (const fixtureLayer of fixtureStatic) {
    const realLayer = realStatic.find((l) => l.id === fixtureLayer.id);
    assert.ok(realLayer, `analyzer produced no ${fixtureLayer.id} layer`);

    const fixtureByKey = new Map(fixtureLayer.marks.map((m) => [markKey(m), m]));
    const realByKey = new Map(realLayer.marks.map((m) => [markKey(m), m]));

    assert.deepEqual(
      [...fixtureByKey.keys()].sort(),
      [...realByKey.keys()].sort(),
      `${fixtureLayer.id}: mark set differs`,
    );

    for (const [key, fixtureMark] of fixtureByKey) {
      const realMark = realByKey.get(key);
      assert.deepEqual(fixtureMark.data, realMark.data, `${fixtureLayer.id} ${key}: data differs`);
    }
  }
});
