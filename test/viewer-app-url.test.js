import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppParams, buildAppQuery } from "../src/viewer/app-url.js";

test("parseAppParams reads all known params", () => {
  const parsed = parseAppParams("?project=fixtures/example-ruby&file=invoice.rb&i=5&solo=vars.locals&focus=1&scene=2");
  assert.deepEqual(parsed, {
    project: "fixtures/example-ruby",
    file: "invoice.rb",
    i: "5",
    solo: "vars.locals",
    focus: "1",
    scene: "2",
  });
});

test("parseAppParams: missing params come back null", () => {
  assert.deepEqual(parseAppParams(""), { project: null, file: null, i: null, solo: null, focus: null, scene: null });
});

test("buildAppQuery: only project + file when nothing else is set", () => {
  assert.equal(buildAppQuery({ project: "p", file: "a.rb" }), "project=p&file=a.rb");
});

test("buildAppQuery: omits project when not loaded via ?project=", () => {
  assert.equal(buildAppQuery({ file: "a.rb" }), "file=a.rb");
});

test("buildAppQuery: sceneIndex wins over solo", () => {
  const qs = buildAppQuery({ project: "p", file: "a.rb", sceneIndex: 2, solo: "vars.locals" });
  assert.equal(qs, "project=p&file=a.rb&scene=2");
});

test("buildAppQuery: solo used when no scene is active", () => {
  const qs = buildAppQuery({ project: "p", file: "a.rb", solo: "vars.locals" });
  assert.equal(qs, "project=p&file=a.rb&solo=vars.locals");
});

test("buildAppQuery: focus and i included when set", () => {
  const qs = buildAppQuery({ project: "p", file: "a.rb", i: 5, focus: true });
  assert.equal(qs, "project=p&file=a.rb&i=5&focus=1");
});
