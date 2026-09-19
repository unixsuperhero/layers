function spanOf(e) {
  return { file: e.file, start: e.start, end: e.end };
}

function emptyRoot() {
  return {
    kind: 'root', symbol: null, recv: null, enter: 0, exit: -1,
    site: null, def: null, value: null, depth: 0, children: [],
  };
}

export function buildCallTree(trace) {
  if (trace.length === 0) return emptyRoot();

  const last = trace.length - 1;
  const root = {
    kind: 'root', symbol: null, recv: null, enter: 0, exit: last,
    site: null, def: spanOf(trace[0]), value: null, depth: 0, children: [],
  };
  const stack = [{ node: root, lastLine: null }];

  for (let i = 0; i < trace.length; i++) {
    const e = trace[i];
    const top = stack[stack.length - 1];

    if (e.event === 'line') {
      top.lastLine = spanOf(e);
    } else if (e.event === 'call' || e.event === 'b_call') {
      const isCall = e.event === 'call';
      const node = {
        kind: isCall ? 'call' : 'block',
        symbol: isCall ? e.symbol : null,
        recv: isCall ? e.recv : null,
        enter: i,
        exit: last,
        site: top.lastLine,
        def: spanOf(e),
        value: null,
        depth: e.depth,
        children: [],
      };
      top.node.children.push(node);
      stack.push({ node, lastLine: null });
    } else if (e.event === 'return' || e.event === 'b_return') {
      const wantKind = e.event === 'return' ? 'call' : 'block';
      for (let j = stack.length - 1; j >= 1; j--) {
        if (stack[j].node.kind === wantKind) {
          stack[j].node.exit = i;
          stack[j].node.value = e.value;
          stack.splice(j);
          break;
        }
      }
    }
    // 'raise' and anything else: no-op
  }

  return root;
}

export function frameAt(root, i) {
  let node = root;
  outer: while (true) {
    for (const child of node.children) {
      if (i >= child.enter && i <= child.exit) {
        node = child;
        continue outer;
      }
    }
    return node;
  }
}
