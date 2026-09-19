import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createAnalyzeHandler } from "../server/analyze-plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WORK_ROOT = path.join(REPO_ROOT, ".layers-work-test");

function fakeReq(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return Readable.from([text]);
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      this.body = chunk ? JSON.parse(chunk) : null;
    },
  };
  return res;
}

function makeHandler(overrides = {}) {
  return createAnalyzeHandler({ repoRoot: REPO_ROOT, workRoot: WORK_ROOT, ...overrides });
}

test("rejects a non-JSON body", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(fakeReq("not json"), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /valid JSON/);
});

test("rejects a body that isn't an object", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(fakeReq(JSON.stringify([1, 2])), res);
  assert.equal(res.statusCode, 400);
});

test("rejects a missing name", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ files: [{ path: "a.rb", text: "x" }], entry: null }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /name/);
});

test("rejects an empty files list", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ name: "p", files: [], entry: null }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /files/);
});

test("rejects an absolute path", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ name: "p", files: [{ path: "/etc/passwd", text: "x" }], entry: null }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /relative/);
});

test("rejects a path with .. segments", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ name: "p", files: [{ path: "../evil.rb", text: "x" }], entry: null }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /\.\./);
});

test("rejects a path with backslashes", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ name: "p", files: [{ path: "lib\\a.rb", text: "x" }], entry: null }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /backslash/);
});

test("rejects duplicate paths", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(
    fakeReq({ name: "p", files: [{ path: "a.rb", text: "x" }, { path: "a.rb", text: "y" }], entry: null }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /duplicate/);
});

test("rejects an entry not among the files", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ name: "p", files: [{ path: "a.rb", text: "x" }], entry: "b.rb" }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /entry/);
});

test("rejects a total upload over 5 MB with 413", async () => {
  const handler = makeHandler();
  const res = fakeRes();
  const big = "x".repeat(6 * 1024 * 1024);
  await handler(fakeReq({ name: "p", files: [{ path: "a.rb", text: big }], entry: null }), res);
  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /too large/);
});

test(".layers-work is cleaned up even on a validation failure", async () => {
  assert.ok(!existsSync(WORK_ROOT) || readdirSync(WORK_ROOT).length === 0);
});

// Real end-to-end run through the actual Ruby analyzer, only when it's present (another
// agent builds adapters/ruby + bin/layers-analyze concurrently).
const CLI = path.join(REPO_ROOT, "bin", "layers-analyze");
const cliReady = existsSync(CLI) && existsSync(path.join(REPO_ROOT, "adapters", "ruby", "Gemfile.lock"));

test("end-to-end: valid files analyze successfully and clean up the work dir", { skip: !cliReady }, async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(
    fakeReq({
      name: "smoke-project",
      files: [
        { path: "main.rb", text: "class Foo\n  def bar\n    1\n  end\nend\nFoo.new.bar\n" },
      ],
      entry: "main.rb",
    }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.bundle, 1);
  assert.equal(res.body.project.name, "smoke-project");
  assert.ok(Array.isArray(res.body.warnings));
  assert.ok(!existsSync(WORK_ROOT) || readdirSync(WORK_ROOT).length === 0);
});

test("end-to-end: a per-file syntax error is reported as a warning but the bundle still loads", { skip: !cliReady }, async () => {
  const handler = makeHandler();
  const res = fakeRes();
  await handler(
    fakeReq({
      name: "smoke-project-2",
      files: [{ path: "broken.rb", text: "def broken(\n" }],
      entry: null,
    }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.bundle, 1);
});
