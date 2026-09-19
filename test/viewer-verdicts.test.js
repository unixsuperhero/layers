import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictBadge, verdictClass, verdictTooltip, methodEffectsMap, verdictCounts } from "../src/viewer/verdicts.js";

test("verdictBadge: the three glyphs, empty string for unknown/missing verdicts", () => {
  assert.equal(verdictBadge("impure"), "●");
  assert.equal(verdictBadge("pure"), "○");
  assert.equal(verdictBadge("unknown"), "?");
  assert.equal(verdictBadge(undefined), "");
  assert.equal(verdictBadge("bogus"), "");
});

test("verdictClass", () => {
  assert.equal(verdictClass("impure"), "verdict-impure");
  assert.equal(verdictClass(null), "");
});

test("verdictTooltip: direct only", () => {
  assert.equal(verdictTooltip({ verdict: "impure", direct: ["io"], via: {} }), "impure — direct: io");
});

test("verdictTooltip: direct + via, per docs/ROUND-4.md's example", () => {
  assert.equal(
    verdictTooltip({ verdict: "impure", direct: ["io"], via: { io: ["Mailer#deliver"] } }),
    "impure — direct: io · via io: Mailer#deliver",
  );
});

test("verdictTooltip: pure with nothing direct or via", () => {
  assert.equal(verdictTooltip({ verdict: "pure", direct: [], via: {} }), "pure — direct: none");
});

test("verdictTooltip: missing effects", () => {
  assert.equal(verdictTooltip(null), "");
});

test("methodEffectsMap: keyed by defs.methods symbol, only methods that have data.effects", () => {
  const doc = {
    layers: [
      {
        id: "defs.methods",
        marks: [
          { symbol: "Mailer#deliver", data: { effects: { verdict: "impure", direct: ["io"], via: {} } } },
          { symbol: "Invoice#summary", data: { effects: { verdict: "pure", direct: [], via: {} } } },
          { symbol: "Invoice#initialize", data: {} },
        ],
      },
    ],
  };
  const map = methodEffectsMap(doc);
  assert.equal(map.size, 2);
  assert.equal(map.get("Mailer#deliver").verdict, "impure");
  assert.equal(map.has("Invoice#initialize"), false);
});

test("verdictCounts: tallies impure/pure/unknown, ignoring missing verdicts", () => {
  const counts = verdictCounts([
    { verdict: "impure" },
    { verdict: "impure" },
    { verdict: "pure" },
    { verdict: "unknown" },
    null,
  ]);
  assert.deepEqual(counts, { impure: 2, pure: 1, unknown: 1 });
});
