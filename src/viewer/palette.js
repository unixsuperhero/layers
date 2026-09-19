// Deterministic colour per layer id, namespace-aware: each namespace (defs / vars / refs /
// exec / effects / …) gets its own hue family so that even with ~17 layers on screen at
// once, layers from different namespaces stay visually distinguishable at a glance, while
// layers within the same namespace still get distinct (hue/lightness/saturation) swatches.
const NAMESPACE_HUES = {
  defs: 4, // red
  vars: 150, // green
  refs: 205, // blue
  exec: 38, // orange
  effects: 285, // violet
};

function namespaceOf(layerId) {
  const i = layerId.indexOf(".");
  return i === -1 ? layerId : layerId.slice(0, i);
}

// Deterministic fallback hue for a namespace we don't have a fixed anchor for.
function hashHue(ns) {
  let h = 0;
  for (let i = 0; i < ns.length; i++) h = (h * 31 + ns.charCodeAt(i)) >>> 0;
  return h % 360;
}

function baseHueFor(ns) {
  return ns in NAMESPACE_HUES ? NAMESPACE_HUES[ns] : hashHue(ns);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) =>
    Math.round(f(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

export function assignPalette(layerIds) {
  const sorted = [...new Set(layerIds)].sort();
  const byNamespace = new Map();
  for (const id of sorted) {
    const ns = namespaceOf(id);
    if (!byNamespace.has(ns)) byNamespace.set(ns, []);
    byNamespace.get(ns).push(id);
  }

  const colours = {};
  for (const [ns, ids] of byNamespace) {
    const base = baseHueFor(ns);
    const n = ids.length;
    // The family's hue arc widens as it gets more crowded so that, even with many layers
    // sharing one namespace, no two land on (near-)identical hues.
    const arc = Math.min(150, Math.max(30, n * 16));
    ids.forEach((id, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const hue = (base + (t - 0.5) * arc + 360) % 360;
      const lightness = 45 + (i % 3) * 8; // 45 / 53 / 61 — extra separation under crowding
      const saturation = 55 + (i % 2) * 12; // 55 / 67
      colours[id] = hslToHex(hue, saturation, lightness);
    });
  }
  return colours;
}
