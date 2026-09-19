// Pure width clamp + DOM wiring for the rail / right-column resize handles.
export function clampWidth(px, min, maxPx) {
  return Math.max(min, Math.min(maxPx, px));
}

// Wires a drag handle that resizes a CSS custom property (e.g. --rail-width) on `root`.
// sign: 1 when dragging right grows the width (the rail's right edge), -1 when dragging
// left grows it (the right column's left edge). onChange(px) fires on drag + reset; the
// caller is responsible for persisting it. `body.rail-resizing` (added while dragging)
// disables text selection and editor pointer events, see style.css.
export function wireResizeHandle(handle, { root, varName, getWidth, min = 180, maxVw = 0.6, sign = 1, resetWidth, onChange, signal }) {
  function apply(px) {
    const max = window.innerWidth * maxVw;
    const clamped = clampWidth(px, min, max);
    root.style.setProperty(varName, `${clamped}px`);
    onChange(clamped);
    return clamped;
  }

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  function onMove(event) {
    if (!dragging) return;
    apply(startWidth + sign * (event.clientX - startX));
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("rail-resizing");
  }

  handle.addEventListener(
    "mousedown",
    (event) => {
      dragging = true;
      startX = event.clientX;
      startWidth = getWidth();
      document.body.classList.add("rail-resizing");
      event.preventDefault();
    },
    { signal },
  );
  window.addEventListener("mousemove", onMove, { signal });
  window.addEventListener("mouseup", onUp, { signal });

  handle.addEventListener("dblclick", () => apply(resetWidth), { signal });

  return { apply };
}

// Widths are a personal UI preference, not project data — one global key, unlike
// selection/accordions/presentation/focus which are namespaced per bundle (docs/ROUND-3.md C).
const widthKey = (name) => `layers:${name}`;

function loadWidth(name, fallback) {
  try {
    const raw = localStorage.getItem(widthKey(name));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function saveWidth(name, px) {
  try {
    localStorage.setItem(widthKey(name), String(px));
  } catch {
    // ignore
  }
}

// Wires both rail resize handles (the rail's right edge, the right column's left edge),
// restoring + persisting each width globally. root: the element carrying the CSS custom
// properties the layout grid reads (docs/ROUND-3.md D "Resizable").
export function wireRailResize(root, { railHandle, rightHandle }, { signal } = {}) {
  let railWidth = loadWidth("railWidth", 260);
  let rightWidth = loadWidth("rightWidth", 300);
  root.style.setProperty("--rail-width", `${railWidth}px`);
  root.style.setProperty("--right-width", `${rightWidth}px`);

  wireResizeHandle(railHandle, {
    root,
    varName: "--rail-width",
    getWidth: () => railWidth,
    sign: 1,
    resetWidth: 260,
    signal,
    onChange: (px) => {
      railWidth = px;
      saveWidth("railWidth", px);
    },
  });
  wireResizeHandle(rightHandle, {
    root,
    varName: "--right-width",
    getWidth: () => rightWidth,
    sign: -1,
    resetWidth: 300,
    signal,
    onChange: (px) => {
      rightWidth = px;
      saveWidth("rightWidth", px);
    },
  });

  return { getRailWidth: () => railWidth, getRightWidth: () => rightWidth };
}
