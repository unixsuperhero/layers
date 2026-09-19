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

  // reload with &solo=vars.* restores a group solo: both "total" and "@items" strong-styled.
  // Clear the persisted selection first — the vars.locals checkbox click above (testing that
  // a checkbox click doesn't affect solo) also flipped its selection off, which would
  // otherwise survive this reload (localStorage persists across page.goto within one context)
  // and break the "whole soloed group painted" assertion below.
  await page.evaluate(() => localStorage.clear());
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

  // --- Item selection (layer tree: expand, tick/untick items & marks, jump, persistence) ---

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function itemRow(layerId, label) {
    return page.locator(`.layer-row[data-layer-id="${layerId}"] + .layer-items .item-row`, {
      has: page.locator(".item-label", { hasText: new RegExp(`^${esc(label)}$`) }),
    });
  }

  // clean slate: earlier tests left every layer off and localStorage populated
  await page.evaluate(() => window.__layers.resetSelection());
  await page.evaluate(() => window.__layers.openFile("invoice.rb"));

  // expanding defs.methods (real click on its caret) lists exactly 5 items, right labels
  await page.locator('.layer-row[data-layer-id="defs.methods"] .tree-caret').click();
  const defsLabels = await page.locator('.layer-row[data-layer-id="defs.methods"] + .layer-items .item-label').allTextContents();
  check(
    "expanding defs.methods lists exactly 5 items with the right labels",
    JSON.stringify(defsLabels) ===
      JSON.stringify(["Invoice#initialize", "Invoice#summary", "Invoice#overdue?", "Mailer#notify", "Mailer#deliver"]),
  );

  // unticking Invoice#summary (real click) removes its paint, leaves initialize painted,
  // makes the layer checkbox indeterminate, and the count reads "4/5"
  await itemRow("defs.methods", "Invoice#summary").locator("input[type=checkbox]").click();
  const afterUntickSummary = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".lyr-defs-methods")];
    return {
      summary: spans.some((el) => el.textContent === "summary"),
      initialize: spans.some((el) => el.textContent === "initialize"),
    };
  });
  check("unticking Invoice#summary removes its paint from line 9", afterUntickSummary.summary === false);
  check("unticking Invoice#summary leaves initialize painted on line 5", afterUntickSummary.initialize === true);
  const defsCbAfterUntick = await page
    .locator('.layer-row[data-layer-id="defs.methods"] input[type=checkbox]')
    .evaluate((el) => el.indeterminate);
  check("defs.methods checkbox is indeterminate after unticking one item", defsCbAfterUntick === true);
  const defsCount4of5 = await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-count').textContent();
  check('defs.methods count reads "4/5"', defsCount4of5 === "4/5");

  // ticking 2 more off gives "2/5"
  await itemRow("defs.methods", "Invoice#overdue?").locator("input[type=checkbox]").click();
  await itemRow("defs.methods", "Mailer#notify").locator("input[type=checkbox]").click();
  const defsCount2of5 = await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-count').textContent();
  check('unticking 2 more items gives "2/5"', defsCount2of5 === "2/5");

  // clicking the layer checkbox from indeterminate turns everything on: a real click on a
  // native checkbox always flips its (unchecked) `checked` property to true, regardless of
  // `indeterminate` — so the rule here is "indeterminate -> all on", never "-> all off"
  await page.locator('.layer-row[data-layer-id="defs.methods"] input[type=checkbox]').click();
  const defsCountAllOn = await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-count').textContent();
  check('clicking the indeterminate layer checkbox turns everything on ("5")', defsCountAllOn === "5");

  // untick 2 (Invoice#summary, Mailer#deliver) to reach "3/5" for the screenshot below
  await itemRow("defs.methods", "Invoice#summary").locator("input[type=checkbox]").click();
  await itemRow("defs.methods", "Mailer#deliver").locator("input[type=checkbox]").click();
  const defsCount3of5 = await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-count').textContent();
  check('defs.methods count reads "3/5"', defsCount3of5 === "3/5");

  // vars.locals -> item Invoice#summary/item has a caret, expands to 2 marks (write, read)
  await page.locator('.layer-row[data-layer-id="vars.locals"] .tree-caret').click();
  await itemRow("vars.locals", "Invoice#summary/item").locator(".tree-caret").click();
  const itemMarkLabels = await page
    .locator('.layer-row[data-layer-id="vars.locals"] + .layer-items .item-marks .mark-label')
    .allTextContents();
  check(
    "vars.locals: Invoice#summary/item expands to 2 marks, write then read",
    itemMarkLabels.length === 2 && itemMarkLabels[0].startsWith("write") && itemMarkLabels[1].startsWith("read"),
  );

  await page.screenshot({ path: join(OUT_DIR, "item-selection.png") });

  // unticking only the read mark (real click) removes paint from "item" on line 12, not line 11
  const varsMarkRows = page.locator('.layer-row[data-layer-id="vars.locals"] + .layer-items .item-marks .mark-row');
  await varsMarkRows.filter({ hasText: "read" }).locator("input[type=checkbox]").click();
  const itemPaint = await page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const hasItemAt = (n) => [...lines[n - 1].querySelectorAll(".lyr-vars-locals")].some((el) => el.textContent === "item");
    return { line11: hasItemAt(11), line12: hasItemAt(12) };
  });
  check('unticking only the read mark removes paint from "item" on line 12', itemPaint.line12 === false);
  check('unticking only the read mark leaves "item" painted on line 11', itemPaint.line11 === true);

  // clicking an item LABEL for Mailer#notify jumps to mailer.rb; back() returns
  await itemRow("defs.methods", "Mailer#notify").locator(".item-label").click();
  const jumpedToMailer = await page.evaluate(() => window.__layers.state.activeFile);
  check("clicking the Mailer#notify item label jumps to mailer.rb", jumpedToMailer === "mailer.rb");
  await page.evaluate(() => window.__layers.back());
  const backFromItemJump = await page.evaluate(() => window.__layers.state.activeFile);
  check("back() returns from the item-label jump", backFromItemJump === "invoice.rb");

  // solo of defs.methods with a partial selection paints only the selected ones; with zero
  // selected it falls back to painting the whole layer
  await page.evaluate(() => window.__layers.solo("defs.methods"));
  const soloPartialTexts = await page.evaluate(() => [...document.querySelectorAll(".lyr-defs-methods")].map((el) => el.textContent));
  check(
    "solo of defs.methods with a partial selection paints only the selected ones",
    soloPartialTexts.includes("initialize") && soloPartialTexts.includes("overdue?") && !soloPartialTexts.includes("summary"),
  );
  await page.evaluate(() => window.__layers.toggleLayer("defs.methods", false));
  const soloZeroTexts = await page.evaluate(() => [...document.querySelectorAll(".lyr-defs-methods")].map((el) => el.textContent));
  check(
    "solo of defs.methods with zero selected falls back to painting all 5",
    soloZeroTexts.includes("initialize") && soloZeroTexts.includes("summary") && soloZeroTexts.includes("overdue?"),
  );
  await page.evaluate(() => window.__layers.solo(null));

  // a reload restores the partial selection and expanded carets
  await page.evaluate(() => window.__layers.toggleLayer("defs.methods", true));
  await itemRow("defs.methods", "Invoice#summary").locator("input[type=checkbox]").click();
  const preReloadCount = await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-count').textContent();
  check('pre-reload defs.methods count is "4/5"', preReloadCount === "4/5");

  await page.goto(`${base}/?project=fixtures/example-ruby`, { waitUntil: "networkidle" });
  await page.waitForSelector(".file-tab");
  const postReloadCount = await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-count').textContent();
  check("reload restores the partial selection", postReloadCount === "4/5");
  check(
    "reload restores the expanded defs.methods caret",
    (await page.locator('.layer-row[data-layer-id="defs.methods"] + .layer-items').count()) === 1,
  );
  check(
    "reload restores the expanded vars.locals caret",
    (await page.locator('.layer-row[data-layer-id="vars.locals"] + .layer-items').count()) === 1,
  );
  check(
    "reload restores the expanded Invoice#summary/item caret",
    (await page.locator('.layer-row[data-layer-id="vars.locals"] + .layer-items .item-marks .mark-row').count()) === 2,
  );

  // resetSelection() restores defaults
  await page.evaluate(() => window.__layers.resetSelection());
  const afterResetCount = await page.locator('.layer-row[data-layer-id="defs.methods"] .layer-count').textContent();
  check('resetSelection() restores the default selection ("5", not partial)', afterResetCount === "5");
  check(
    "resetSelection() also collapses expanded carets",
    (await page.locator('.layer-row[data-layer-id="defs.methods"] + .layer-items').count()) === 0,
  );

  // an unselected token is still clickable (selects its symbol)
  await page.evaluate(() => window.__layers.toggleLayer("defs.methods", false));
  await clickText(18, "overdue?");
  const unselectedTokenClickable = await page.evaluate(() => window.__layers.state.selectedSymbol);
  check("an unselected token is still clickable (selects its symbol)", unselectedTokenClickable === "Invoice#overdue?");

  // --- Scenes ---
  // Fresh reload with cleared localStorage: the presentation key has never been written by
  // the steps above, but clearing everything gives a true blank slate for the empty-list
  // ]/[ assertion below.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/?project=fixtures/example-ruby`, { waitUntil: "networkidle" });
  await page.waitForSelector(".file-tab");

  check("Scenes panel is visible", await page.locator("#scenes-panel").isVisible());
  const firstRightSection = await page.locator(".col-right .right-section").first().getAttribute("data-section");
  check("Scenes panel is the first (top) section in the right column", firstRightSection === "scenes");

  check("scenes list starts empty", (await page.evaluate(() => window.__layers.scenes.list())).length === 0);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("]");
  const soloWithEmptyScenes = await page.evaluate(() => window.__layers.state.solo);
  check('with an empty scene list, "]" still solos a layer', soloWithEmptyScenes !== null);
  await page.evaluate(() => window.__layers.solo(null));

  // addFromView with defs.methods soloed creates scene 1 with exactly 5 mark keys
  await page.evaluate(() => window.__layers.openFile("invoice.rb"));
  await page.evaluate(() => window.__layers.solo("defs.methods"));
  await page.evaluate(() => window.__layers.scenes.addFromView("The two classes", { pinStep: false }));
  await page.evaluate(() => window.__layers.solo(null));
  const scene1 = (await page.evaluate(() => window.__layers.scenes.list()))[0];
  check("addFromView with defs.methods soloed creates scene 1 with exactly 5 mark keys", scene1.marks.length === 5);

  // second scene from a partial selection (setMarks)
  await page.evaluate(() => {
    for (const id of Object.keys(window.__layers.state.layerState)) window.__layers.toggleLayer(id, false);
  });
  const partialKeys = ["vars.locals|invoice.rb|159|164", "vars.locals|invoice.rb|200|205"];
  await page.evaluate((keys) => window.__layers.setMarks(keys, true), partialKeys);
  await page.evaluate(() => window.__layers.scenes.addFromView("partial selection", { pinStep: false }));
  const scene2 = (await page.evaluate(() => window.__layers.scenes.list()))[1];
  check("scene 2 built from a partial selection has exactly the selected marks", JSON.stringify([...scene2.marks].sort()) === JSON.stringify([...partialKeys].sort()));

  // third scene with pinStep at stepper cursor 14
  await page.evaluate(() => window.__layers.resetSelection());
  await page.evaluate(() => window.__layers.stepper.goto(14));
  await page.evaluate(() => window.__layers.scenes.addFromView("step14", { pinStep: true }));
  const scene3 = (await page.evaluate(() => window.__layers.scenes.list()))[2];
  check("scene 3 has a pinned step of 14", scene3.step === 14);

  // activating scene 1 (real click) paints exactly N lyr-solo tokens in invoice.rb, computed
  // from the data itself, and leaves state.selection unchanged
  const expectedScene1Count = await page.evaluate(() => {
    const layer = window.__layers.state.doc.layers.find((l) => l.id === "defs.methods");
    return layer.marks.filter((m) => m.file === "invoice.rb").length;
  });
  const selectionBeforeActivate = await page.evaluate(() => [...window.__layers.state.selection].sort());
  await page.locator(".scene-row .scene-name", { hasText: "The two classes" }).click();
  await page.waitForTimeout(350); // past the click/dblclick disambiguation window
  const soloTokenCount = await page.locator(".lyr-solo").count();
  check("activating scene 1 paints exactly the expected number of lyr-solo tokens in invoice.rb", soloTokenCount === expectedScene1Count);
  const selectionAfterActivate = await page.evaluate(() => [...window.__layers.state.selection].sort());
  check("activating a scene leaves state.selection unchanged", JSON.stringify(selectionAfterActivate) === JSON.stringify(selectionBeforeActivate));

  const chipText1 = await page.locator("#solo-chip").textContent();
  check('chip text matches "scene 1/3: …"', chipText1.startsWith("scene 1/3:"));

  // real "]" goes 1 -> 2 -> 3 -> 1 (wraps); "[" goes back
  const sceneIds = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("]");
  check("real ] moves scene 1 -> 2", (await page.evaluate(() => window.__layers.scenes.activeId)) === sceneIds[1]);
  await page.keyboard.press("]");
  check("real ] moves scene 2 -> 3", (await page.evaluate(() => window.__layers.scenes.activeId)) === sceneIds[2]);
  await page.keyboard.press("]");
  check("real ] wraps scene 3 -> 1", (await page.evaluate(() => window.__layers.scenes.activeId)) === sceneIds[0]);
  await page.keyboard.press("[");
  check("real [ wraps scene 1 -> 3", (await page.evaluate(() => window.__layers.scenes.activeId)) === sceneIds[2]);

  // activating scene 3 (reached above via [) moves the stepper cursor to 14 and shows the
  // current-statement decoration
  check("activating scene 3 moves the stepper cursor to 14", (await page.evaluate(() => window.__layers.stepper.cursor)) === 14);
  check("activating scene 3 shows the current-statement decoration", (await page.locator(".step-current").count()) > 0);

  await page.keyboard.press("Escape");
  check("Escape deactivates the active scene", (await page.evaluate(() => window.__layers.scenes.activeId)) === null);

  // duplicate -> list length 4, copy sits right after the original with " copy"
  // action buttons only appear on hover, so hover the row first like a real user
  const twoClassesRow = page.locator(".scene-row", { has: page.locator(".scene-name", { hasText: "The two classes" }) }).first();
  await page.mouse.move(640, 400); // park the pointer over the editor, away from the scene rows
  check("scene action buttons are hidden until the row is hovered", !(await twoClassesRow.locator(".scene-dup").isVisible()));
  await twoClassesRow.hover();
  await twoClassesRow.locator(".scene-dup").click();
  const afterDup = await page.evaluate(() => window.__layers.scenes.list());
  check("duplicate makes the list length 4", afterDup.length === 4);
  check('the copy sits right after the original with " copy" appended', afterDup[1].name === "The two classes copy");

  // real double-click rename + Enter changes the name
  await page.locator(".scene-row .scene-name", { hasText: "The two classes copy" }).dblclick();
  await page.waitForTimeout(350);
  await page.keyboard.type("Renamed scene");
  await page.keyboard.press("Enter");
  const afterRename = await page.evaluate(() => window.__layers.scenes.list());
  check("real double-click + Enter renames the scene", afterRename[1].name === "Renamed scene");

  // move(id, 0) reorders; real Alt+ArrowDown moves the active scene down one
  const idsBeforeMove = afterRename.map((s) => s.id);
  const lastSceneId = idsBeforeMove[idsBeforeMove.length - 1];
  await page.evaluate((id) => window.__layers.scenes.move(id, 0), lastSceneId);
  const idsAfterMove = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  check("move(id, 0) reorders the scene to the front", idsAfterMove[0] === lastSceneId);

  await page.evaluate((id) => window.__layers.scenes.activate(id), lastSceneId);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Alt+ArrowDown");
  const idsAfterAltDown = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  check("real Alt+ArrowDown moves the active scene down one", idsAfterAltDown[1] === lastSceneId && idsAfterAltDown[0] !== lastSceneId);
  await page.evaluate(() => window.__layers.scenes.activate(null));

  // ⇤ load sets selection to the scene's marks
  const loadTarget = (await page.evaluate(() => window.__layers.scenes.list()))[0];
  await page.locator(".scene-row").first().hover();
  await page.locator(".scene-row").first().locator(".scene-load").click();
  const selectionAfterLoad = await page.evaluate(() => [...window.__layers.state.selection].sort());
  check("⇤ load sets selection to the scene's marks", JSON.stringify(selectionAfterLoad) === JSON.stringify([...loadTarget.marks].sort()));

  // ⟲ update overwrites marks with the current view
  await page.evaluate(() => window.__layers.resetSelection());
  await page.evaluate(() => window.__layers.solo("vars.ivars"));
  const expectedUpdateMarks = await page.evaluate(() => {
    const layer = window.__layers.state.doc.layers.find((l) => l.id === "vars.ivars");
    return layer.marks.map((m) => `vars.ivars|${m.file}|${m.start}|${m.end}`).sort();
  });
  const updateTargetId = (await page.evaluate(() => window.__layers.scenes.list()))[0].id;
  await page.locator(".scene-row").first().hover();
  await page.locator(".scene-row").first().locator(".scene-update").click();
  await page.evaluate(() => window.__layers.solo(null));
  const afterUpdate = (await page.evaluate(() => window.__layers.scenes.list())).find((s) => s.id === updateTargetId);
  check("⟲ update overwrites marks with the current view", JSON.stringify([...afterUpdate.marks].sort()) === JSON.stringify(expectedUpdateMarks));

  // ✕ delete removes the scene
  const idsBeforeDelete = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  await page.locator(".scene-row").first().hover();
  await page.locator(".scene-row").first().locator(".scene-remove").click();
  const idsAfterDelete = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  check(
    "✕ delete removes the scene",
    idsAfterDelete.length === idsBeforeDelete.length - 1 && !idsAfterDelete.includes(idsBeforeDelete[0]),
  );

  // reload restores the list from localStorage; &scene=2 restores the active scene
  const idsBeforeReload = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  await page.goto(`${base}/?project=fixtures/example-ruby&scene=2`, { waitUntil: "networkidle" });
  await page.waitForSelector(".file-tab");
  const idsAfterReload = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  check("reload restores the scene list from localStorage", JSON.stringify(idsAfterReload) === JSON.stringify(idsBeforeReload));
  check("&scene=2 restores the active scene", (await page.evaluate(() => window.__layers.scenes.activeId)) === idsAfterReload[1]);

  // export link produces JSON equal to list() (read the Blob content in-page)
  const exportHref = await page.locator("#scenes-export-link").getAttribute("href");
  const exportedScenes = await page.evaluate(async (href) => (await (await fetch(href)).json()).scenes, exportHref);
  const listNow = await page.evaluate(() => window.__layers.scenes.list());
  check("export link JSON equals list()", JSON.stringify(exportedScenes) === JSON.stringify(listNow));

  // import of examples/presentation.example-ruby.json via the real file input yields 4
  // scenes and a "dropped 0" message
  const examplePath = join(__dirname, "..", "examples", "presentation.example-ruby.json");
  await page.setInputFiles("#scenes-import-input", examplePath);
  await page.waitForFunction(() => window.__layers.scenes.list().length === 4); // FileReader is async
  const afterImport = await page.evaluate(() => window.__layers.scenes.list());
  check("import via the real file input yields 4 scenes", afterImport.length === 4);
  const importMessage = await page.locator("#scenes-message").textContent();
  check('import shows "imported 4 scenes, dropped 0" message', /imported 4 scenes, dropped 0/.test(importMessage));

  // token click still selects a symbol while a scene is active
  const firstImportedId = (await page.evaluate(() => window.__layers.scenes.list()))[0].id;
  await page.evaluate((id) => window.__layers.scenes.activate(id), firstImportedId);
  await page.evaluate(() => window.__layers.openFile("invoice.rb"));
  await clickText(18, "overdue?");
  check(
    "token click still selects a symbol while a scene is active",
    (await page.evaluate(() => window.__layers.state.selectedSymbol)) === "Invoice#overdue?",
  );

  // screenshots: 4 scenes, one active, one with a pinned step
  await page.screenshot({ path: join(OUT_DIR, "scenes-panel.png") });

  const pinnedScene = (await page.evaluate(() => window.__layers.scenes.list())).find((s) => s.step !== null);
  await page.evaluate((id) => window.__layers.scenes.activate(id), pinnedScene.id);
  await page.screenshot({ path: join(OUT_DIR, "scene-active.png") });

  // import of malformed JSON shows an inline error and leaves the list intact
  const idsBeforeBadImport = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  const messageBeforeBadImport = await page.locator("#scenes-message").textContent();
  await page.setInputFiles("#scenes-import-input", { name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{ not valid json") });
  await page.waitForFunction(
    (prev) => document.querySelector("#scenes-message")?.textContent !== prev,
    messageBeforeBadImport,
  ); // FileReader is async
  const errorMessage = await page.locator("#scenes-message").textContent();
  check("malformed JSON import shows an inline error message", errorMessage.length > 0 && !/imported/.test(errorMessage));
  const idsAfterBadImport = (await page.evaluate(() => window.__layers.scenes.list())).map((s) => s.id);
  check("malformed JSON import leaves the list intact", JSON.stringify(idsAfterBadImport) === JSON.stringify(idsBeforeBadImport));

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
