export function createStepper(trace) {
  let cursor = 0;
  const length = trace.length;

  function clamp(i) {
    if (length === 0) return 0;
    return Math.max(0, Math.min(length - 1, i));
  }

  function current() {
    return length === 0 ? null : trace[cursor];
  }

  function goto(i) {
    cursor = clamp(i);
    return current();
  }

  function next() {
    return goto(cursor + 1);
  }

  function prev() {
    return goto(cursor - 1);
  }

  function stepOver() {
    if (length === 0) return null;
    const depth = trace[cursor].depth;
    for (let i = cursor + 1; i < length; i++) {
      if (trace[i].depth <= depth) return goto(i);
    }
    return goto(length - 1);
  }

  function stepBackOver() {
    if (length === 0) return null;
    const depth = trace[cursor].depth;
    for (let i = cursor - 1; i >= 0; i--) {
      if (trace[i].depth <= depth) return goto(i);
    }
    return goto(0);
  }

  function stepOut() {
    if (length === 0) return null;
    const depth = trace[cursor].depth;
    for (let i = cursor + 1; i < length; i++) {
      if (trace[i].depth < depth) return goto(i);
    }
    return goto(length - 1);
  }

  function localsAt(i = cursor) {
    if (length === 0) return {};
    const event = trace[clamp(i)];
    if (event.locals !== null && event.locals !== undefined) return event.locals;
    const depth = event.depth;
    for (let j = clamp(i) - 1; j >= 0; j--) {
      const e = trace[j];
      if (e.depth < depth) break;
      if (e.depth > depth) continue;
      if (e.locals !== null && e.locals !== undefined) return e.locals;
      if (e.event === 'call' || e.event === 'b_call') break;
    }
    return {};
  }

  function stack(i = cursor) {
    if (length === 0) return [];
    const idx = clamp(i);
    const frames = [];
    for (let j = 0; j <= idx; j++) {
      const e = trace[j];
      if (e.event === 'call' || e.event === 'b_call') {
        frames.push({ symbol: e.symbol, file: e.file, start: e.start, end: e.end, depth: e.depth });
      } else if (e.event === 'return' || e.event === 'b_return') {
        if (j < idx) frames.pop();
      }
    }
    return frames;
  }

  return {
    get cursor() {
      return cursor;
    },
    get length() {
      return length;
    },
    current,
    goto,
    next,
    prev,
    stepOver,
    stepBackOver,
    stepOut,
    localsAt,
    stack,
  };
}
