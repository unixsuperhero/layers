// Global key handling (docs/VIEWER.md "Symbols & jumping", "Stepper panel",
// docs/SELECTION-AND-SCENES.md Part B "Keys"). Registered on `window` with an AbortSignal so
// a remount (mountApp called again) can cleanly drop the old handler — no duplicate keydowns.
import { STEP_KEYS } from "./app-stepper.js";

export function isBlockingFocus() {
  const el = document.activeElement;
  if (!el || el.classList?.contains("step-slider")) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

// host: { nav: { back(), forward() }, scenes: scenesController, stepper: stepperController|null,
//   rail: { get focus() }, setFocus(bool), setSolo(null), soloCycle(direction), clearSelection() }
export function wireAppKeys(host, { signal }) {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        host.scenes.activate(null);
        host.clearSelection();
        host.setSolo(null);
        return;
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        host.nav.back();
        return;
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        host.nav.forward();
        return;
      }

      if (isBlockingFocus()) return;

      if (event.key === "]") {
        if (host.scenes.presentation.scenes.length > 0) host.scenes.cycle(1);
        else host.soloCycle(1);
        return;
      }
      if (event.key === "[") {
        if (host.scenes.presentation.scenes.length > 0) host.scenes.cycle(-1);
        else host.soloCycle(-1);
        return;
      }
      if (event.key === "f") {
        host.setFocus(!host.rail.focus);
        return;
      }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && host.scenes.activeSceneId) {
        event.preventDefault();
        const idx = host.scenes.presentation.scenes.findIndex((s) => s.id === host.scenes.activeSceneId);
        host.scenes.moveById(host.scenes.activeSceneId, idx + (event.key === "ArrowDown" ? 1 : -1));
        return;
      }

      if (!host.stepper) return;
      const action = STEP_KEYS[event.key];
      if (!action) return;
      event.preventDefault();
      host.stepper.runAction(action);
    },
    { signal },
  );
}
