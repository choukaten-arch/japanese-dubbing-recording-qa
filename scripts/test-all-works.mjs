import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const moduleRoot = process.env.WORKSPACE_NODE_MODULES;
const require = createRequire(moduleRoot ? `${moduleRoot}/package.json` : import.meta.url);
const { chromium } = require("playwright");

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4273/";
const outputDir = resolve(import.meta.dirname, "../test-results/all-works");
const works = [
  { slug: "kiki", title: "魔女宅急便", lines: 59, roles: 6 },
  { slug: "ponyo", title: "崖上的波妞", lines: 77, roles: 8 },
  { slug: "maruko", title: "櫻桃小丸子：來自義大利的少年", lines: 88, roles: 22 },
  { slug: "spirited-away", title: "神隱少女", lines: 70, roles: 8 },
  { slug: "totoro", title: "龍貓", lines: 54, roles: 5 },
];
const errors = [];

await mkdir(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function monitor(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      errors.push(`${label} console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`${label} page: ${error.message}`));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && url.pathname !== "/favicon.ico") {
      errors.push(`${label} response: ${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "request failed";
    if (!failure.includes("ERR_ABORTED") && !request.url().includes(".mp4")) {
      errors.push(`${label} request: ${request.url()} (${failure})`);
    }
  });
}

async function waitForWork(page, work) {
  await page.waitForFunction(
    ({ title, lines }) => document.getElementById("pageTitle")?.textContent === title
      && document.querySelectorAll(".script-line").length === lines,
    { title: work.title, lines: work.lines },
  );
  await page.waitForFunction(
    () => document.querySelector("#referenceVideo")?.readyState >= 1,
    null,
    { timeout: 30000 },
  );
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await desktop.grantPermissions(["microphone"], { origin: new URL(baseUrl).origin });

  for (const work of works) {
    const page = await desktop.newPage();
    monitor(page, `${work.slug} desktop`);
    await page.goto(`${baseUrl}?work=${work.slug}#line-1`, { waitUntil: "domcontentloaded" });
    await waitForWork(page, work);

    const data = await page.evaluate(async (slug) => (await (await fetch(`data/${slug}.json`)).json()), work.slug);
    assert(data.lines.length === work.lines, `${work.title} 的資料行數錯誤`);
    assert(await page.locator(".work-switcher__link").count() === 5, "作品切換列應顯示五部");
    assert(await page.locator(".work-switcher__link.is-active").count() === 1, `${work.title} 沒有唯一選取狀態`);
    assert((await page.locator("#workMeta").textContent()).includes(`${work.roles} 角`), `${work.title} 的角色資訊錯誤`);
    assert(await page.locator("#roleFilter option").count() === work.roles + 1, `${work.title} 的角色選單錯誤`);
    assert((await page.locator("#referenceVideo").getAttribute("src")).endsWith(`/media/${work.slug}.mp4`), `${work.title} 的影片路徑錯誤`);

    const firstRole = data.roles[0];
    await page.locator("#roleFilter").selectOption(firstRole.role);
    assert(await page.locator(".script-line:visible").count() === firstRole.lineCount, `${work.title} 的角色篩選錯誤`);
    await page.locator("#roleFilter").selectOption("");

    await page.locator('.script-line[data-index="1"]').click();
    assert(new URL(page.url()).searchParams.get("work") === work.slug, `${work.title} 切換台詞後遺失作品參數`);
    assert(new URL(page.url()).hash === "#line-2", `${work.title} 切換台詞後時間軸網址錯誤`);

    await page.locator("#playReference").click();
    await page.waitForFunction((start) => document.querySelector("#referenceVideo").currentTime >= start + 0.08, data.lines[1].start);
    const videoTime = await page.locator("#referenceVideo").evaluate((video) => video.currentTime);
    assert(videoTime < data.lines[1].end, `${work.title} 沒有播放所選台詞片段`);
    await page.locator("#referenceVideo").evaluate((video) => video.pause());

    await page.locator("#startRecording").click();
    await page.waitForFunction(() => document.body.classList.contains("is-recording"));
    await page.waitForTimeout(900);
    await page.locator("#stopRecording").click();
    await page.waitForFunction(() => !document.querySelector("#recordingPlayback").hidden);
    await page.locator("#recognizedText").fill(data.lines[1].japanese);
    await page.locator("#evaluateRecording").click();
    await page.waitForFunction(() => !document.querySelector("#resultPanel").hidden);
    assert(await page.locator(".score-row").count() === 3, `${work.title} 的評分明細錯誤`);
    assert(Number(await page.locator("#overallScore").textContent()) >= 55, `${work.title} 的測試分數異常`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert(!overflow, `${work.title} 桌機版出現水平溢位`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${outputDir}/${work.slug}-desktop.png`, fullPage: false });
    await page.close();
  }
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  for (const work of works) {
    const page = await mobile.newPage();
    monitor(page, `${work.slug} mobile`);
    await page.goto(`${baseUrl}?work=${work.slug}#line-1`, { waitUntil: "domcontentloaded" });
    await waitForWork(page, work);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert(!overflow, `${work.title} 手機版出現水平溢位`);
    assert(await page.locator(".work-switcher__link.is-active").isVisible(), `${work.title} 手機版未顯示選取作品`);
    await page.screenshot({ path: `${outputDir}/${work.slug}-mobile.png`, fullPage: false });
    await page.close();
  }
  await mobile.close();

  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("All five QA works passed data, video, filtering, recording, scoring, URL-state, desktop, and mobile checks.\n");
} finally {
  await browser.close();
}
