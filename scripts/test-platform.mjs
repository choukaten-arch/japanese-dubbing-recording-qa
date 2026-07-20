import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const moduleRoot = process.env.WORKSPACE_NODE_MODULES;
const require = createRequire(moduleRoot ? `${moduleRoot}/package.json` : import.meta.url);
const { chromium } = require("playwright");

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4273/";
const outputDir = resolve(import.meta.dirname, "../test-results/platform");
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
    if (response.status() >= 400 && url.origin === new URL(baseUrl).origin && url.pathname !== "/favicon.ico") {
      errors.push(`${label} response: ${response.status()} ${response.url()}`);
    }
  });
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(["microphone"], { origin: new URL(baseUrl).origin });
  const page = await context.newPage();
  monitor(page, "desktop platform");
  await page.goto(`${baseUrl}portal.html?demo=1`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("dubbingPlatformSessionV1");
    localStorage.removeItem("dubbingPlatformActiveTaskV1");
    localStorage.removeItem("dubbingPlatformDemoDataV1");
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  assert(await page.locator(".poster-board figure").count() === 5, "登入頁應顯示五部作品");
  await page.locator("#studentId").fill("demo");
  await page.locator("#studentPin").fill("123456");
  await page.locator("#studentLoginPanel button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#preferenceDialog")?.open);
  assert(await page.locator("#preferenceClose").isHidden(), "首次登入不可略過作品與角色設定");
  assert(await page.locator("#preferenceDialog input").count() === 0, "學生首次設定不應包含組別欄位");
  await page.locator("#preferenceWork").selectOption("kiki");
  await page.waitForFunction(() => document.querySelectorAll("#preferenceRole option").length > 1);
  await page.locator("#preferenceRole").selectOption("琪琪");
  await page.locator("#preferenceForm button[type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#studentView").hidden && document.querySelectorAll(".task-item").length > 0);
  assert((await page.locator("#taskList").innerText()).includes("琪琪台詞練習"), "學生登入後未顯示指派作業");
  assert((await page.locator("#studentPreferenceLabel").innerText()).includes("魔女宅急便 · 琪琪"), "學生選角沒有保留在任務頁");
  assert(await page.locator(".group-progress-block").count() >= 2, "學生端未顯示分組熟練度");
  assert(await page.locator(".group-member-list .is-current").count() === 1, "學生本人未在分組進度中標示");

  await page.locator(".task-action a").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".script-line")].filter((element) => !element.hidden).length === 5);
  assert((await page.locator(".assignment-context").innerText()).includes("琪琪"), "逐句頁缺少作業資訊");
  assert(await page.locator(".work-switcher:visible").count() === 0, "作業模式不應顯示作品切換列");

  await page.locator("#startRecording").click();
  await page.waitForFunction(() => document.body.classList.contains("is-recording"));
  await page.waitForTimeout(800);
  await page.locator("#stopRecording").click();
  await page.waitForFunction(() => !document.querySelector("#recordingPlayback").hidden);
  const target = await page.locator("#selectedJapanese").innerText();
  await page.locator("#recognizedText").fill(target);
  await page.locator("#evaluateRecording").click();
  await page.waitForFunction(() => document.querySelector("#cloudSyncStatus")?.classList.contains("is-saved"));
  assert((await page.locator("#cloudSyncStatus").innerText()).includes("已保存"), "逐句評分沒有保存狀態");
  assert((await page.locator("#bridgeProgressValue").innerText()).startsWith("1 / 5"), "作業完成進度未更新");
  await page.screenshot({ path: `${outputDir}/student-assignment-desktop.png`, fullPage: true });

  await page.goto(`${baseUrl}portal.html?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector("#studentView").hidden && document.querySelector("#taskList")?.textContent.includes("1 / 5 句完成"));
  assert((await page.locator("#taskList").innerText()).includes("1 / 5 句完成"), "返回任務頁後完成狀態未保留");
  await page.locator("#logoutButton").click();
  await page.waitForFunction(() => !document.querySelector("#authView").hidden);
  await page.locator("#teacherMode").click();
  await page.locator("#teacherPin").fill("teacher1");
  await page.locator("#teacherLoginPanel button[type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#teacherView").hidden && document.querySelector("#metricStudents").textContent !== "—");
  assert(await page.locator(".metrics > div").count() === 4, "老師後台概況應有四項指標");
  assert((await page.locator("#recentResultRows").innerText()).includes("測試學生"), "老師後台未顯示最近逐句結果");
  await page.locator('.teacher-tab[data-tab="groups"]').click();
  assert((await page.locator("#groupRows").innerText()).includes("第 1 組"), "老師後台未顯示各組練習概況");
  await page.screenshot({ path: `${outputDir}/teacher-groups-desktop.png`, fullPage: true });
  await page.locator('.teacher-tab[data-tab="students"]').click();
  let demoRow = page.locator("#studentRows tr").filter({ hasText: "測試學生" });
  await demoRow.locator(".group-name-input").fill("第 3 組");
  await demoRow.locator(".save-group-button").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("組別已更新"));
  demoRow = page.locator("#studentRows tr").filter({ hasText: "測試學生" });
  assert(await demoRow.locator(".group-name-input").inputValue() === "第 3 組", "老師設定的學生組別沒有保存");
  await demoRow.locator(".history-button").click();
  await page.waitForFunction(() => document.querySelector("#historyDialog")?.open);
  assert((await page.locator("#historyTitle").innerText()).includes("測試學生"), "逐句歷程沒有顯示學生姓名");
  assert(Number(await page.locator("#historyAttempts").innerText()) >= 1, "逐句歷程沒有累計練習次數");
  const historyTarget = await page.locator("#historyLineRows [lang=ja]").first().innerText();
  assert(historyTarget !== "—" && historyTarget.length > 5, "逐句歷程沒有保存練習台詞");
  await page.screenshot({ path: `${outputDir}/teacher-history-desktop.png`, fullPage: true });
  await page.locator("#historyClose").click();

  await page.locator('.teacher-tab[data-tab="assign"]').click();
  await page.locator("#assignmentWork").selectOption("totoro");
  await page.waitForFunction(() => document.querySelectorAll("#assignmentRole option").length > 1);
  await page.locator("#assignmentRole").selectOption("さつき");
  await page.locator("#assignmentCount").fill("3");
  await page.locator("#assignmentTitle").fill("皋月三句練習");
  await page.locator("#assignmentForm button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已發派"));
  await page.waitForFunction(() => document.querySelector("#assignmentRows")?.textContent.includes("皋月三句練習"));
  await page.locator('.teacher-tab[data-tab="progress"]').click();
  assert((await page.locator("#assignmentRows").innerText()).includes("皋月三句練習"), "老師發派的新作業未出現在進度表");
  await page.screenshot({ path: `${outputDir}/teacher-dashboard-desktop.png`, fullPage: true });
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  monitor(mobilePage, "mobile platform");
  await mobilePage.goto(`${baseUrl}portal.html?demo=1`, { waitUntil: "domcontentloaded" });
  const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!overflow, "登入頁手機版出現水平溢位");
  assert(await mobilePage.locator("#studentLoginPanel").isVisible(), "手機版未顯示學生登入");
  await mobilePage.screenshot({ path: `${outputDir}/login-mobile.png`, fullPage: true });

  await mobilePage.locator("#studentId").fill("demo");
  await mobilePage.locator("#studentPin").fill("123456");
  await mobilePage.locator("#studentLoginPanel button[type=submit]").click();
  await mobilePage.waitForFunction(() => document.querySelector("#preferenceDialog")?.open);
  await mobilePage.screenshot({ path: `${outputDir}/first-setup-mobile.png`, fullPage: true });
  await mobilePage.locator("#preferenceWork").selectOption("kiki");
  await mobilePage.waitForFunction(() => document.querySelectorAll("#preferenceRole option").length > 1);
  await mobilePage.locator("#preferenceRole").selectOption("琪琪");
  await mobilePage.locator("#preferenceForm button[type=submit]").click();
  await mobilePage.waitForFunction(() => document.querySelectorAll(".task-item").length > 0);
  const studentOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!studentOverflow, "學生任務手機版出現水平溢位");
  await mobilePage.screenshot({ path: `${outputDir}/student-tasks-mobile.png`, fullPage: true });

  await mobilePage.locator("#logoutButton").click();
  await mobilePage.waitForFunction(() => !document.querySelector("#authView").hidden);
  await mobilePage.locator("#teacherMode").click();
  await mobilePage.locator("#teacherPin").fill("teacher1");
  await mobilePage.locator("#teacherLoginPanel button[type=submit]").click();
  await mobilePage.waitForFunction(() => !document.querySelector("#teacherView").hidden && document.querySelector("#metricStudents").textContent !== "—");
  const teacherOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!teacherOverflow, "老師後台手機版出現水平溢位");
  await mobilePage.screenshot({ path: `${outputDir}/teacher-dashboard-mobile.png`, fullPage: true });
  await mobile.close();

  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("Platform passed first-login role setup, grouped mastery, assigned-line recording, history, teacher grouping and assignment, desktop, and mobile checks.\n");
} finally {
  await browser.close();
}
