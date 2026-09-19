# Round 3 — real analysis, bundles, layers rail v2, call tree

Five work packages. Contract changes are in docs/CONTRACT.md ("Round 3 additions").

```js
packages = {
  A: "Ruby analyzer CLI: files/folders in → layers.json (Prism static layers + TracePoint trace)",
  B: "core call tree: trace[] → nested calls (pure)",
  C: "Bundle: one file with sources + parsed info + presentation; import/export; in-app Open… (files or folder) → analyze",
  D: "Layers rail v2: resizable, horizontal scroll, nested accordions (All Files / per file / per method), Focus switch",
  E: "Call Stack panel: readable call tree that drives the stepper",
}
order = "A ∥ B ∥ D  →  C  →  E"
```

## A. Ruby analyzer

```sh
bin/layers-analyze <file-or-dir>… [--entry FILE] [--root DIR] [--out DIR] [--bundle FILE] [--name NAME]
```

- Inputs: any mix of `.rb` files and directories (recursed for `**/*.rb`; skip `vendor/`, `node_modules/`, `.git/`, `tmp/`). `--root` = directory the project-relative paths are computed from (default: the common ancestor of all inputs).
- `--entry FILE` (optional): the script to RUN for the execution path. Without it the output has static layers only and no `trace`. **The entry point is the only thing a user must choose up front, and only if they want exec path / stepping.**
- `--out DIR` writes a project dir (`project.json`, `src/**` copies, `layers.json`) usable via `?project=`. `--bundle FILE` writes a single bundle file (see CONTRACT). At least one of the two is required.
- Exit 0 on success; non-zero with a one-line `error: …` on stderr. A Ruby syntax error in an input file is reported per file (`file:line: message`) and that file contributes no marks but is still included as a source; analysis continues.
- Output must pass `node bin/layers-validate.mjs` and be byte-identical across runs (canonical sort, no timestamps, no absolute paths, no object ids like `#<Invoice:0x000…>` — normalise inspected values to `#<Invoice>`).

Implementation: Ruby, under `adapters/ruby/` (`analyze.rb` static, `trace.rb` dynamic, `lib/*.rb`), parser = **Prism** (a current 1.x via `adapters/ruby/Gemfile`; the Ruby 3.3 bundled 0.19 is too old to rely on). `bin/layers-analyze` is a thin launcher.

Static layers (every mark carries `data.scope`):

| Layer | Marks |
|-------|-------|
| `defs.classes` | class/module name at its definition → symbol `Foo::Bar` |
| `defs.methods` | method name at `def` → `Foo#bar` (instance), `Foo.bar` (singleton / `def self.`), `main#bar` (top level) |
| `defs.attributes` | each symbol arg of `attr_reader/writer/accessor` → `Foo#name` |
| `vars.locals` | every local/param/block-param read & write → `<scope>/<name>` (top level: `main/<name>`). Use Prism's `depth` so a block reading an outer local resolves to the OUTER binding; a block-local or block param is `<scope>/<name>` too unless it shadows, then `<scope>/<name>@<line of block>` |
| `vars.ivars` | `@x` reads/writes → `Foo@x` |
| `vars.temps` | subset of `vars.locals`: kind local (not param), exactly 1 write, ≤ 2 reads, never touched inside a nested block |
| `refs.constants` | constant reads resolved by lexical nesting against project-defined classes → same symbol as the definition; unresolved constants (stdlib etc.) are skipped |
| `refs.calls` | call-site method name (`message_loc`). Resolution order: `Foo.new` → `Foo#initialize` if defined; explicit constant receiver → `Foo.bar`; implicit/self receiver → method of the enclosing class if defined; otherwise name-match across the project: exactly one def with that name → it; several or none → skipped (v1). Calls to `attr_*`-defined readers resolve to the attribute symbol |

Dynamic (`--entry`): run the entry with `TracePoint` (`:call :return :line :b_call :b_return :raise`), filtered to project files, executed with cwd = the entry's directory inside a **copy** of the project (never in the user's original tree), stdout/stderr of the program captured (not mixed into our output), 10s timeout → error. Spans: `line`/`return`/`b_return` events = the trimmed source line; `call` = the `def …` line; `b_call` = the line where the block opens. `depth` = 0 at top level, +1 per call/block. `locals`: `binding.local_variables` inspected (truncate to 80 chars, normalise object ids) on `line` events, `null` elsewhere. `value` on `return`. `symbol`/`recv` on `call`/`return` from `defined_class`/`method_id`/`self.class` using the same symbol scheme as `defs.methods`. Layer `exec.path` = unique trace spans, `role: "executed"`, `kind: "dynamic"`.

Tests: `adapters/ruby/test/` (minitest) + a node test that runs the CLI on `fixtures/example-ruby/src` with `--entry main.rb` and asserts: validates OK; byte-identical on a second run; the static layers contain (at least) every mark of the hand-written fixture's static layers with the same (layer, file, start, end, symbol, role) — report any differences rather than hiding them; `data.scope` matches the fixture's; the trace's sequence of `(event, file, line-of-start, depth)` equals the fixture's 24 events (if real TracePoint differs from the hand-written trace, the REAL one wins — document the diff in the report and do NOT edit fixtures/). Also a second small Ruby sample under `adapters/ruby/test/samples/` exercising: nested modules, `def self.x`, a block that mutates an outer local (so it is NOT a temp), a shadowing block param, top-level methods, a syntax-error file.

## B. Call tree (core, pure)

`src/core/calltree.js` — see CONTRACT. Tests use the fixture trace.

## C. Bundle, import/export, Open…

- Bundle format: CONTRACT. The viewer boots from a bundle object; `?project=dir` becomes "fetch the pieces, assemble a bundle". Everything downstream (`validate`, symbol index, offsets, panels) takes it from the bundle.
- **Export** (toolbar, top-left next to Back/Forward): downloads `<name>.layers-bundle.json` = sources + doc + CURRENT presentation + current selection + UI bits (open file, solo/focus, stepper cursor, rail width). **Import**: file input → validate (bundle shape, then `createValidator` on `doc`, and sha256 of each source must equal `doc.files[file].sha` — use `crypto.subtle`) → replace the whole app state, no reload. Errors shown inline, never `alert()`.
- localStorage keys are per project NAME+content hash so two bundles don't clobber each other's selection/scenes.
- **Open…** dialog (toolbar): "Add files" (`<input type=file multiple accept=".rb">`) and "Add folder" (`<input type=file webkitdirectory>`), accumulating into a list with per-row remove; shows relative paths; a dropdown "Entry point (to record the execution path)" listing the files + "none — static layers only"; **Analyze** button. POSTs `{ name, files: [{ path, text }], entry }` to `/api/analyze`; shows progress and any per-file syntax errors / failure message inline; on success loads the returned bundle.
- `/api/analyze`: a Vite dev-server plugin (`server/analyze-plugin.js`, wired in vite.config.js) that writes the files to a fresh dir under `.layers-work/` (gitignored), runs `bin/layers-analyze … --bundle`, returns the bundle JSON, cleans up. Reject paths that are absolute or contain `..`; cap total upload at 5 MB. It only exists under `npm run dev` — the dialog must say so if the endpoint is missing (e.g. a static build), while Import still works everywhere.

## D. Layers rail v2

All groupings are views over the same `selection: Set<markKey>`; every checkbox is derived tri-state. Uses `mark.data.scope` (null = file level).

```
▾ ALL FILES                                  project-wide, as today
   ▾ ☑ defs.*
      ▸ ☑ ■ defs.methods          5
   ▸ ☑ vars.*  …
▾ invoice.rb                                 one accordion per VISIBLE file (today: the open file;
   ▾ Whole file                              keep `visibleFiles` an array — split-screen is coming)
      ▸ ☑ ■ defs.methods          3          layers restricted to marks in this file
      ▸ ◪ ■ vars.locals        8/9
   ▾ summary                                 one group per method that has marks (data.scope), source order
      ▸ ☑ ■ vars.locals           5
      ▸ ☑ ■ vars.temps            2          ← "this method's temp vars"
   ▸ initialize
   ▸ overdue?
   ▸ (top level)                             marks with scope null, only if any
```

- Layer rows at every level expand to items → marks exactly as today (same components, given a filtered mark list).
- Accordion open/closed state persists (localStorage). Default: All Files open; the visible file's accordion open with "Whole file" collapsed and its methods collapsed.
- **Name click = solo that node**, at ANY level (a layer in All Files, a file, a method, a method's layer, an item). Solo becomes `{ id, label, keys }` where id is a node path (`all/vars.locals`, `all/vars.*`, `file/invoice.rb`, `file/invoice.rb/scope/Invoice#summary`, `file/invoice.rb/scope/Invoice#summary/vars.temps`). URL `solo=` accepts those ids and still accepts the legacy `vars.locals` / `vars.*` forms. `]`/`[` with no scenes keep cycling the All Files layers.
- **Focus switch** in the Layers header (`Focus` toggle, key `f`): when ON, the view is painted like a solo of *everything that is ticked* — strong style for the selection, the rest dimmed. It is the multi-layer "solo". It composes with the tree (tick two methods' temps + Focus). A name-click solo or an active scene temporarily overrides it. Persisted; in the URL as `focus=1`; included in scene capture ("current view") automatically since capture = painted keys.
- exec.path items: label = the trimmed source text of that line (not the word "executed"), with `file:line` as meta.
- **Resizable**: drag the rail's right edge (also the right column's left edge); min 180px, max 60vw; double-click the edge resets; width persisted. **Horizontal scroll**: no ellipsis anywhere in the rail — rows are `white-space: nowrap`, the panel scrolls horizontally, and the checkbox/caret column stays sticky on the left while scrolling if that is cheap to do. Show full symbol names in All Files; inside a method group show the short name (after the last `#` `/` `.`), full symbol in the tooltip.
- The Files list above the rail stays.

## E. Call Stack panel

Right column section "Call Tree" (collapsible like the others, between Symbol and Stepper), rendered from `buildCallTree(doc.trace)`:

```
▾ main.rb                                 (top level)
   ▸ Invoice#initialize      main.rb:4 → invoice.rb:5        ⇒ [10, 32]
   ▾ Mailer#notify           main.rb:5 → mailer.rb:4         ⇒ nil
      ▾ Invoice#summary      mailer.rb:5 → invoice.rb:9      ⇒ "Total: 42"
           block ×2          invoice.rb:11
      ▸ Mailer#deliver       mailer.rb:6 → mailer.rb:9       ⇒ nil
```

- A row = one call: symbol, call site → definition, return value. Consecutive sibling blocks from the same line collapse into `block ×N` (expandable to the N iterations).
- Click a row → stepper `goto(call.enter)` (history-recorded jump). The row containing the stepper's current event is highlighted and auto-expanded/scrolled into view as you step. Hover shows the event range `[enter…exit]`.
- A small depth-first "executed lines" reading order is NOT needed — this panel replaces reading `exec.path`'s flat item list.
- Hidden when there is no trace.
