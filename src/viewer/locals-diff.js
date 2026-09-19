// Names that are new or whose value changed between two locals snapshots ({name: string}).
export function diffLocals(before, after) {
  const changed = new Set();
  for (const [name, value] of Object.entries(after)) {
    if (!(name in before) || before[name] !== value) changed.add(name);
  }
  return changed;
}
