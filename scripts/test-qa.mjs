import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const moduleRoot = process.env.WORKSPACE_NODE_MODULES;
const require = createRequire(moduleRoot ? `${moduleRoot}/package.json` : import.meta.url);
const { chromium } = require("playwright");

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4273/";
const outputDir = resolve(import.meta.dirname, "../test-results");
const errors = [];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

async function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function monitor(page) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "request failed";
    if (!failure.includes("ERR_ABORTED") && !request.url().includes(".mp4")) {
      errors.push(`request: ${request.url()} (${failure})`);
    }
  });
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(["microphone"], { origin: new URL(baseUrl).origin });
  const page = await context.newPage();
  monitor(page);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".script-line:nth-child(59)");
  await page.waitForFunction(() => document.querySelector("#referenceVideo").readyState >= 1, null, { timeout: 30000 });

  assert(await page.locator(".script-line").count() === 59, "應載入 59 句台詞");
  assert((await page.locator("#workMeta").textContent()).includes("6 角"), "作品資訊不完整");
  assert(await page.locator("#evaluationMode").textContent() === "瀏覽器測試評分", "評分模式錯誤");

  await page.locator("#roleFilter").selectOption({ label: "琪琪" });
  assert(await page.locator(".script-line:visible").count() === 22, "角色篩選結果錯誤");
  await page.locator("#roleFilter").selectOption("");
  await page.locator("#searchLines").fill("オーブン");
  assert(await page.locator(".script-line:visible").count() >= 1, "台詞搜尋沒有結果");
  await page.locator("#searchLines").fill("");

  await page.locator("#playReference").click();
  await page.waitForFunction(() => document.querySelector("#referenceVideo").currentTime >= 0.3);
  assert(await page.locator("#referenceVideo").evaluate((video) => video.currentTime < 4.78), "示範播放沒有從本句開始");
  await page.locator("#referenceVideo").evaluate((video) => video.pause());

  await page.locator("#startRecording").click();
  await page.waitForFunction(() => document.body.classList.contains("is-recording"));
  await page.waitForTimeout(1100);
  await page.locator("#stopRecording").click();
  await page.waitForFunction(() => !document.querySelector("#recordingPlayback").hidden);
  assert(await page.locator("#evaluateRecording").isEnabled(), "錄音後評分按鈕未啟用");

  const target = await page.evaluate(async () => (await (await fetch("data/kiki.json")).json()).lines[0].japanese);
  await page.locator("#recognizedText").fill(target);
  await page.locator("#evaluateRecording").click();
  await page.waitForFunction(() => !document.querySelector("#resultPanel").hidden);
  assert(await page.locator(".score-row").count() === 3, "評分明細應有三項");
  assert(Number(await page.locator("#overallScore").textContent()) >= 55, "測試分數異常");
  assert(await page.locator(".issue-list li").count() >= 3, "問題建議未顯示");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!overflow, "桌機版出現水平溢位");
  await page.screenshot({ path: `${outputDir}/qa-desktop.png`, fullPage: true });
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobilePage = await mobile.newPage();
  monitor(mobilePage);
  await mobilePage.goto(`${baseUrl}#line-1`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForSelector(".script-line:nth-child(59)");
  await mobilePage.waitForFunction(() => document.querySelector("#referenceVideo").readyState >= 1, null, { timeout: 30000 });
  const mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!mobileOverflow, "手機版出現水平溢位");
  await mobilePage.screenshot({ path: `${outputDir}/qa-mobile.png`, fullPage: true });
  await mobile.close();

  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("QA browser test passed: 59 lines, filters, recording, scoring, desktop and mobile layouts.\n");
} finally {
  await browser.close();
}
