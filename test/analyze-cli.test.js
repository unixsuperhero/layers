import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { validate } from '../src/core/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'layers-analyze');
const FIXTURE_SRC = path.join(REPO_ROOT, 'fixtures', 'example-ruby', 'src');
const FIXTURE_SPEC = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'fixtures', 'example-ruby', 'fixture.spec.json'), 'utf8'),
);
const SAMPLES = path.join(REPO_ROOT, 'adapters', 'ruby', 'test', 'samples');

function tmpDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args) {
  return spawnSync(CLI, args, { encoding: 'utf8' });
}

function lineOf(source, byteOffset) {
  const bytes = Buffer.from(source, 'utf8');
  let line = 1;
  for (let i = 0; i < byteOffset; i++) if (bytes[i] === 0x0a) line++;
  return line;
}

test('bundle install is present (adapters/ruby/vendor/bundle)', () => {
  // A friendly failure here beats a cryptic Bundler stack trace from every other test.
  const lock = path.join(REPO_ROOT, 'adapters', 'ruby', 'Gemfile.lock');
  assert.ok(existsSync(lock), 'adapters/ruby/Gemfile.lock missing -- run `bundle install` in adapters/ruby');
});

test('static + dynamic analysis of the fixture validates and is byte-identical across runs', () => {
  const outA = tmpDir('layers-a-');
  const outB = tmpDir('layers-b-');
  try {
    const a = run([FIXTURE_SRC, '--entry', 'main.rb', '--out', outA]);
    assert.equal(a.status, 0, a.stderr);
    const b = run([FIXTURE_SRC, '--entry', 'main.rb', '--out', outB]);
    assert.equal(b.status, 0, b.stderr);

    const jsonA = readFileSync(path.join(outA, 'layers.json'), 'utf8');
    const jsonB = readFileSync(path.join(outB, 'layers.json'), 'utf8');
    assert.equal(jsonA, jsonB, 'two runs produced different bytes');

    const doc = JSON.parse(jsonA);
    const result = validate(doc);
    assert.deepEqual(result.errors, []);
    assert.ok(result.ok);
  } finally {
    rmSync(outA, { recursive: true, force: true });
    rmSync(outB, { recursive: true, force: true });
  }
});

test('--bundle produces a valid bundle whose source shas match doc.files', () => {
  const out = tmpDir('layers-bundle-');
  const bundlePath = path.join(out, 'out.bundle.json');
  try {
    const r = run([FIXTURE_SRC, '--entry', 'main.rb', '--bundle', bundlePath]);
    assert.equal(r.status, 0, r.stderr);

    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
    assert.deepEqual(Object.keys(bundle).sort(), ['bundle', 'doc', 'presentation', 'project', 'selection', 'sources', 'ui'].sort());
    assert.equal(bundle.bundle, 1);

    const result = validate(bundle.doc);
    assert.ok(result.ok, JSON.stringify(result.errors));

    for (const file of Object.keys(bundle.doc.files)) {
      const sha = createSha256(bundle.sources[file]);
      assert.equal(sha, bundle.doc.files[file].sha, `${file}: source sha mismatch`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

function createSha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

test('static layers are a superset of the hand-written fixture (same layer/file/start/end/symbol/role/scope)', () => {
  const out = tmpDir('layers-static-');
  try {
    const r = run([FIXTURE_SRC, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const mine = JSON.parse(readFileSync(path.join(out, 'layers.json'), 'utf8'));
    const fixture = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'fixtures', 'example-ruby', 'layers.json'), 'utf8'),
    );

    const key = (m) => `${m.file}:${m.start}:${m.end}:${m.symbol}:${m.role}`;
    for (const layer of fixture.layers) {
      if (layer.id === 'exec.path') continue; // dynamic; requires --entry, checked separately below
      const mineLayer = mine.layers.find((l) => l.id === layer.id);
      assert.ok(mineLayer, `missing layer ${layer.id}`);
      const mineByKey = new Map(mineLayer.marks.map((m) => [key(m), m]));
      for (const fm of layer.marks) {
        const mm = mineByKey.get(key(fm));
        assert.ok(mm, `${layer.id}: missing mark ${key(fm)}`);
        assert.equal(mm.data.scope, fm.data.scope, `${layer.id} ${key(fm)}: data.scope differs`);
      }
    }
    // Known/expected: for THIS fixture the analyzer's output happens to match exactly (no
    // legitimate extra/omitted static marks) -- see the Ruby analyzer's final report for the
    // full difference list methodology; nothing to special-case here.
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('trace: the fixture\'s 24 hand-written events are an in-order subsequence of the real TracePoint trace', () => {
  // Real TracePoint output is a legitimate SUPERSET of the hand-written fixture: loading each
  // file also fires top-level `line` events for `require_relative`, the `class`/`module`
  // bodies, and each `def` statement itself (all real, all at depth 0, all before the entry's
  // own code starts running) -- the hand-written fixture skips straight to executing main.rb's
  // first real statement. See docs/ROUND-3.md section A + the analyzer's final report.
  const out = tmpDir('layers-trace-');
  try {
    const r = run([FIXTURE_SRC, '--entry', 'main.rb', '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(path.join(out, 'layers.json'), 'utf8'));

    const sources = {
      'invoice.rb': readFileSync(path.join(FIXTURE_SRC, 'invoice.rb'), 'utf8'),
      'mailer.rb': readFileSync(path.join(FIXTURE_SRC, 'mailer.rb'), 'utf8'),
      'main.rb': readFileSync(path.join(FIXTURE_SRC, 'main.rb'), 'utf8'),
    };

    const expected = FIXTURE_SPEC.trace.map(([event, file, line, depth]) => `${event}|${file}|${line}|${depth}`);
    const actual = doc.trace.map((ev) => `${ev.event}|${ev.file}|${lineOf(sources[ev.file], ev.start)}|${ev.depth}`);

    let ai = 0;
    for (const exp of expected) {
      while (ai < actual.length && actual[ai] !== exp) ai++;
      assert.ok(ai < actual.length, `expected trace event not found in order: ${exp}`);
      ai++;
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('trace[n].i === n', () => {
  const out = tmpDir('layers-i-');
  try {
    const r = run([FIXTURE_SRC, '--entry', 'main.rb', '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(path.join(out, 'layers.json'), 'utf8'));
    doc.trace.forEach((ev, i) => assert.equal(ev.i, i));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a mix of files and directories as input is accepted', () => {
  const out = tmpDir('layers-mix-');
  try {
    const r = run([path.join(FIXTURE_SRC, 'invoice.rb'), path.join(SAMPLES, 'nested'), '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(path.join(out, 'layers.json'), 'utf8'));
    assert.ok(Object.keys(doc.files).some((f) => f.endsWith('invoice.rb')));
    assert.ok(Object.keys(doc.files).some((f) => f.endsWith('nested.rb')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a syntax error in one file is reported per-file, exit 0, other files still analysed', () => {
  const out = tmpDir('layers-syntax-');
  try {
    const dir = path.join(SAMPLES, 'syntax_error');
    const r = run([dir, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /broken\.rb:\d+: .+/);

    const doc = JSON.parse(readFileSync(path.join(out, 'layers.json'), 'utf8'));
    assert.ok(doc.files['broken.rb'], 'broken.rb should still be in files{}');
    assert.ok(doc.files['ok.rb'], 'ok.rb should still be in files{}');
    const defs = doc.layers.find((l) => l.id === 'defs.classes');
    assert.ok(defs.marks.some((m) => m.file === 'ok.rb'), 'ok.rb should still contribute marks');
    assert.ok(!defs.marks.some((m) => m.file === 'broken.rb'), 'broken.rb should contribute no marks');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a nonexistent input path fails with a one-line error and non-zero exit', () => {
  const r = run(['/no/such/path/at/all', '--out', tmpDir('layers-missing-')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /^error: /m);
});

test('neither --out nor --bundle given fails with a clear error', () => {
  const r = run([FIXTURE_SRC]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /^error: /m);
});

test('an entry that raises: trace kept up to the raise, warning on stderr, exit 0', () => {
  const out = tmpDir('layers-raises-');
  try {
    const r = run([path.join(SAMPLES, 'raises'), '--entry', 'entry.rb', '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /warn:.*raise/i);

    const doc = JSON.parse(readFileSync(path.join(out, 'layers.json'), 'utf8'));
    assert.ok(doc.trace.some((ev) => ev.event === 'raise'), 'expected a raise event in the trace');
    const result = validate(doc);
    assert.ok(result.ok, JSON.stringify(result.errors));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('an entry that loops forever: 10s timeout, clear error, non-zero exit, no orphan process', { timeout: 20000 }, () => {
  const out = tmpDir('layers-loop-');
  try {
    const before = Date.now();
    const r = run([path.join(SAMPLES, 'loops'), '--entry', 'entry.rb', '--out', out]);
    const elapsed = Date.now() - before;
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /^error: .*timed out/m);
    assert.ok(elapsed < 15000, `expected the 10s timeout to fire promptly, took ${elapsed}ms`);
    assert.ok(!existsSync(path.join(out, 'layers.json')), 'no output should be written on timeout');

    // Best-effort orphan check (darwin/linux): nothing should still be running the sample's entry.rb.
    const ps = spawnSync('pgrep', ['-f', 'adapters/ruby/test/samples/loops'], { encoding: 'utf8' });
    assert.equal((ps.stdout || '').trim(), '', 'a traced child process was left running');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
