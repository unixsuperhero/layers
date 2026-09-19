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
│ Files     │ [invoice.rb] [mailer.rb] [main.rb]   │ SCENES       │
│  invoice  │                                      │  + from view │
│  mailer   │   CodeMirror (read-only)             │  1 …  2 …    │
│  main     │                                      │──────────────│
│───────────│                                      │ SYMBOL       │
│ Layers    │                                      │  (selected   │
│ ☑ defs.*  │                                      │   symbol's   │
│ ☑ vars.*  │                                      │   defs/refs) │
│ ☐ exec.*  │                                      │──────────────│
│           │                                      │ STEPPER      │
│           │                                      │  ◀◀ ◀ ▶ ▶▶ ⤴ │
│           │                                      │  event 7/24  │
│           │                                      │  stack       │
│           │                                      │  locals      │
└───────────┴──────────────────────────────────────┴──────────────┘
```

The right column is three sections — Scenes, Symbol, Stepper — each scrolling independently
and collapsing when its heading is clicked (state remembered in localStorage). See "Scenes"
below.

Dark theme, monospace, compact. Each layer id gets a stable colour (assign from a fixed
palette by sorted layer id index — deterministic, not random).

## Painting layers

For the open file: collect marks of all **enabled** layers → convert byte offsets to char
offsets → `flatten()` → one `Decoration.mark` per segment with
`class = "lyr " + layers.map(id => "lyr-" + id.replaceAll(".", "-")).join(" ")` and a
`data-marks` attribute (segment's mark indices) so clicks can resolve back to marks.

Every enabled inline layer gets a clearly-visible tinted background (~34% alpha) plus a
solid outline, both in the layer's palette colour, so a layer is identifiable at a glance
by matching its colour to the swatch in the layer panel — no click required. A small
per-namespace cue layers on top so overlaps stay legible (different CSS properties don't
fight):

| Namespace | Visual |
|-----------|--------|
| `defs.*`  | + bold text |
| `refs.*`  | + underline (coloured via `--lyr`) |
| `vars.*`  | background + outline only (no extra cue) |
| `vars.temps` | + dashed outline |
| `exec.*`  | line-level: faint green line background + gutter dot (use `Decoration.line`), not inline marks |

The colour itself is never hardcoded in `style.css`: `layerStylesheet` (panels.js) injects
one rule per layer, `.lyr-<id> { --lyr: #… }`, sorted by id so the cascade consistently
picks the alphabetically-last layer's colour when several layers cover a segment. Each
mark also gets an inline `--lyr-bg` (editor.js `markDecorations`) set to the
alphabetically-first layer's colour. `style.css` reads only these two custom properties —
background from `--lyr-bg`, outline from `--lyr` — so a segment covering a single layer
shows one colour twice, and a segment covering several (e.g. `label` is in `vars.locals`
*and* `vars.temps`) shows its background in the first layer's colour and its outline in
the second's, both visible at once.

When `exec.path` is enabled, lines in the file with **no** executed mark are dimmed
(opacity) — "not executed" must be visible, not just absent.

Layer panel: **see "Layers rail v2" below** — this section describes the pre-Round-3 tree
shape historically; the rail itself has been rebuilt.

## Layers rail v2

Full spec: [docs/ROUND-3.md](ROUND-3.md) section "D. Layers rail v2". Summary: the rail is
now a set of nested accordions — **ALL FILES** (the original project-wide namespace →
layer → item → mark tree, unchanged) plus one accordion per visible file, each holding
**Whole file** (that file's layers, marks filtered to it) and one group per method that has
marks (by `mark.data.scope`, in source order, short name as the group label / full symbol
as its tooltip), plus a **(top level)** group for scope-null marks when any exist. Every
level reuses the same layer/item/mark row components over a filtered mark list. Pure tree
construction + solo-id resolution live in `src/viewer/rail-tree.js` (DOM-free, tested in
`test/viewer-rail-tree.test.js`); the stateful wiring (selection, expanded-accordion set,
solo, Focus, persistence) lives in `src/viewer/rail.js`; DOM rendering is
`renderRailPanel` in `panels.js`. `main.js` only wires `rail.js`'s state to the editor.

**Solo** generalizes to a name click at any level — a layer (in ALL FILES or inside a file/
method group), a namespace group, a file, or a method — producing `{ id, label, keys }`
where `id` is a node path (`all/vars.locals`, `file/invoice.rb/scope/Invoice#summary`, …).
`window.__layers.solo(id)` and the URL's `solo=` also still accept the legacy plain forms
(`"vars.locals"`, `"vars.*"`); those resolve independent of the tree and keep their literal
form as `id` (so e.g. `?solo=vars.*` round-trips through the URL unchanged).
`]` / `[` with no scenes still cycle only the ALL FILES layer ids, as before. While a solo
is active, soloed marks get the strong `lyr-solo` style (near-opaque background, 1px
outline, bold, dark text forced with `!important` over CodeMirror's syntax highlighting)
and everything else gets `code-dim` (opacity ~0.45); `exec.path` has no inline marks so
soloing it is just the normal line highlight + non-executed dimming. A `solo: <label> ✕`
chip appears above the editor.

**Focus** is a header toggle (and key `f`, same focus-guard as the stepper keys) that
paints the current `selection` in the strong solo style and dims the rest — a "solo of
everything that's ticked". `state.focus` / `window.__layers.focus(bool)` / URL `focus=1`;
persisted per project. A name-click solo or an active scene temporarily overrides Focus
while active (precedence: scene > solo > Focus > plain selection painting); a scene's
"current view" capture is unchanged, since it already captures whatever is currently
painted.

**exec.path** items show the trimmed source line as their label (e.g. `total = 0`), not
the literal word "executed"; meta stays `file:line`.

**Resizable / horizontal scroll**: drag the rail's right edge or the right column's left
edge (`src/viewer/resize.js`, min 180px, max 60vw, double-click resets, width persisted
per project; dragging disables text selection and editor pointer events). Rows are
`white-space: nowrap` and the rail panel scrolls horizontally instead of ellipsizing.

Deviations from docs/ROUND-3.md D:
- Item/mark **name clicks still jump** (unchanged from docs/SELECTION-AND-SCENES.md Part
  A) rather than soloing, even though the spec's node-level list mentions "an item" — this
  keeps the well-established jump behaviour and matches "ALL FILES … unchanged inside".
  Only layer / namespace-group / file / method levels solo on a name click.
- The caret + checkbox column is **not** sticky while horizontally scrolled. `position:
  sticky` was tried (per the spec's own "if that works cleanly" clause) but doesn't: each
  row is only as wide as its own content, so a short row's sticky pin runs out of room and
  scrolls away with it well before a long row's does. Skipped, per the spec's fallback.
- A file's accordion is forced open every time that file becomes the active one (so
  switching files always "follows" onto the new file's accordion, per the spec) — it
  cannot be permanently collapsed across a file switch, only while it stays the open file.

Debug handle: `window.__layers.solo(idOrNamespaceOrNull)`; `window.__layers.state.solo`
reads the current value.

## Symbols & jumping

- Clicks resolve against **every** non-exec mark in the file, whether or not its layer is
  ticked or soloed — hiding a layer only hides its paint, never its behaviour.
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

## Scenes

A Photoshop-style presentation list (right column, above Symbol/Stepper) for saving,
reordering and replaying named views. See
[docs/SELECTION-AND-SCENES.md](SELECTION-AND-SCENES.md) Part B for the full spec — data
shape, panel controls, activation semantics, keys and persistence. Pure logic lives in
`src/viewer/scenes.js` (`node --test`-ed in `test/viewer-scenes.test.js`); DOM lives in
`src/viewer/scenes-panel.js`. An example presentation for the fixture project is at
[examples/presentation.example-ruby.json](../examples/presentation.example-ruby.json).

Deviations from the spec: scene ids are assigned as the next free `s<N>` (not otherwise
specified); the "pin step" checkbox is a single toolbar-level toggle shared by both
`+ from view` and `⟲ update` (rather than a per-action option), so the debug handle's
`update(id)` takes no options and always captures the toolbar's current pin-step state,
matching what the `⟲` button does; "current view" for a solo override generalizes the
per-file "selection ∩ soloed layer, else whole layer" fallback to the whole project (checked
per soloed layer across all files, since a scene must capture marks project-wide).

## URL state

`?project=…&file=…&i=…&solo=…&scene=…` kept in sync with `history.replaceState` so a
reload restores the open file, stepper cursor, solo (a layer id or `ns.*` group), and the
active scene (1-based index into the scene list; takes precedence over `solo=`).

## File structure

```
index.html
vite.config.js            root = repo root so /fixtures/** is fetchable in dev
src/viewer/main.js        boot: load → validate → wire panels
src/viewer/load.js        fetching + offset maps
src/viewer/editor.js      CodeMirror setup, decorations StateField, click → marks
src/viewer/panels.js      files, rail, symbol, stepper DOM + right-column collapsing
src/viewer/rail-tree.js   Layers rail v2 tree + solo-id resolution (pure)
src/viewer/rail.js        Layers rail v2 state: selection/expanded/solo/focus + persistence
src/viewer/resize.js      rail / right-column drag-to-resize (pure clamp + DOM wiring)
src/viewer/nav.js         jump + history stack (pure where possible)
src/viewer/solo.js        legacy layer/namespace solo-id logic (pure)
src/viewer/selection.js   per-mark selection logic (pure)
src/viewer/scenes.js      presentation (Scenes) logic (pure)
src/viewer/scenes-panel.js  Scenes panel DOM
src/viewer/style.css
```

Pure helpers in the viewer (e.g. history stack, "marks at position", palette assignment)
get `node --test` tests under `test/viewer-*.test.js`; they must not import CodeMirror
or touch the DOM.
