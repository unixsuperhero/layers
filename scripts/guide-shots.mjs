#!/usr/bin/env node
// Annotated screenshots for the user guide: drives the viewer, draws numbered callouts
// over real element bounding boxes, saves PNGs. Usage: node scripts/guide-shots.mjs [outDir]
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const outDir = resolve(process.argv[2] ?? "scripts/guide-out");
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 0 }, logLevel: "error" });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

async function open(query = "") {
  await page.goto(`${base}/?project=fixtures/example-ruby${query}`);
  await page.waitForSelector(".cm-content");
  await page.waitForFunction(() => window.__layers);
}

// callouts: [{ n, target: Locator, place?: "left"|"right"|"top"|"bottom", pad?: number }]
async function shoot(name, callouts) {
  const boxes = [];
  for (const c of callouts) {
    const box = await c.target.first().boundingBox();
    if (!box) throw new Error(`${name}: callout ${c.n} target not found`);
    boxes.push({ n: c.n, place: c.place ?? "left", pad: c.pad ?? 3, ...box });
  }
  await page.evaluate((boxes) => {
    const root = document.createElement("div");
    root.id = "guide-callouts";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
    for (const b of boxes) {
      const ring = document.createElement("div");
      ring.style.cssText = `position:absolute;left:${b.x - b.pad}px;top:${b.y - b.pad}px;width:${b.width + 2 * b.pad}px;height:${b.height + 2 * b.pad}px;border:2px solid #ff3d7f;border-radius:6px;box-shadow:0 0 0 2px rgba(0,0,0,.55)`;
      root.appendChild(ring);
      const badge = document.createElement("div");
      const size = 22;
      const pos = {
        left: [b.x - b.pad - size - 4, b.y + b.height / 2 - size / 2],
        right: [b.x + b.width + b.pad + 4, b.y + b.height / 2 - size / 2],
        top: [b.x + b.width / 2 - size / 2, b.y - b.pad - size - 4],
        bottom: [b.x + b.width / 2 - size / 2, b.y + b.height + b.pad + 4],
      }[b.place];
      badge.textContent = b.n;
      badge.style.cssText = `position:absolute;left:${Math.max(2, pos[0])}px;top:${Math.max(2, pos[1])}px;width:${size}px;height:${size}px;border-radius:50%;background:#ff3d7f;color:#fff;font:700 13px/22px system-ui;text-align:center;box-shadow:0 0 0 2px rgba(0,0,0,.6)`;
      root.appendChild(badge);
    }
    document.body.appendChild(root);
  }, boxes);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await page.evaluate(() => document.getElementById("guide-callouts")?.remove());
  console.log(`wrote ${name}.png`);
}

const line = (n) => page.locator(".cm-line").nth(n - 1);
const layerRow = (id) => page.locator(".layer-row", { has: page.locator(".layer-id", { hasText: new RegExp(`^${id.replace(".", "\\.")}$`) }) });

try {
  // 1. overview of the regions
  await open();
  await shoot("01-overview", [
    { n: 1, target: page.locator(".nav-toolbar"), place: "right" },
    { n: 2, target: page.locator("#file-list"), place: "right" },
    { n: 3, target: page.locator("#layer-panel"), place: "right" },
    { n: 4, target: page.locator("#file-tabs .file-tab").nth(1), place: "bottom" },
    { n: 5, target: page.locator(".cm-content"), place: "top", pad: -6 },
    { n: 6, target: page.locator("#symbol-panel"), place: "left" },
    { n: 7, target: page.locator("#stepper-panel"), place: "left" },
  ]);

  // 2. layer panel: what each control does
  await shoot("02-layers", [
    { n: 1, target: layerRow("defs.methods").locator("input[type=checkbox]"), place: "left" },
    { n: 2, target: layerRow("defs.methods").locator(".layer-id"), place: "right" },
    { n: 3, target: page.locator(".layer-group-header").first(), place: "right" },
    { n: 4, target: layerRow("vars.locals").locator(".layer-count"), place: "right" },
    { n: 5, target: line(9).locator(".lyr-defs-methods"), place: "right" },
    { n: 6, target: line(10).locator(".lyr-vars-locals"), place: "right" },
    { n: 7, target: line(14).locator(".lyr-vars-temps"), place: "right" },
  ]);

  // 3. solo a layer
  await layerRow("vars.locals").locator(".layer-id").click();
  await shoot("03-solo", [
    { n: 1, target: layerRow("vars.locals"), place: "right" },
    { n: 2, target: page.locator("#solo-chip .solo-chip-clear"), place: "right" },
    { n: 3, target: line(12).locator(".lyr-vars-locals").first(), place: "left" },
  ]);
  await page.keyboard.press("Escape");

  // 4. execution path layer
  await layerRow("exec.path").locator("input[type=checkbox]").check();
  await shoot("04-exec-path", [
    { n: 1, target: layerRow("exec.path"), place: "right" },
    { n: 2, target: line(10), place: "top", pad: 0 },
    { n: 3, target: line(19), place: "bottom", pad: 0 },
  ]);
  await layerRow("exec.path").locator("input[type=checkbox]").uncheck();

  // 7. picking individual items inside a layer
  const caret = (id) => page.locator(`.layer-row[data-layer-id="${id}"] .tree-caret`);
  const itemRow = (name) => page.locator(".item-row", { has: page.locator(".item-name", { hasText: new RegExp(`^${name.replace("?", "\\?")}$`) }) }).first();
  await caret("defs.methods").click();
  await itemRow("summary").locator("input[type=checkbox]").uncheck();
  await itemRow("notify").locator("input[type=checkbox]").uncheck();
  await caret("vars.locals").click();
  await itemRow("item").locator(".tree-caret").click();
  await page.locator(".mark-row", { hasText: "read" }).first().locator("input[type=checkbox]").uncheck();
  await page.mouse.move(640, 600);
  await shoot("07-items", [
    { n: 1, target: caret("defs.methods"), place: "left" },
    { n: 2, target: layerRow("defs.methods").locator(".layer-count"), place: "right" },
    { n: 3, target: itemRow("summary").locator("input[type=checkbox]"), place: "left" },
    { n: 4, target: itemRow("overdue?").locator(".item-label"), place: "bottom" },
    { n: 5, target: page.locator(".mark-row", { hasText: "read" }).first(), place: "right" },
    { n: 6, target: page.locator(".layer-reset"), place: "bottom" },
    { n: 7, target: line(9), place: "top", pad: 0 },
  ]);
  await page.evaluate(() => window.__layers.resetSelection());
  await caret("vars.locals").click();
  await caret("defs.methods").click();

  // 5. symbols + jumping
  await page.locator("#file-tabs .file-tab", { hasText: "mailer.rb" }).click();
  await line(5).locator(".lyr-refs-calls").click();
  await shoot("05-symbol", [
    { n: 1, target: line(5).locator(".lyr-refs-calls"), place: "top" },
    { n: 2, target: page.locator("#symbol-panel .sym-name"), place: "left" },
    { n: 3, target: page.locator("#symbol-panel .sym-row").first(), place: "left" },
    { n: 4, target: page.locator(".nav-toolbar"), place: "right" },
  ]);

  // 6. stepper
  await open("&i=11");
  await page.evaluate(() => window.__layers.toggleLayer("exec.path", true));
  await page.evaluate(() => window.__layers.stepper.goto(14));
  await shoot("06-stepper", [
    { n: 1, target: page.locator(".stepper-controls"), place: "left" },
    { n: 2, target: page.locator(".step-slider"), place: "left" },
    { n: 3, target: page.locator(".step-status"), place: "left" },
    { n: 4, target: page.locator(".step-frame").first(), place: "left" },
    { n: 5, target: page.locator(".step-locals"), place: "left" },
    { n: 6, target: page.locator(".step-current").first(), place: "right" },
  ]);

  // 8–9. scenes (clean slate: earlier shots persisted selection/carets in localStorage)
  await page.evaluate(() => localStorage.clear());
  await open();
  await page.locator("#scenes-import-input").setInputFiles("examples/presentation.example-ruby.json");
  await page.waitForFunction(() => window.__layers.scenes.list().length === 4);
  const sceneRow = (n) => page.locator(".scene-row").nth(n - 1);
  await sceneRow(3).locator(".scene-name").click();
  await page.waitForFunction(() => window.__layers.scenes.activeId);
  await sceneRow(2).hover();
  await shoot("08-scenes", [
    { n: 1, target: page.locator("#scenes-panel button", { hasText: "from view" }), place: "left" },
    { n: 2, target: page.locator("#scenes-pin-step"), place: "bottom" },
    { n: 3, target: sceneRow(2).locator(".scene-handle"), place: "left" },
    { n: 4, target: sceneRow(3).locator(".scene-name"), place: "left" },
    { n: 5, target: sceneRow(2).locator(".scene-dup"), place: "bottom", pad: 1 },
    { n: 6, target: sceneRow(4).locator(".scene-step-badge"), place: "bottom" },
    { n: 7, target: page.locator("#solo-chip"), place: "bottom", pad: -2 },
  ]);
  await page.keyboard.press("]");
  await page.mouse.move(640, 600);
  await shoot("09-scene-step", [
    { n: 1, target: sceneRow(4), place: "left" },
    { n: 2, target: page.locator(".step-current").first(), place: "right" },
    { n: 3, target: page.locator(".step-status"), place: "left" },
  ]);
} finally {
  await browser.close();
  await server.close();
}
