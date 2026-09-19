// DOM-free helpers for resolving a click position to marks/symbols and offsets to line numbers.

export function marksAtPosition(marks, pos) {
  return marks.filter((m) => m.start <= pos && pos < m.end);
}

// Shortest span wins (innermost). Marks with no symbol are ignored.
export function innermostSymbol(marks) {
  let best = null;
  for (const m of marks) {
    if (m.symbol === null || m.symbol === undefined) continue;
    if (best === null || m.end - m.start < best.end - best.start) best = m;
  }
  return best ? best.symbol : null;
}

// 1-based line number of a char offset in text.
export function lineOfOffset(text, offset) {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
