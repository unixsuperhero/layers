// Deterministic colour per layer id: fixed palette, indexed by sorted layer id position.
// Hues are spread evenly around the wheel (not grouped by warm/cool) so that layers
// landing at nearby indices — e.g. vars.ivars/vars.locals/exec.path — stay visually
// distinct even when several are painted at once.
const PALETTE = [
  "#e05c5c",
  "#43db8f",
  "#9e5ce0",
  "#dbdb43",
  "#5c9ee0",
  "#db438f",
  "#9ee05c",
  "#4343db",
  "#e09e5c",
  "#43dbdb",
  "#e05ce0",
  "#43db43",
];

export function assignPalette(layerIds) {
  const sorted = [...layerIds].sort();
  const colours = {};
  sorted.forEach((id, i) => {
    colours[id] = PALETTE[i % PALETTE.length];
  });
  return colours;
}
