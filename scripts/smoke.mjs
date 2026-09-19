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

  // stepper panel visible, but an untouched stepper must not steal the initial file
  check("stepper panel is visible", await page.locator("#stepper-panel").isVisible());
  check("untouched stepper does not steal the initial file", (await page.evaluate(() => window.__layers.state.activeFile)) === "invoice.rb");
  check("untouched stepper paints no current-statement decoration", (await page.locator(".step-current").count()) === 0);

  const summaryHasClass = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".lyr-defs-methods")];
    return spans.some((el) => el.textContent === "summary");
  });
  check('"summary" on line 9 has class lyr-defs-methods', summaryHasClass);

  // default paint: with static layers merely enabled (no click), the def token has a
  // clearly visible, non-transparent background
  const summaryBg = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".lyr-defs-methods")];
    const el = spans.find((s) => s.textContent === "summary");
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  check(
    "summary def token has a non-transparent background with layers merely enabled",
    summaryBg && summaryBg !== "rgba(0, 0, 0, 0)" && summaryBg !== "transparent",
  );

  // multi-layer segment: "label" is in vars.locals AND vars.temps — both colours show
  // (background from the first layer, outline from the second), neither transparent
  const labelColours = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".lyr-vars-locals.lyr-vars-temps")];
    const el = spans.find((s) => s.textContent === "label");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, outline: cs.outlineColor };
  });
  check("label segment carries both vars.locals and vars.temps classes", !!labelColours);
  check(
    "label segment's background and outline colours are both non-transparent and differ",
    labelColours &&
      labelColours.background !== "rgba(0, 0, 0, 0)" &&
      labelColours.outline !== "rgba(0, 0, 0, 0)" &&
      labelColours.background !== labelColours.outline,
  );

  await page.screenshot({ path: join(OUT_DIR, "layers-default.png") });

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

  // --- Stepper ---

  // goto(6) -> mailer.rb, current-statement decoration is exactly "body = invoice.summary"
  await page.evaluate(() => window.__layers.stepper.goto(6));
  const goto6 = await page.evaluate(() => ({
    file: window.__layers.state.activeFile,
    text: document.querySelector(".step-current")?.textContent,
  }));
  check("goto(6) active tab is mailer.rb", goto6.file === "mailer.rb");
  check('goto(6) current-statement text is "body = invoice.summary"', goto6.text === "body = invoice.summary");

  // stepOver from 6 -> 19, still mailer.rb, "deliver(body)"
  await page.evaluate(() => window.__layers.stepper.stepOver());
  const stepOver6 = await page.evaluate(() => ({
    cursor: window.__layers.stepper.cursor,
    file: window.__layers.state.activeFile,
    text: document.querySelector(".step-current")?.textContent,
  }));
  check("stepOver from 6 lands on cursor 19", stepOver6.cursor === 19);
  check("stepOver from 6 stays on mailer.rb", stepOver6.file === "mailer.rb");
  check('stepOver from 6 shows "deliver(body)"', stepOver6.text === "deliver(body)");

  // next from 6 -> 7, invoice.rb
  await page.evaluate(() => window.__layers.stepper.goto(6));
  await page.evaluate(() => window.__layers.stepper.next());
  const next6 = await page.evaluate(() => ({ cursor: window.__layers.stepper.cursor, file: window.__layers.state.activeFile }));
  check("next from 6 lands on cursor 7", next6.cursor === 7);
  check("next from 6 opens invoice.rb", next6.file === "invoice.rb");

  // locals at 14 (arriving from 11): total=10, item=32, both changed
  await page.evaluate(() => window.__layers.stepper.goto(11));
  await page.evaluate(() => window.__layers.stepper.goto(14));
  const locals14 = await page.evaluate(() =>
    [...document.querySelectorAll(".step-locals tr")].map((tr) => ({
      name: tr.dataset.name,
      value: tr.children[1].textContent,
      changed: tr.classList.contains("changed"),
    })),
  );
  check(
    "locals at 14 show total=10 and item=32, both changed",
    locals14.some((r) => r.name === "total" && r.value === "10" && r.changed) &&
      locals14.some((r) => r.name === "item" && r.value === "32" && r.changed),
  );

  await page.evaluate(() => window.__layers.toggleLayer("exec.path", true));
  await page.screenshot({ path: join(OUT_DIR, "stepper.png") });

  // stack at 17: Mailer#notify then Invoice#summary, outermost first
  await page.evaluate(() => window.__layers.stepper.goto(17));
  const stack17 = await page.locator(".step-frame").allTextContents();
  check("stack at 17 is [Mailer#notify, Invoice#summary]", JSON.stringify(stack17) === JSON.stringify(["Mailer#notify", "Invoice#summary"]));

  // return value at 18
  await page.evaluate(() => window.__layers.stepper.goto(18));
  const value18 = await page.locator(".step-value").textContent();
  check('return value at 18 is "Total: 42"', value18 === '"Total: 42"');

  // real keyboard "n" performs a step over
  await page.keyboard.press("n");
  const keyStepOver = await page.evaluate(() => window.__layers.stepper.cursor);
  check('keyboard "n" steps over (18 -> 19)', keyStepOver === 19);

  // stepping doesn't affect back(): symbol jump, step a few times, back() returns to the pre-jump spot
  await page.evaluate(() => window.__layers.openFile("main.rb"));
  await page.evaluate(() => window.__layers.jumpToSymbol("Invoice#summary"));
  await page.evaluate(() => window.__layers.stepper.next());
  await page.evaluate(() => window.__layers.stepper.stepOver());
  await page.evaluate(() => window.__layers.back());
  const backAfterSteps = await page.evaluate(() => window.__layers.state.activeFile);
  check("stepping doesn't disturb back(): returns to main.rb", backAfterSteps === "main.rb");

  // URL carries i= after stepping
  const urlAfterSteps = await page.evaluate(() => location.search);
  check("URL contains i= after stepping", new URLSearchParams(urlAfterSteps).has("i"));

  // reload with ?i=14 restores cursor 14 on invoice.rb
  await page.goto(`${base}/?project=fixtures/example-ruby&i=14`, { waitUntil: "networkidle" });
  await page.waitForSelector(".file-tab");
  const reload14 = await page.evaluate(() => ({ cursor: window.__layers.stepper.cursor, file: window.__layers.state.activeFile }));
  check("reload with i=14 restores cursor 14", reload14.cursor === 14);
  check("reload with i=14 opens invoice.rb", reload14.file === "invoice.rb");

  // --- Solo (focus) mode ---

  await page.goto(`${base}/?project=fixtures/example-ruby`, { waitUntil: "networkidle" });
  await page.waitForSelector(".file-tab");

  // clicking a layer NAME in the panel solos it (real mouse click); clicking its checkbox does not
  await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-id').click();
  const soloAfterNameClick = await page.evaluate(() => window.__layers.state.solo);
  check('clicking the "defs.methods" name in the panel solos it', soloAfterNameClick === "defs.methods");

  await page.locator('.layer-row[data-layer-id="vars.locals"] input[type=checkbox]').click();
  const soloAfterCheckboxClick = await page.evaluate(() => window.__layers.state.solo);
  check("clicking a layer checkbox does not change solo", soloAfterCheckboxClick === "defs.methods");

  await page.screenshot({ path: join(OUT_DIR, "solo-defs-methods.png") });

  // clicking the soloed layer's name again un-solos it
  await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-id').click();
  const soloAfterUnsoloClick = await page.evaluate(() => window.__layers.state.solo);
  check("clicking the soloed layer name again un-solos it", soloAfterUnsoloClick === null);

  // solo("vars.locals"): a "total" token is strong-styled, the "summary" def token is unpainted
  await page.evaluate(() => window.__layers.solo("vars.locals"));
  const totalStrong = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".lyr-solo")];
    return spans.some((el) => el.textContent === "total");
  });
  check('solo("vars.locals"): a "total" token has the strong-solo class', totalStrong);

  const summaryUnpainted = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('[class*="lyr-defs"]')];
    return !spans.some((el) => el.textContent === "summary");
  });
  check('solo("vars.locals"): the "summary" def token has no layer class painted', summaryUnpainted);

  const urlSoloVarsLocals = await page.evaluate(() => location.search);
  check("URL contains solo=vars.locals", new URLSearchParams(urlSoloVarsLocals).get("solo") === "vars.locals");

  await page.screenshot({ path: join(OUT_DIR, "solo-vars-locals.png") });

  // real "]" moves solo to the next sorted layer id; real "Escape" clears it
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("]");
  const soloAfterBracket = await page.evaluate(() => window.__layers.state.solo);
  check('real "]" key moves solo to the next layer id', soloAfterBracket === "vars.temps");

  await page.keyboard.press("Escape");
  const soloAfterEscape = await page.evaluate(() => window.__layers.state.solo);
  check('real "Escape" key clears solo', soloAfterEscape === null);
  check("solo chip is hidden once solo is cleared", !(await page.locator("#solo-chip").isVisible()));

  // reload with &solo=vars.* restores a group solo: both "total" and "@items" strong-styled
  await page.goto(`${base}/?project=fixtures/example-ruby&solo=vars.*`, { waitUntil: "networkidle" });
  await page.waitForSelector(".file-tab");
  const groupSoloState = await page.evaluate(() => window.__layers.state.solo);
  check("reload with solo=vars.* restores group solo", groupSoloState === "vars.*");

  const groupSoloStrong = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".lyr-solo")];
    return {
      total: spans.some((el) => el.textContent === "total"),
      items: spans.some((el) => el.textContent === "@items"),
    };
  });
  check('solo=vars.* : "total" token is strong-styled', groupSoloStrong.total);
  check('solo=vars.* : "@items" token is strong-styled', groupSoloStrong.items);

  // --- Clicking works on tokens whose layer is NOT painted ---
  // No element exists for a hidden mark, so click by the text's screen position.
  async function clickText(lineNo, text, options = {}) {
    const rect = await page.evaluate(({ lineNo, text }) => {
      const lineEl = document.querySelectorAll(".cm-line")[lineNo - 1];
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
      let offset = lineEl.textContent.indexOf(text);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (offset < node.length) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, Math.min(node.length, offset + text.length));
          const r = range.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        offset -= node.length;
      }
    }, { lineNo, text });
    if (options.meta) await page.keyboard.down("ControlOrMeta");
    await page.mouse.click(rect.x, rect.y);
    if (options.meta) await page.keyboard.up("ControlOrMeta");
  }

  // solo=vars.* is active here: `summary` (defs.methods, line 9) is not painted
  await clickText(9, "summary");
  const hiddenInSolo = await page.evaluate(() => window.__layers.state.selectedSymbol);
  check("click selects a symbol whose layer is hidden by solo", hiddenInSolo === "Invoice#summary");

  // every layer unticked, no solo: click + cmd-click still work
  await page.evaluate(() => {
    window.__layers.solo(null);
    for (const id of Object.keys(window.__layers.state.layerState)) window.__layers.toggleLayer(id, false);
  });
  await page.evaluate(() => window.__layers.openFile("main.rb"));
  check("no layer marks painted with all layers off", (await page.locator(".cm-content .lyr").count()) === 0);
  await clickText(4, "Invoice");
  const hiddenAllOff = await page.evaluate(() => window.__layers.state.selectedSymbol);
  check("click selects a symbol with every layer off", hiddenAllOff === "Invoice");
  check("selected symbol is outlined even though its layer is off", (await page.locator(".sym-selected").count()) > 0);
  await clickText(5, "notify", { meta: true });
  const jumpedAllOff = await page.evaluate(() => window.__layers.state.activeFile);
  check("cmd/ctrl-click jumps with every layer off", jumpedAllOff === "mailer.rb");

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
