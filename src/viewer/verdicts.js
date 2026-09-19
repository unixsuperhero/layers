// Pure, DOM-free helpers for per-method verdict badges (docs/ROUND-4.md "Verdicts").
// A method's { verdict, direct, via } lives on its defs.methods mark's data.effects.

const BADGE = { impure: "●", pure: "○", unknown: "?" };

export function verdictBadge(verdict) {
  return BADGE[verdict] ?? "";
}

export function verdictClass(verdict) {
  return verdict ? `verdict-${verdict}` : "";
}

// "impure — direct: io · via io: Mailer#deliver" (docs/ROUND-4.md "B. Web viewer").
export function verdictTooltip(effects) {
  if (!effects) return "";
  const { verdict, direct, via } = effects;
  const parts = [`direct: ${direct && direct.length ? direct.join(", ") : "none"}`];
  const viaEntries = Object.entries(via ?? {});
  if (viaEntries.length) {
    parts.push(`via ${viaEntries.map(([kind, syms]) => `${kind}: ${syms.join(", ")}`).join(", ")}`);
  }
  return `${verdict} — ${parts.join(" · ")}`;
}

// Looks up a method symbol's effects from the doc's defs.methods layer, or null when the
// symbol isn't a method or has no verdict (e.g. top-level code).
export function methodEffectsMap(doc) {
  const map = new Map();
  const layer = doc.layers.find((l) => l.id === "defs.methods");
  for (const mark of layer?.marks ?? []) {
    if (mark.data?.effects) map.set(mark.symbol, mark.data.effects);
  }
  return map;
}

// Tally of method nodes by verdict — used for the rail's per-file filter counts.
export function verdictCounts(effectsList) {
  const counts = { impure: 0, pure: 0, unknown: 0 };
  for (const effects of effectsList) {
    if (effects?.verdict in counts) counts[effects.verdict]++;
  }
  return counts;
}
