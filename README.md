# layers

Deterministic visual markup layers over source code: definitions, variables, temp
vars, references, execution path, and a replayable stepper — for small example projects,
with cross-file jumps.

Analyzers write a `layers.json`; the viewer paints it. See [docs/CONTRACT.md](docs/CONTRACT.md).

## Phase 1 (this repo today)

The core, built against a generated fixture — no analyzers yet.

| Part | Where |
|------|-------|
| Contract + JSON Schema | `docs/CONTRACT.md`, `schema/layers.schema.json` |
| Reference project | `fixtures/example-ruby/` (`npm run fixture` regenerates `layers.json`) |
| validate / merge / symbols / offsets / flatten / stepper | `src/core/` |
| Viewer (CodeMirror 6) | `index.html`, `src/viewer/` |

```sh
npm install
npm run fixture      # fixture.spec.json → layers.json
npm test
npm run validate fixtures/example-ruby/layers.json
npm run dev          # open http://localhost:5173/?project=fixtures/example-ruby
npm run smoke        # headless-browser assertions + screenshots in scripts/smoke-out/
```

## Later phases

2. Ruby adapter (Prism) → static layers
3. Ruby Coverage → `exec.branches`
4. Ruby TracePoint → `trace[]`
5. JS/TS adapter (TypeScript compiler API)
6. tree-sitter fallback adapter
