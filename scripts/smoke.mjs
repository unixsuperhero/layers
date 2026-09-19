// Headless smoke test: boots vite programmatically, drives the viewer with a real browser,
// and asserts DOM state. Exits non-zero on any failed assertion.
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "smoke-out");
mkdirSync(OUT_DIR, { recursive: true });

const failures = [];
function check(label, condition) {
  if (condition) {
    console.log(`ok - ${label}`);
  } else {
    console.error(`FAIL - ${label}`);
    failures.push(label);
  }
}

const server = await createServer({ root: join(__dirname, ".."), server: { port: 0 } });
await server.listen();
const port = server.config.server.port;
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(err.message));

try {
  await page.goto(`${base}/?project=fixtures/example-ruby`, { waitUntil: "networkidle" });
  await page.waitForSelector(".file-tab");

  // 3 file tabs
  const tabCount = await page.locator(".file-tab").count();
  check("3 file tabs", tabCount === 3);

  // layer panel lists all 9 layer ids
  const layerIds = await page.locator(".layer-id").allTextContents();
  const expectedLayers = [
    "defs.attributes",
    "defs.classes",
    "defs.methods",
    "exec.path",
    "refs.calls",
    "refs.constants",
    "vars.ivars",
    "vars.locals",
    "vars.temps",
  ];
  check(
    "layer panel lists all 9 layer ids",
    layerIds.length === 9 && expectedLayers.every((id) => layerIds.includes(id)),
  );

  // invoice.rb showing by default; "summary" on line 9 has class lyr-defs-methods
  const activeFile1 = await page.evaluate(() => window.__layers.state.activeFile);
  check("invoice.rb showing by default", activeFile1 === "invoice.rb");

  const summaryHasClass = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".lyr-defs-methods")];
    return spans.some((el) => el.textContent === "summary");
  });
  check('"summary" on line 9 has class lyr-defs-methods', summaryHasClass);

  // toggling defs.methods off removes that class
  await page.evaluate(() => window.__layers.toggleLayer("defs.methods", false));
  const summaryGone = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".lyr-defs-methods")];
    return !spans.some((el) => el.textContent === "summary");
  });
  check("toggling defs.methods off removes that class", summaryGone);
  await page.evaluate(() => window.__layers.toggleLayer("defs.methods", true));

  // multibyte line 1 didn't shift marks: lyr-defs-classes has exact text "Invoice"
  const invoiceText = await page.evaluate(() => {
    const el = document.querySelector(".lyr-defs-classes");
    return el ? el.textContent : null;
  });
  check('multibyte-safe offsets: lyr-defs-classes text is exactly "Invoice"', invoiceText === "Invoice");

  // open main.rb -> jumpToSymbol -> active tab becomes invoice.rb, symbol panel populated
  await page.evaluate(() => window.__layers.openFile("main.rb"));
  await page.evaluate(() => window.__layers.jumpToSymbol("Invoice#summary"));
  const activeFile2 = await page.evaluate(() => window.__layers.state.activeFile);
  check("jumpToSymbol jumps to invoice.rb", activeFile2 === "invoice.rb");

  const activeTabText = await page.locator(".file-tab.active").textContent();
  check("active tab reflects invoice.rb", activeTabText === "invoice.rb");

  const defCount = await page.locator(".symbol-panel .sym-definitions .sym-row").count();
  const refCount = await page.locator(".symbol-panel .sym-references .sym-row").count();
  check("symbol panel lists 1 definition", defCount === 1);
  check("symbol panel lists 2 references", refCount === 2);

  await page.screenshot({ path: join(OUT_DIR, "jump-symbol-panel.png") });

  // back() returns to main.rb
  await page.evaluate(() => window.__layers.back());
  const activeFile3 = await page.evaluate(() => window.__layers.state.activeFile);
  check("back() returns to main.rb", activeFile3 === "main.rb");

  // exec.path: invoice.rb line 19 dimmed (never executed), line 10 executed
  await page.evaluate(() => window.__layers.openFile("invoice.rb"));
  await page.evaluate(() => window.__layers.toggleLayer("exec.path", true));

  const execLineClasses = await page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const classOf = (n) => lines[n - 1]?.className ?? "";
    return { line10: classOf(10), line19: classOf(19) };
  });
  check("invoice.rb line 10 has the executed class", execLineClasses.line10.includes("lyr-exec-path"));
  check("invoice.rb line 19 has the dimmed class", execLineClasses.line19.includes("lyr-dimmed"));

  await page.screenshot({ path: join(OUT_DIR, "invoice-all-layers.png") });

  // real mouse cmd/ctrl-click on `Mailer` in main.rb line 5 jumps to mailer.rb
  await page.evaluate(() => window.__layers.toggleLayer("exec.path", false));
  await page.evaluate(() => window.__layers.openFile("main.rb"));
  const mailerRef = page.locator(".lyr-refs-constants", { hasText: "Mailer" }).first();
  await mailerRef.click({ modifiers: ["ControlOrMeta"] });
  const activeFile4 = await page.evaluate(() => window.__layers.state.activeFile);
  check("cmd/ctrl-click on Mailer jumps to mailer.rb", activeFile4 === "mailer.rb");

  check("no console errors", consoleErrors.length === 0);
  check("no page errors", pageErrors.length === 0);
  if (consoleErrors.length) console.error("console errors:", consoleErrors);
  if (pageErrors.length) console.error("page errors:", pageErrors);
} catch (err) {
  console.error("smoke test threw:", err);
  failures.push(`exception: ${err.message}`);
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
} else {
  console.log("\nall smoke assertions passed");
}
