import {
  EditorState,
  StateEffect,
  StateField,
  Compartment,
  RangeSet,
  RangeSetBuilder,
} from "@codemirror/state";
import { EditorView, Decoration, keymap, gutter, lineNumbers, GutterMarker } from "@codemirror/view";
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { javascript } from "@codemirror/lang-javascript";
import { tags } from "@lezer/highlight";

// A decoration source: a StateEffect that replaces a StateField's RangeSet, wired into
// the view via `provide`. The stepper's future "current statement" highlight is just
// another call to this factory, added to `extensions` below.
function decorationField() {
  const effect = StateEffect.define();
  const field = StateField.define({
    create: () => Decoration.none,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(effect)) return e.value;
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return { effect, field };
}

function gutterMarkerField() {
  const effect = StateEffect.define();
  const field = StateField.define({
    create: () => RangeSet.empty,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(effect)) return e.value;
      return value.map(tr.changes);
    },
  });
  return { effect, field };
}

const layerMarks = decorationField();
const execLines = decorationField();
const selectionMarks = decorationField();
const flashMarks = decorationField();
const execGutter = gutterMarkerField();

class ExecDot extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "exec-gutter-dot";
    return dot;
  }
}
const execDot = new ExecDot();

const langCompartment = new Compartment();

function languageFor(file) {
  const ext = file.split(".").pop();
  if (ext === "rb") return [StreamLanguage.define(ruby)];
  if (ext === "ts") return [javascript({ typescript: true })];
  if (ext === "tsx") return [javascript({ typescript: true, jsx: true })];
  if (ext === "jsx") return [javascript({ jsx: true })];
  if (ext === "js" || ext === "mjs") return [javascript()];
  return [];
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c678dd" },
  { tag: tags.string, color: "#98c379" },
  { tag: tags.comment, color: "#5c6370", fontStyle: "italic" },
  { tag: tags.number, color: "#d19a66" },
  { tag: tags.atom, color: "#d19a66" },
  { tag: [tags.definitionKeyword, tags.modifier], color: "#c678dd" },
  { tag: tags.variableName, color: "#e5c07b" },
  { tag: [tags.function(tags.variableName), tags.propertyName], color: "#61afef" },
  { tag: tags.className, color: "#e5c07b" },
  { tag: tags.operator, color: "#56b6c2" },
  { tag: tags.punctuation, color: "#abb2bf" },
]);

function classFor(layers) {
  return "lyr " + layers.map((id) => "lyr-" + id.replaceAll(".", "-")).join(" ");
}

function markDecorations(segments) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const builder = new RangeSetBuilder();
  for (const seg of sorted) {
    builder.add(
      seg.start,
      seg.end,
      Decoration.mark({
        class: classFor(seg.layers),
        attributes: { "data-marks": seg.marks.join(",") },
      }),
    );
  }
  return builder.finish();
}

// executedRanges: [{start,end}] char offsets. execEnabled: whether the exec.path layer is on.
function execDecorations(doc, executedRanges, execEnabled) {
  if (!execEnabled) return { lines: Decoration.none, gutterMarks: RangeSet.empty };

  const lineDeco = Decoration.line({ attributes: { class: "lyr-exec-path" } });
  const dimDeco = Decoration.line({ attributes: { class: "lyr-dimmed" } });

  const lineBuilder = new RangeSetBuilder();
  const gutterBuilder = new RangeSetBuilder();

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const executed = executedRanges.some((r) => r.start < line.to && r.end > line.from);
    lineBuilder.add(line.from, line.from, executed ? lineDeco : dimDeco);
    if (executed) gutterBuilder.add(line.from, line.from, execDot);
  }

  return { lines: lineBuilder.finish(), gutterMarks: gutterBuilder.finish() };
}

function rangeDecorations(ranges, cls) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const builder = new RangeSetBuilder();
  for (const r of sorted) {
    if (r.start === r.end) continue;
    builder.add(r.start, r.end, Decoration.mark({ class: cls }));
  }
  return builder.finish();
}

function baseExtensions(onClick) {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    langCompartment.of([]),
    syntaxHighlighting(highlightStyle),
    layerMarks.field,
    execLines.field,
    selectionMarks.field,
    flashMarks.field,
    execGutter.field,
    lineNumbers(),
    gutter({ class: "cm-exec-gutter", markers: (view) => view.state.field(execGutter.field) }),
    EditorView.lineWrapping,
    EditorView.theme(
      {
        "&": { height: "100%", fontSize: "13px", backgroundColor: "#1e2127", color: "#d7dae0" },
        ".cm-scroller": { fontFamily: "var(--mono-font)", overflow: "auto" },
        ".cm-gutters": { backgroundColor: "#22262e", color: "#5c6370", border: "none" },
        ".cm-activeLineGutter": { backgroundColor: "transparent" },
      },
      { dark: true },
    ),
    keymap.of([]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!onClick) return;
        if (!(event.metaKey || event.ctrlKey)) return;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return;
        onClick(pos, { jump: true });
      },
      dblclick(event, view) {
        if (!onClick) return;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return;
        onClick(pos, { jump: true });
      },
      click(event, view) {
        if (!onClick) return;
        if (event.metaKey || event.ctrlKey || event.detail > 1) return;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return;
        onClick(pos, { jump: false });
      },
    }),
  ];
}

export function createEditor(parent, { onClick } = {}) {
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "", extensions: baseExtensions(onClick) }),
  });

  function openFile(file, text) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: [
        langCompartment.reconfigure(languageFor(file)),
        layerMarks.effect.of(Decoration.none),
        execLines.effect.of(Decoration.none),
        selectionMarks.effect.of(Decoration.none),
        flashMarks.effect.of(Decoration.none),
        execGutter.effect.of(RangeSet.empty),
      ],
    });
  }

  function setLayerDecorations(segments) {
    view.dispatch({ effects: layerMarks.effect.of(markDecorations(segments)) });
  }

  function setExecDecorations(executedRanges, execEnabled) {
    const { lines, gutterMarks } = execDecorations(view.state.doc, executedRanges, execEnabled);
    view.dispatch({
      effects: [execLines.effect.of(lines), execGutter.effect.of(gutterMarks)],
    });
  }

  function setSelectionDecorations(ranges) {
    view.dispatch({ effects: selectionMarks.effect.of(rangeDecorations(ranges, "sym-selected")) });
  }

  function scrollTo(start, end) {
    view.dispatch({ effects: EditorView.scrollIntoView(start, { y: "center" }) });
    view.dispatch({ effects: flashMarks.effect.of(rangeDecorations([{ start, end }], "lyr-flash")) });
    setTimeout(() => {
      view.dispatch({ effects: flashMarks.effect.of(Decoration.none) });
    }, 700);
  }

  return { view, openFile, setLayerDecorations, setExecDecorations, setSelectionDecorations, scrollTo };
}
