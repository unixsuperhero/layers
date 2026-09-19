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

Layer panel: checkbox per layer, grouped by namespace with a group toggle, mark count
beside each, plus a caret to expand into per-item/per-mark selection — see
[docs/SELECTION-AND-SCENES.md](SELECTION-AND-SCENES.md) Part A for the full tree, tri-state
checkbox and persistence behaviour. Toggling re-computes decorations for that editor only (a
CodeMirror `Compartment` or a `StateEffect` → `StateField`; don't rebuild the editor).
Deviations from that spec: the left column is 260px (not ~220px) and nested rows get a
bordered `.layer-items`/`.item-marks` wrapper (a vertical guide line per level) instead of
flat indentation — both just to keep symbol names legible at this column width.

## Solo mode

Clicking a layer's **name** (or its colour swatch) in the panel solos it — the checkbox
still only toggles it on/off. Clicking a namespace group's name (`vars.*`) solos the
whole group. Clicking the soloed layer's name again clears the solo. A solo value is
either a plain layer id (`"vars.locals"`) or a namespace group (`"vars.*"`); the pure
logic for resolving it — which layer ids it picks out, and cycling forward/back through
the sorted ids — lives in `src/viewer/solo.js` (DOM-free, tested in
`test/viewer-solo.test.js`).

While a solo is active it completely overrides the checkboxes: only the soloed layer(s)
are painted, even if their checkbox is off, and every other layer is hidden even if its
checkbox is on. Soloed marks get the strong `lyr-solo` style — a near-opaque background
in the layer's colour, a 1px outline, bold, and dark (`#10131a`, forced with `!important`
onto the mark and its children — CodeMirror nests a syntax-highlighting span with its own
colour inside every mark, which would otherwise win). Everything else in the file gets
the `code-dim` class (opacity ~0.45), computed in `editor.js` as the complement of the
soloed marks' ranges over the whole document. Soloing `exec.path` is the exception: it
has no inline marks, so it just shows the normal line highlight + non-executed dimming,
with nothing else dimmed.

The soloed row in the layer panel gets a `solo` class (left accent bar) and a `SOLO`
badge; a group solo marks the group header the same way. A `solo: <id> ✕` chip appears
above the editor; its `✕` clears the solo. Keys (same focus guard as the stepper keys):
`]` solos the next layer id, `[` the previous, cycling through the sorted layer ids and
starting from the first when nothing is soloed; `Esc` clears the solo (in addition to its
existing job of clearing the selected symbol). Symbol click/jump and the stepper's
current-statement decoration work unchanged in solo mode.

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
src/viewer/panels.js      files, layers, symbol, stepper DOM + right-column collapsing
src/viewer/nav.js         jump + history stack (pure where possible)
src/viewer/solo.js        solo/focus-mode logic (pure)
src/viewer/selection.js   per-mark selection logic (pure)
src/viewer/scenes.js      presentation (Scenes) logic (pure)
src/viewer/scenes-panel.js  Scenes panel DOM
src/viewer/style.css
```

Pure helpers in the viewer (e.g. history stack, "marks at position", palette assignment)
get `node --test` tests under `test/viewer-*.test.js`; they must not import CodeMirror
or touch the DOM.
