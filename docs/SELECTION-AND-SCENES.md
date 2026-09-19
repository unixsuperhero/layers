# Item selection + Scenes (presentation list)

Two features on top of docs/VIEWER.md. Neither changes `layers.json` or anything in
`src/core/` — the official layer list stays read-only. All new state is viewer-side.

## Shared vocabulary

```js
markKey = "defs.methods|invoice.rb|147|154"     // layer|file|startByte|endByte — identifies ONE mark
item    = { symbol: "Invoice#summary/total", marks: [markKey, markKey, markKey] }
//        a layer's marks grouped by symbol (order: first appearance by file,start).
//        marks with symbol === null are each their own item.
selection = Set<markKey>                        // which marks are ON. default: every mark of every
                                                // static layer ON, dynamic (exec.*) layers OFF
```

`selection` REPLACES the old per-layer boolean (`layerState`). A layer's checkbox is derived:
all marks on = checked, none = unchecked, some = indeterminate.

## Part A — select individual items inside a layer (left panel)

```
▸ ☑ ■ defs.methods        5        collapsed (as today, plus a caret)
▾ ◪ ■ defs.methods      3/5        expanded, partial → indeterminate checkbox, count "on/total"
     ☑ Invoice#initialize    invoice.rb:5
     ☐ Invoice#summary       invoice.rb:9
     ☑ Invoice#overdue?      invoice.rb:18
     ☐ Mailer#notify         mailer.rb:4
     ☑ Mailer#deliver        mailer.rb:9
▾ ☑ ■ vars.locals        17
   ▸ ☑ Invoice#summary/total   ×3       an item with several marks has its own caret
   ▾ ◪ Invoice#summary/item    1/2
        ☑ write  invoice.rb:11
        ☐ read   invoice.rb:12
```

- Caret expands a layer into its items; an item with >1 mark expands into its marks
  (`role file:line`). Single-mark items show `file:line` inline and have no caret.
- Checkbox at any level toggles everything beneath it. Layer and group checkboxes keep
  working exactly as before (now implemented as "set all marks under me").
- Clicking an item's/mark's **label** (not checkbox) jumps to it (history-recorded), like a
  Symbol-panel row. Clicking a layer NAME still solos the layer.
- Items from files other than the open one are listed too (it's project-wide), shown dimmer.
- Painting: only marks in `selection` are painted. Solo paints `selection ∩ soloed layers` —
  but if that intersection is empty (layer fully off), solo shows the whole layer as today.
- exec.path: items are its line marks; selected ones get the executed band. The
  "dim non-executed lines" rule is unchanged (any exec.path mark selected → dim lines that
  have no exec.path mark at all).
- Expanded/collapsed state and `selection` persist in `localStorage` per project
  (`layers:<projectDir>:selection`), restored on load. A "reset" link in the Layers
  header restores defaults. Marks keys that no longer exist are dropped silently.
- Clickability is unchanged: every mark is clickable whether or not it is selected.

## Part B — Scenes: a Photoshop-style presentation list (right column)

A scene is a saved, named view. The list is yours to order, duplicate and rename; it
never touches the official layer list.

```js
presentation = {
  version: 1,
  scenes: [
    { id: "s1", name: "The two classes", file: "invoice.rb", marks: [markKey…], step: null },
    { id: "s2", name: "summary's locals", file: "invoice.rb", marks: [markKey…], step: null },
    { id: "s3", name: "Inside the loop",  file: "invoice.rb", marks: [markKey…], step: 14 },
  ]
}
// file: opened on activation (null = stay).  step: stepper cursor to goto on activation (null = leave).
```

Panel (top of the right column; Symbol and Stepper stay below; each section scrolls
independently and can be collapsed by clicking its heading):

```
SCENES                         [+ from view] [⇪ import] [⇩ export]
 ⠿ 1  The two classes                    ⧉ ⟲ ⇤ ✕
 ⠿ 2▶ summary's locals          (active)  ⧉ ⟲ ⇤ ✕
 ⠿ 3  Inside the loop        ⏵14         ⧉ ⟲ ⇤ ✕
```

| Control | Does |
|---------|------|
| `+ from view` | New scene = exactly what is painted right now (selection, or the solo view) + the open file. A "pin step" checkbox next to it also stores the stepper cursor |
| click name | Activate (click the active one again to deactivate) |
| double-click name | Rename inline (Enter commits, Esc cancels) |
| `⠿` drag handle, and `Alt+↑` / `Alt+↓` on the active scene | Reorder |
| `⧉` | Duplicate (inserted right after, name + " copy") |
| `⟲` | Overwrite this scene with the current view (same capture as `+ from view`) |
| `⇤` | Load the scene into the left panel: `selection := scene.marks` (so you can tweak, then `⟲`) |
| `✕` | Delete |
| export / import | Download / upload `presentation.json`. Import validates shape and drops unknown mark keys, reporting how many |

Activation = a display override, like solo: paint exactly `scene.marks` in the strong solo
style (each mark in its own layer's colour), dim the rest, open `scene.file`, and if
`scene.step !== null` → `stepper.goto(step)`. It does **not** modify `selection`. The chip above
the editor reads `scene 2/3: summary's locals ✕`. Activating a scene clears a layer solo and
vice-versa.

Keys — `]` / `[`:

```js
if (scenes.length > 0) next/previous SCENE (wraps; from "none active" → first / last)
else                   solo next/previous official layer   // today's behaviour
Esc                    deactivate scene / clear solo / clear selected symbol
```

Persistence: `localStorage` (`layers:<projectDir>:presentation`), written on every change.
On load: localStorage if present, else `GET /<projectDir>/presentation.json` if it exists
(404 is fine, not an error), else empty. URL gets `&scene=<1-based index>`; restored on
load (takes precedence over `solo=`).

## Code organisation

Pure, DOM-free, `node --test`-ed modules (no CodeMirror imports):

```js
// src/viewer/selection.js
markKey(layerId, mark) → string;  parseMarkKey(key) → { layer, file, start, end }
itemsOfLayer(layer) → item[]
defaultSelection(doc) → Set;  checkState(selection, keys) → "all" | "none" | "some"
setKeys(selection, keys, on) → Set            // immutable
pruneSelection(selection, doc) → Set          // drop unknown keys

// src/viewer/scenes.js                          all immutable: (presentation, …) → presentation
addScene, duplicateScene, moveScene(p, id, toIndex), renameScene, updateScene, removeScene
cycleScene(p, activeId, direction) → id | null
parsePresentation(json, doc) → { presentation, dropped: number }   // throws on bad shape
```

DOM lives in `panels.js` (layer tree) and a new `src/viewer/scenes-panel.js`. `main.js`
is already large — keep its additions to wiring.

Debug handle additions: `window.__layers.setMarks(keys, on)`, `.state.selection` (array),
`.scenes = { list(), addFromView(name, {pinStep}), activate(idOrNull), duplicate(id), move(id, toIndex), rename(id, name), update(id), load(id), remove(id), activeId (getter) }`.
