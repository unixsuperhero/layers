// Stepper wiring: turns a core `stepper` (src/core/stepper.js) into the interactive panel +
// keys + "current statement" painting described in docs/VIEWER.md "Stepper panel". Pure
// stepping/painting mechanics live here; main.js supplies the cross-cutting pieces (which
// file is open, how to switch it, how to sync the URL) via `host`.
import { diffLocals } from "./locals-diff.js";
import { renderStepperPanel } from "./panels.js";

export const STEP_KEYS = {
  ArrowLeft: "prev",
  k: "prev",
  ArrowRight: "next",
  j: "next",
  n: "stepOver",
  p: "stepBackOver",
  o: "stepOut",
  Home: "first",
  End: "last",
};

// stepper: createStepper(doc.trace) result, or null when doc.trace is empty.
// host: { editor, offsets, stepperPanelEl, jumpToRef(ref), openFile(file), getActiveFile(),
//         syncURL() }
export function createStepperController(stepper, host) {
  let active = false;
  let lastLocals = null;

  function paint(activeFile) {
    if (!stepper) return;
    const event = stepper.current();
    if (!active || !event || event.file !== activeFile) {
      host.editor.setStepperDecoration(null);
      return;
    }
    host.editor.setStepperDecoration(host.offsets[activeFile].byteToChar(event.start), host.offsets[activeFile].byteToChar(event.end));
  }

  function render() {
    if (!stepper) return;
    const locals = stepper.localsAt();
    const changed = lastLocals ? diffLocals(lastLocals, locals) : new Set();
    lastLocals = locals;
    renderStepperPanel(host.stepperPanelEl, {
      stepper,
      changed,
      onAction: runAction,
      onSlide: goto,
      onFrameJump: (frame) => host.jumpToRef({ file: frame.file, start: frame.start, end: frame.end }),
    });
  }

  // Stepping never pushes jump history (only explicit jumps, e.g. a stack-frame click, do).
  function syncToEditor() {
    const event = stepper.current();
    if (event.file !== host.getActiveFile()) {
      host.openFile(event.file);
    } else {
      paint(host.getActiveFile());
      host.syncURL();
    }
    host.editor.scrollIntoView(host.offsets[event.file].byteToChar(event.start));
  }

  function step(fn) {
    active = true;
    fn();
    render();
    syncToEditor();
  }

  function goto(i) {
    step(() => stepper.goto(i));
  }

  function runAction(id) {
    step(() => {
      if (id === "first") stepper.goto(0);
      else if (id === "last") stepper.goto(stepper.length - 1);
      else stepper[id]();
    });
  }

  // `?i=` on load: activates the stepper without going through the full step()/render/paint
  // cycle (the caller renders once, after everything else is wired up).
  function primeFromIndex(i) {
    if (!stepper || !Number.isInteger(i)) return false;
    stepper.goto(i);
    active = true;
    return true;
  }

  function primeFromScene(i) {
    if (!stepper || i === null || i === undefined) return false;
    stepper.goto(i);
    active = true;
    return true;
  }

  return {
    get active() {
      return active;
    },
    paint,
    render,
    goto,
    runAction,
    primeFromIndex,
    primeFromScene,
  };
}
