# Contract

The single source of truth for phase 1. Analyzers (later phases) write `layers.json`;
the viewer only ever reads it. Everything in `src/core/` is a pure function over this data.

## Project layout on disk

```
<project>/
  project.json        { name, root, files[], entry }
  <root>/<file>       the source files, paths relative to root
  layers.json         the document described below
```

Reference project: `fixtures/example-ruby/`. Its `layers.json` is generated from
`fixture.spec.json` by `npm run fixture` — never edit it by hand.

## layers.json

Formal schema: `schema/layers.schema.json` (draft-07).

```js
{
  version: 1,
  files: { "invoice.rb": { sha: "<sha256 hex of file bytes>", bytes: 321 } },
  layers: [
    { id: "defs.methods", kind: "static" | "dynamic", producer: "fixture@1",
      marks: [ { file, start, end, symbol, role, data } ] }
  ],
  trace: [ { i, event, file, start, end, depth, symbol, recv, locals, value } ]   // optional
}
```

- `start` / `end` are **UTF-8 byte offsets**, half-open `[start, end)`, into the file whose sha256 is `files[file].sha`.
- `symbol` is a project-global id (`"Invoice#summary"`, `"Invoice#summary/total"`) or `null`. Marks that share a symbol are the same "thing" across files — this is what makes cross-file jumps work.
- `role`: `definition | reference | write | read | executed`.
- Layer ids are namespaced: `defs.*`, `vars.*`, `refs.*`, `exec.*`.
- Trace `event`: `call | return | line | b_call | b_return | raise`. `depth` is the frame depth (0 = top level). `locals` is a `{name: inspectedString}` snapshot of the current frame, or `null` when not captured.

### Semantic rules (beyond the JSON Schema)

1. Every `mark.file` and `trace[].file` is a key of `files`.
2. `start <= end <= files[file].bytes` for every mark and trace event.
3. Layer ids are unique within a document; `layers` is sorted by `id`.
4. Marks within a layer are sorted by `(file, start, end, symbol ?? "")`, string comparisons by code unit (plain `<`), not locale.
5. `trace[n].i === n`.

## Module interfaces (`src/core/`, ES modules, no dependencies on the DOM)

```js
// validate.js
validate(doc) → { ok: boolean, errors: [{ path: "/layers/0/marks/3", message: "…" }] }
//   JSON Schema (ajv) first; semantic rules 1–5 only if the schema passes.
//   Node-only (reads the schema from disk). In the browser use:
// validate-core.js
createValidator(schema) → validate     // browser-safe; the viewer imports the schema JSON via Vite

// merge.js
merge(docs: doc[]) → doc
//   files: union; same path with different sha → throw Error
//   layers: same id → marks concatenated (exact-duplicate marks dropped), kind/producer must match else throw
//   trace: at most one input doc may carry a non-empty trace, else throw
//   output obeys semantic rules 3–5 (canonical sort) so merge(x) of identical input is byte-stable

// symbols.js
buildSymbolIndex(doc) → {
  [symbol]: { definitions: ref[], references: ref[], writes: ref[], reads: ref[] }
}
//   ref = { file, start, end, layer }; marks with symbol === null are skipped;
//   each list sorted by (file, start, end, layer); identical (file,start,end) from
//   different layers is kept once per role (first layer id alphabetically wins)
jumpTargets(index, symbol) → ref[]
//   definitions if any, else writes (a local's first writes act as its declaration), else []

// offsets.js
makeOffsetMap(text: string) → { byteToChar(byte) → charIndex, charToByte(charIndex) → byte, bytes: number }
//   charIndex is a JS string index (UTF-16 code units) — what CodeMirror uses.
//   A byte offset that lands inside a multi-byte character → throw RangeError.

// flatten.js
flatten(marks: [{ start, end, layer }]) → [{ start, end, layers: string[], marks: number[] }]
//   Non-overlapping segments, ascending, covering exactly the union of the input marks.
//   `marks` = indices into the input array of every mark covering the segment (ascending);
//   `layers` = sorted unique layer ids of those marks.
//   Adjacent segments are merged only when their `marks` arrays are identical.
//   Zero-length marks (start === end) are ignored. Unit-agnostic (works on bytes or chars).

// stepper.js
createStepper(trace) → {
  cursor,                       // getter, integer index into trace; starts at 0
  length,
  current()      → event,
  goto(i)        → event,       // clamps to [0, length-1]
  next()         → event,       // cursor+1 (clamped)
  prev()         → event,
  stepOver()     → event,       // next event with depth <= current depth; if none, last event
  stepBackOver() → event,       // previous event with depth <= current depth; if none, first event
  stepOut()      → event,       // next event with depth <  current depth; if none, last event
  localsAt(i = cursor) → { [name]: string },
  //   the event's own locals if non-null; otherwise walk backwards over events of the SAME depth
  //   for the nearest non-null locals, stopping at (and including) the call/b_call that opened
  //   this frame. Nothing found → {}.
  stack(i = cursor) → [{ symbol, file, start, end, depth }]
  //   open call/b_call frames at event i, outermost first (b_call frames have symbol null).
}
//   Empty trace: length 0, cursor 0, current()/step functions return null, localsAt → {}, stack → [].
```

## Tests

`node --test` (built-in runner, `test/*.test.js`). Tests load the generated
`fixtures/example-ruby/layers.json` plus small inline cases. No test may depend on a browser.
