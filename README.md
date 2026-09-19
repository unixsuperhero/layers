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

## Real Ruby projects, bundles, and Open…

`bin/layers-analyze` (see [adapters/ruby/README.md](adapters/ruby/README.md)) turns real `.rb`
files into a `layers.json` — a static-only pass, or with `--entry FILE` a full execution trace
too:

```sh
cd adapters/ruby && bundle install                      # once
bin/layers-analyze path/to/project --entry main.rb --bundle out.layers-bundle.json
```

The viewer boots from and can export a single **bundle** file (sources + `layers.json` +
presentation + selection + UI state, see [docs/CONTRACT.md](docs/CONTRACT.md) "Bundle"). In
`npm run dev`, the toolbar (top-left) has:

- **Open…** — pick `.rb` files or a folder, choose an entry point, and analyze them in the
  browser (POSTs to `/api/analyze`, a dev-only endpoint — `npm run dev`, not a static build).
- **Import** / drag-and-drop anywhere — load a `.layers-bundle.json` file, like
  `examples/example-ruby.layers-bundle.json` (`npm run example-bundle` regenerates it).
- **Export** — download the current project + view as a `.layers-bundle.json`.

## Side effects & verdicts (docs/ROUND-4.md)

Static side-effect analysis adds `effects.state`/`.global`/`.args`/`.io`/`.control`/
`.calls`/`.unknown` layers and `defs.constants`, plus a per-method `verdict` (`impure` /
`pure` / `unknown`, with its `direct` effect kinds and `via` callees) stored on each
`defs.methods` mark's `data.effects`. In the viewer: `effects.*` layers are off by default
(like `exec.*`), rendered with a tinted background plus a wavy underline in the layer's own
colour, and a hover tooltip built from the mark's data. Method group headers, `defs.methods`
rows, Call Tree rows, and the Symbol panel all show a `●`/`○`/`?` verdict badge; each file's
rail accordion has a compact `all | impure | pure | unknown` filter. See
[docs/VIEWER.md](docs/VIEWER.md) "Effects & verdicts" for the module breakdown.

## Later phases

2. Ruby Coverage → `exec.branches`
3. JS/TS adapter (TypeScript compiler API)
4. tree-sitter fallback adapter
