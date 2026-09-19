// Pure, DOM-free helpers for the effects.* layers (docs/ROUND-4.md): the hover tooltip text
// for a single effect token, and finding that text for a flatten()'d editor segment.

// Builds the `title` tooltip for one effects.* mark from its `data` (docs/ROUND-4.md
// "B. Web viewer"). `text` is the mark's own matched source substring — only used for
// `control` (its keyword, e.g. "raise", isn't itself part of `data`).
export function effectLabel(mark, text) {
  const data = mark?.data ?? {};
  switch (data.kind) {
    case "state":
      return "mutates self";
    case "global":
      return "global state";
    case "args":
      return `mutates arg: ${data.target}`;
    case "io":
      return `io: ${data.what}`;
    case "control":
      return text ? `control flow: ${text}` : "control flow";
    case "calls":
      return `calls impure ${data.via} → ${(data.effects ?? []).join(", ")}`;
    case "unknown":
      return `unknown call: ${data.name}`;
    default:
      return "";
  }
}

// segment: a flatten()-style { marks: [indexIntoPaintedArray, ...] } segment. paintedArr:
// the array flatten() was called with (each item has .layer and .key). marksByKey: Map of
// markKey -> mark (with .data). sourceTextOf(mark): (mark) => string, the mark's own source
// text (needed for the `control` kind's title). Returns null when the segment has no
// effects.* layer.
export function titleForSegment(segment, paintedArr, marksByKey, sourceTextOf) {
  const effectIdx = segment.marks.find((idx) => paintedArr[idx]?.layer.startsWith("effects."));
  if (effectIdx === undefined) return null;
  const mark = marksByKey.get(paintedArr[effectIdx].key);
  if (!mark) return null;
  return effectLabel(mark, sourceTextOf ? sourceTextOf(mark) : undefined) || null;
}
