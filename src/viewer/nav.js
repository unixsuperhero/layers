import { createHistory } from "./history.js";
import { jumpTargets } from "../core/symbols.js";

// Given the jump targets for a symbol and the mark that was actually clicked (byte offsets,
// or null when jumping from outside a click, e.g. the Symbol panel or jumpToSymbol), decide
// what a cmd/ctrl-click or double-click should do.
export function decideJump(targets, clickedMark) {
  if (targets.length !== 1) return { action: "select" };
  const target = targets[0];
  const isSelf =
    clickedMark &&
    target.file === clickedMark.file &&
    target.start === clickedMark.start &&
    target.end === clickedMark.end;
  return isSelf ? { action: "select" } : { action: "jump", target };
}

// Orchestrates the jump history stack: every jump pushes {file, pos}; back/forward replay it.
// Tab clicks and symbol selection do not go through here.
export function createNav({ index, onNavigate }) {
  const history = createHistory();

  function resolveTargets(symbol) {
    return jumpTargets(index, symbol);
  }

  function goTo(entry) {
    history.push(entry);
    onNavigate(entry);
  }

  function back() {
    const entry = history.back();
    if (entry) onNavigate(entry);
    return entry;
  }

  function forward() {
    const entry = history.forward();
    if (entry) onNavigate(entry);
    return entry;
  }

  return { resolveTargets, goTo, back, forward, history };
}
