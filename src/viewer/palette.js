// Deterministic colour per layer id: fixed palette, indexed by sorted layer id position.
const PALETTE = [
  "#e06c75",
  "#98c379",
  "#61afef",
  "#e5c07b",
  "#c678dd",
  "#56b6c2",
  "#d19a66",
  "#be5046",
  "#528bff",
  "#a3be8c",
  "#ebcb8b",
  "#b48ead",
];

export function assignPalette(layerIds) {
  const sorted = [...layerIds].sort();
  const colours = {};
  sorted.forEach((id, i) => {
    colours[id] = PALETTE[i % PALETTE.length];
  });
  return colours;
}
