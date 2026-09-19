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
│           │                                      │ CALL TREE    │
│           │                                      │  ▾ main.rb   │
│           │                                      │   Invoice#…  │
│           │                                      │──────────────│
│           │                                      │ STEPPER      │
│           │                                      │  ◀◀ ◀ ▶ ▶▶ ⤴ │
│           │                                      │  event 7/24  │
│           │                                      │  stack       │
│           │                                      │  locals      │
└───────────┴──────────────────────────────────────┴──────────────┘
```

The right column is four sections — Scenes, Symbol, Call Tree, Stepper — each scrolling
independently and collapsing when its heading is clicked (state remembered in localStorage).
See "Scenes" and "Call Tree" below.

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

## Call Tree

Full spec: [docs/ROUND-3.md](ROUND-3.md) section "E. Call Stack panel". Right-column section
(only shown when `doc.trace` is non-empty), rendered from `buildCallTree(doc.trace)`
(`src/core/calltree.js`) via two viewer modules:

- `src/viewer/calltree-rows.js` (pure, `node --test`-ed in `test/viewer-calltree-rows.test.js`):
  `groupCallTree(node)` turns the call-tree node into a display tree where consecutive sibling
  BLOCK nodes sharing the same `def` span collapse into one `{ kind: "blockGroup", blocks: […] }`
  node; `buildCallTreeRows(root)` flattens that into `{ display, rows, index }` — `rows` in
  document order with each row's auto-expand ancestor chain (never including a `blockGroup` id,
  since a group only ever expands on an explicit click) and `groupId` when the row is one of a
  group's iterations, `index` mapping a raw node's `enter` to its row. `defaultExpandedIds(rows)`
  expands every row down to call-tree depth 2, collapsing deeper (so the fixture's `block ×2` —
  depth 3 — starts collapsed).
- `src/viewer/calltree-panel.js`: `createCallTreePanel(root, host)` owns per-mount state
  (`expanded` ids, the row that follows the stepper) and renders into `host.containerEl`. Each
  row is two lines: symbol (dim namespace prefix + bright name, e.g. `Invoice#summary`) plus the
  return value right-aligned, then a dim `site → def` (or just `def` for a block/root) meta line
  underneath — kept on its own line rather than truncating the symbol when the column is narrow.
  A root row shows the entry file with meta `(top level)`; a lone block row shows `block`; a
  `block ×N` group row expands to `#1`, `#2`, … iterations. An exception frame (no matching
  return: `value` null, `exit` is the trace's last index, and a `raise` event falls inside it)
  shows `⇒ (raised)`. Hovering a row's title shows `events [enter…exit]`.
- **Click a row** → `host.onGoto(enterIndex)` (wired in `main.js` to `jumpToRef` on the
  call/b_call event's span, then `stepper.goto(enterIndex)`) — the same `goto()` path the stepper
  buttons use (file opens, current-statement decoration + stepper panel update), and recorded in
  jump history like a stack-frame click, so `back()` returns to where you were. Clicking a
  `block ×N` group jumps to its first iteration; a caret click only expands/collapses (no goto).
- **Follows the stepper**: `app-stepper.js`'s `step()` calls `host.onCursorChange()` after every
  cursor-settling action (buttons, keys, slider, scene activation, `stepper.goto`), which
  `main.js` wires to `callTree.follow(cursor)`. `follow` uses `frameAt(root, cursor)` to find the
  innermost node, resolves it to its row (the group row while its `block ×N` run is collapsed,
  the right iteration once expanded), auto-expands that row's ancestors, and scrolls it into view
  (`scrollIntoView({block: "nearest"})`) within the panel. Expanding a group's caret while a
  cursor is active re-resolves and re-scrolls too, so revealing `#2` inside an already-active
  group re-highlights it immediately. Nothing is highlighted before the stepper has been
  interacted with, unless the URL restored `i=`.
- Debug handle: `window.__layers.callTree = { rows(), goto(id) }` — `rows()` returns the
  currently visible rows as `{ id, label, enter, exit, depth, active }`.

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

## Bundles & Open…

Full spec: [docs/ROUND-3.md](ROUND-3.md) section "C. Bundle, import/export, Open…"; the
bundle format itself is in [docs/CONTRACT.md](CONTRACT.md) "Round 3 additions". Summary:

- The app always boots from a **bundle** object (`src/core/bundle.js`: `assembleBundle`,
  `parseBundle`, `bundleKey`, `verifySources`), not directly from a project dir. `?project=dir`
  is just one way to produce one: `load.js` fetches `project.json` + `layers.json` + the
  source files, `main.js` resolves the initial `presentation` (localStorage, else
  `presentation.json`, else empty) and assembles a bundle from all of it.
- `src/viewer/main.js` exports `mountApp(app, bundle, opts)`, which renders the whole app into
  `app` and returns `{ unmount() }`. Calling it again with a different bundle — from Import or
  a successful Open… analyze — remounts without a page reload: every window-level listener
  (keydown, resize drag, drop-to-import) is registered through one `AbortController` per mount
  so the old ones are cleanly dropped, and `editor.destroy()` releases the old CodeMirror view.
  A module-level `remount(bundle, opts)` in `main.js` owns the current app instance.
- **localStorage namespacing**: selection/expanded-accordions/focus (`rail.js`) and
  `presentation` (`app-scenes.js`) are keyed by `bundleKey(bundle)` (project name + a hash of
  the doc's file shas), not the project directory string — two bundles with the same project
  name never clobber each other, and a freshly-imported bundle gets its own key. Rail/right
  column widths (`resize.js`) are a single **global** localStorage key instead, since they're
  a personal UI preference rather than project data.
- **Toolbar** (`toolbar.js`, DOM in `panels.js`'s `buildLayout`, top-left next to Back/Forward):
  `#toolbar-open`, `#toolbar-import` (+ hidden `#toolbar-import-input`), `#toolbar-export`, and
  `#toolbar-project-name`. Export downloads `<name>.layers-bundle.json` (current sources, doc,
  presentation, selection and UI state via `assembleBundle`). Import validates the file
  (`parseBundle` → `createValidator` on `doc` → `verifySources`) and remounts on success;
  dropping a bundle file anywhere on the window does the same. Every error — bad shape, failed
  schema validation, a sha256 mismatch naming the file — shows in the dismissible `#app-message`
  area, never `alert()`; a mismatch leaves the current project mounted.
- **Open… dialog** (`open-dialog.js`, a singleton `<dialog id="open-dialog">` appended to
  `<body>` once, so it survives remounts): "Add files" / "Add folder" accumulate `.rb` files
  into a de-duped, removable list (non-`.rb` files are ignored with a count); an entry-point
  `<select>` preselects `main.rb` or the sole file; **Analyze** POSTs
  `{ name, files: [{path, text}], entry }` to `/api/analyze` and mounts the returned bundle on
  success. A non-JSON response (dev server not running) shows "Analyzing needs the dev server
  (npm run dev). Import still works."; per-file syntax-error warnings from the analyzer are
  shown but the bundle still loads.
- **`server/analyze-plugin.js`**: a Vite `configureServer` plugin adding `POST /api/analyze`
  (wired in `vite.config.js`). Validates the upload (relative paths only, no `..`, no
  backslashes, no duplicates, entry must be one of the files, 5 MB total cap → 413), writes to
  `.layers-work/<random>/src/` (gitignored), runs `bin/layers-analyze` via `execFile` with an
  argument array (never a shell string) under a 30s timeout, returns the bundle JSON plus
  `warnings` (the analyzer's stderr lines), and always deletes the work dir. The request
  handler (`createAnalyzeHandler`) is exported separately from the plugin wrapper so it can be
  unit-tested with fake req/res (`test/analyze-plugin.test.js`).

## File structure

```
index.html
vite.config.js            root = repo root so /fixtures/** is fetchable in dev; wires analyzePlugin
server/analyze-plugin.js  POST /api/analyze (Vite dev plugin) — spawns bin/layers-analyze
src/core/bundle.js         assemble/parse/key/verify a project bundle (pure)
src/viewer/main.js         mountApp(bundle): boot + composition; remount(bundle) on Import/Open…
src/viewer/load.js         fetching + offset maps (?project= path)
src/viewer/app-url.js      URL param parse/build (pure) + syncURL
src/viewer/app-stepper.js  stepper wiring: stepping, painting, panel render, keys' actions
src/viewer/app-scenes.js   scenes wiring: presentation state, CRUD, activation, persistence
src/viewer/app-keys.js     global keydown handling
src/viewer/toolbar.js      Open…/Import/Export + inline message area, drop-to-import
src/viewer/open-dialog.js  the Open… dialog: file/folder pick, entry select, POST /api/analyze
src/viewer/bundle-io.js    download-a-bundle / read-a-File-as-JSON (DOM-facing helpers)
src/viewer/editor.js       CodeMirror setup, decorations StateField, click → marks
src/viewer/panels.js       files, rail, symbol, stepper, toolbar DOM + right-column collapsing
src/viewer/rail-tree.js    Layers rail v2 tree + solo-id resolution (pure)
src/viewer/rail.js         Layers rail v2 state: selection/expanded/solo/focus + persistence
src/viewer/resize.js       rail / right-column drag-to-resize (pure clamp + DOM wiring)
src/viewer/nav.js          jump + history stack (pure where possible)
src/viewer/solo.js         legacy layer/namespace solo-id logic (pure)
src/viewer/selection.js    per-mark selection logic (pure)
src/viewer/scenes.js       presentation (Scenes) pure list logic (add/move/rename/parse/…)
src/viewer/scenes-panel.js Scenes panel DOM
src/viewer/calltree-rows.js Call Tree: call-tree node -> display tree + flat row index (pure)
src/viewer/calltree-panel.js Call Tree panel: render, expand state, follow-the-stepper, click-to-goto
src/viewer/style.css
```

Pure helpers in the viewer (e.g. history stack, "marks at position", palette assignment, URL
param parse/build) get `node --test` tests under `test/viewer-*.test.js`; they must not import
CodeMirror or touch the DOM.
