# Viewer spec (phase 1)

A read-only, local web page that paints `layers.json` over source files. Vanilla JS +
CodeMirror 6, served by Vite. No framework. All logic that can be pure lives in
`src/core/` (already built and tested) — the viewer is glue + DOM.

Open with: `npm run dev` → `http://localhost:5173/?project=fixtures/example-ruby`

## Loading

```js
project  = fetch(`/${projectDir}/project.json`)          // { name, root, files[], entry }
doc      = fetch(`/${projectDir}/layers.json`)
sources  = { [file]: text }  ← fetch(`/${projectDir}/${project.root}/${file}`) for each file
validate(doc)  → on failure: show the error list instead of the editor, stop
index    = buildSymbolIndex(doc)
offsets  = { [file]: makeOffsetMap(text) }                // marks are BYTES, CodeMirror wants string indices
```

If `?project=` is missing, default to `fixtures/example-ruby`.

## Layout

```
┌───────────┬──────────────────────────────────────┬──────────────┐
│ Files     │ [invoice.rb] [mailer.rb] [main.rb]   │ Symbol       │
│  invoice  │                                      │  (selected   │
│  mailer   │   CodeMirror (read-only)             │   symbol's   │
│  main     │                                      │   defs/refs) │
│───────────│                                      │──────────────│
│ Layers    │                                      │ Stepper      │
│ ☑ defs.*  │                                      │  ◀◀ ◀ ▶ ▶▶ ⤴ │
│ ☑ vars.*  │                                      │  event 7/24  │
│ ☐ exec.*  │                                      │  stack       │
│           │                                      │  locals      │
└───────────┴──────────────────────────────────────┴──────────────┘
```

Dark theme, monospace, compact. Each layer id gets a stable colour (assign from a fixed
palette by sorted layer id index — deterministic, not random).

## Painting layers

For the open file: collect marks of all **enabled** layers → convert byte offsets to char
offsets → `flatten()` → one `Decoration.mark` per segment with
`class = "lyr " + layers.map(id => "lyr-" + id.replaceAll(".", "-")).join(" ")` and a
`data-marks` attribute (segment's mark indices) so clicks can resolve back to marks.

Styling per namespace so overlaps stay legible (different CSS properties don't fight):

| Namespace | Visual |
|-----------|--------|
| `defs.*`  | bold + coloured text |
| `refs.*`  | coloured underline |
| `vars.*`  | translucent background |
| `vars.temps` | dashed outline/border-bottom in addition |
| `exec.*`  | line-level: faint green line background + gutter dot (use `Decoration.line`), not inline marks |

When `exec.path` is enabled, lines in the file with **no** executed mark are dimmed
(opacity) — "not executed" must be visible, not just absent.

Layer panel: checkbox per layer, grouped by namespace with a group toggle, mark count
beside each. Toggling re-computes decorations for that editor only (a CodeMirror
`Compartment` or a `StateEffect` → `StateField`; don't rebuild the editor).

## Symbols & jumping

- **Click** a mark → select its symbol (if several marks at the click position carry
  different symbols, prefer the innermost = shortest span). All marks of the selected
  symbol in the open file get an extra `sym-selected` highlight (outline). The Symbol
  panel lists `definitions / references / writes / reads` from the index as
  `file:line` rows with the line's text; clicking a row jumps there.
- **Cmd/Ctrl-click** (or double-click) a mark → jump to `jumpTargets(index, symbol)[0]`.
  If there is more than one target, don't guess: select the symbol and let the panel
  list act as the picker. If the clicked mark *is* the jump target, do nothing but select.
- A jump = switch file tab if needed, scroll the span into view (centered), flash it briefly.
- **History**: every jump pushes `{file, pos}`; Back/Forward buttons + `Alt-←` / `Alt-→`.
- `Esc` clears the selected symbol.

## Stepper panel

Only shown when `doc.trace` is non-empty. Drives `createStepper(doc.trace)`.

- Buttons + keys: prev `←`/`k`, next `→`/`j`, step over `n`, step back over `p`,
  step out `o`, first `Home`, last `End`. A range slider scrubs `goto(i)`.
- On every cursor change: open the event's file, scroll to the span, paint a strong
  "current statement" decoration (distinct from `exec.path`), and show
  `event i/N · <event> · depth d`, the `stack()` (click a frame → jump to it), the
  `localsAt()` table, and `value` for return events. Locals that changed since the
  previous displayed event are highlighted.
- The stepper works regardless of which layers are toggled on.

## URL state

`?project=…&file=…&i=…` kept in sync with `history.replaceState` so a reload restores
the open file and stepper cursor.

## File structure

```
index.html
vite.config.js            root = repo root so /fixtures/** is fetchable in dev
src/viewer/main.js        boot: load → validate → wire panels
src/viewer/load.js        fetching + offset maps
src/viewer/editor.js      CodeMirror setup, decorations StateField, click → marks
src/viewer/panels.js      files, layers, symbol, stepper DOM
src/viewer/nav.js         jump + history stack (pure where possible)
src/viewer/style.css
```

Pure helpers in the viewer (e.g. history stack, "marks at position", palette assignment)
get `node --test` tests under `test/viewer-*.test.js`; they must not import CodeMirror
or touch the DOM.
