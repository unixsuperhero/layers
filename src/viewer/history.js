// Jump history: a browser-style back/forward stack of arbitrary entries.
export function createHistory(initial) {
  const stack = initial === undefined ? [] : [initial];
  let index = stack.length - 1;

  function push(entry) {
    stack.length = index + 1;
    stack.push(entry);
    index = stack.length - 1;
  }

  function back() {
    if (index <= 0) return undefined;
    index -= 1;
    return stack[index];
  }

  function forward() {
    if (index >= stack.length - 1) return undefined;
    index += 1;
    return stack[index];
  }

  function current() {
    return index >= 0 ? stack[index] : undefined;
  }

  function canBack() {
    return index > 0;
  }

  function canForward() {
    return index < stack.length - 1;
  }

  return { push, back, forward, current, canBack, canForward };
}
