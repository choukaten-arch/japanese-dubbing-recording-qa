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

  const portalRelease = await page.evaluate(() => window.QA_RELEASE);
  assert(/^\d{8}\.\d+$/.test(portalRelease), "入口頁缺少靜態資源版號");
  const portalAssetVersions = await page.locator('link[rel="stylesheet"], script[src]').evaluateAll((elements) => (
    elements.map((element) => new URL(element.href || element.src).searchParams.get("v"))
  ));
  assert(portalAssetVersions.every((version) => version === portalRelease), "入口頁載入了不同版本的 CSS 或 JavaScript");
  assert(await page.locator(".poster-board figure").count() === 5, "登入頁應顯示五部作品");
  assert(await page.locator("#studentPin").getAttribute("minlength") === "5", "學生 PIN 欄位應接受 5 碼");
  await page.locator("#studentId").fill("demo");
  await page.locator("#studentPin").fill("123456");
  await page.locator("#studentLoginPanel button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#preferenceDialog")?.open);
  assert(await page.locator("#preferenceClose").isHidden(), "首次登入不可略過作品與角色設定");
  assert(await page.locator("#preferenceDialog .group-editor").count() === 0, "學生首次設定不應包含組別欄位");
  await page.locator("#preferenceWork").selectOption("kiki");
  await page.waitForFunction(() => document.querySelectorAll("#preferenceRoles input[type=checkbox]").length > 1);
  assert(await page.locator('#preferenceRoles input[value^="音效＿"]').count() === 8, "魔女宅急便應提供 8 個具時間軸名稱的音效角色");
  await page.locator('#preferenceRoles input[value="琪琪"]').check();
  await page.locator('#preferenceRoles input[value="老夫人"]').check();
  await page.locator("#preferenceForm button[type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#studentView").hidden && document.querySelectorAll(".task-item").length > 0 && document.querySelectorAll(".self-practice-item").length === 2 && document.querySelectorAll(".showcase-card").length >= 2);
  assert((await page.locator("#taskList").innerText()).includes("琪琪台詞練習"), "學生登入後未顯示指派作業");
  assert((await page.locator("#studentPreferenceLabel").innerText()).includes("魔女宅急便 · 琪琪、老夫人"), "學生複數選角沒有保留在任務頁");
  assert((await page.locator("#selfPracticeList").innerText()).includes("琪琪"), "自主練習未顯示琪琪");
  assert((await page.locator("#selfPracticeList").innerText()).includes("老夫人"), "未發派作業的角色未顯示自主練習入口");
  assert(await page.locator("#studentRadar").isVisible(), "學生端未顯示四面向雷達圖");
  assert(await page.locator(".group-progress-block").count() >= 2, "學生端未顯示分組熟練度");
  assert(await page.locator(".group-member-list .is-current").count() === 1, "學生本人未在分組進度中標示");
  assert(await page.locator(".group-progress-block.is-own-group .group-member-list").count() === 1, "同組進度未顯示每位成員");
  assert(await page.locator(".group-progress-block:not(.is-own-group) .group-member-list").count() >= 1, "不同組別未顯示成員姓名");
  assert(await page.locator(".group-progress-block:not(.is-own-group) .member-rank-score").count() === 0, "不同組別不應顯示個別學生精確分數");
  const allGroupsHaveNames = await page.locator(".group-progress-block").evaluateAll((groups) => groups.every((group) => group.querySelectorAll(".member-rank-name").length > 0));
  assert(allGroupsHaveNames, "每一組都應顯示成員姓名");
  const ownGroupNames = await page.locator(".group-progress-block.is-own-group .member-rank-name").allTextContents();
  assert(ownGroupNames.join("|") === "示範組員乙|示範組員甲|測試學生", "組員姓名未依完成度由高至低、由左至右排列");
  const tierKeys = await page.evaluate(() => [90, 80, 70, 60, 59.9].map((score) => masteryTierKey(score)));
  assert(tierKeys.join("|") === "gold|silver|bronze|iron|rust", "姓名完成度顏色級距不正確");
  assert(await page.locator(".showcase-card.is-own-group .showcase-member-list").count() === 1, "同組成果未顯示成員完成度");
  assert(await page.locator(".showcase-card:not(.is-own-group) .showcase-member-list").count() >= 1, "別組成果未顯示成員姓名");
  assert(await page.locator(".showcase-card:not(.is-own-group) .member-rank-score").count() === 0, "別組成果不應顯示個別學生精確分數");
  const ownShowcaseButton = page.locator(".showcase-card.is-own-group .showcase-play-button");
  assert(await ownShowcaseButton.count() === 1, "自己的小組成果缺少合成播放按鈕");
  await ownShowcaseButton.click();
  await page.waitForFunction(() => {
    const player = [...portalState.showcasePlayers.values()].find((item) => item.showcase.isOwnGroup);
    return player && !player.video.paused && player.audioElements.size > 0;
  });
  assert(await page.locator(".showcase-card.is-own-group video").evaluate((video) => video.muted), "小組成果播放時原影片未靜音");
  await ownShowcaseButton.click();
  await page.locator("#changePreference").click();
  await page.waitForFunction(() => document.querySelector("#preferenceDialog")?.open);
  assert(await page.locator('#preferenceRoles input[value="琪琪"]').isChecked(), "重新開啟選角時未保留琪琪");
  assert(await page.locator('#preferenceRoles input[value="老夫人"]').isChecked(), "重新開啟選角時未保留老夫人");
  await page.locator("#preferenceClose").click();

  await page.locator(".task-action a").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".script-line")].filter((element) => !element.hidden).length === 5);
  assert(await page.evaluate(() => new URL(window.QA_CONFIG.dataFile, location.href).searchParams.get("v") === window.QA_RELEASE), "逐句頁作品資料未使用目前版號");
  const qaAssetVersions = await page.locator('link[rel="stylesheet"], script[src]').evaluateAll((elements) => (
    elements.map((element) => new URL(element.href || element.src).searchParams.get("v"))
  ));
  assert(qaAssetVersions.every((version) => version === portalRelease), "逐句頁載入了不同版本的 CSS 或 JavaScript");
  assert((await page.locator(".assignment-context").innerText()).includes("琪琪"), "逐句頁缺少作業資訊");
  assert(await page.locator(".work-switcher:visible").count() === 0, "作業模式不應顯示作品切換列");

  await page.locator("#startRecording").click();
  await page.waitForFunction(() => document.body.classList.contains("is-recording"));
  assert(await page.locator("#referenceVideo").evaluate((video) => video.muted), "卡啦 OK 錄音時影片未靜音");
  assert(await page.locator("#karaokeOverlay").isVisible(), "錄音時未顯示卡啦 OK 字幕");
  await page.waitForTimeout(800);
  assert(await page.locator(".karaoke-character.is-sung").count() > 0, "字幕沒有隨影片時間變色");
  await page.locator("#stopRecording").click();
  await page.waitForFunction(() => !document.querySelector("#recordingPlayback").hidden);
  assert(await page.locator("#recordingReview").isVisible(), "錄音完成後未顯示我的錄音播放器");
  assert(!(await page.locator("#playSyncedReview").isDisabled()), "錄音完成後無法啟用同步回看");
  await page.locator("#playSyncedReview").click();
  await page.waitForFunction(() => document.body.classList.contains("is-reviewing"));
  assert(await page.locator("#referenceVideo").evaluate((video) => video.muted), "同步回看時影片未靜音");
  assert(!(await page.locator("#recordingPlayback").evaluate((audio) => audio.paused)), "同步回看沒有播放學生錄音");
  await page.locator("#playSyncedReview").click();
  await page.waitForFunction(() => !document.body.classList.contains("is-reviewing"));
  const target = await page.locator("#selectedJapanese").innerText();
  await page.locator("#recognizedText").fill(target);
  await page.locator("#evaluateRecording").click();
  await page.waitForFunction(() => document.querySelector("#cloudSyncStatus")?.classList.contains("is-saved"));
  assert((await page.locator("#cloudSyncStatus").innerText()).includes("已保存"), "逐句評分沒有保存狀態");
  assert((await page.locator("#bridgeProgressValue").innerText()).startsWith("1 / 5"), "作業完成進度未更新");
  assert((await page.locator("#scoreRows").innerText()).includes("重音"), "評分明細缺少重音分數");
  assert((await page.locator("#scoreRows").innerText()).includes("語調"), "評分明細缺少語調分數");
  const speedScore = Number(await page.locator(".score-row").filter({ hasText: "語速" }).locator("strong").innerText());
  assert(speedScore >= 50, "語速仍被錄音按鍵延遲過度扣分");
  assert((await page.locator("#issueList").innerText()).includes("不包含倒數時間"), "語速說明未排除開始與停止按鍵延遲");
  const radarPixels = await page.locator("#performanceRadar").evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) colored += 1;
    return colored;
  });
  assert(radarPixels > 1000, "四面向雷達圖沒有實際繪製");
  await page.screenshot({ path: `${outputDir}/student-assignment-desktop.png`, fullPage: true });

  await page.goto(`${baseUrl}portal.html?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector("#studentView").hidden && document.querySelector("#taskList")?.textContent.includes("1 / 5 句達標"));
  assert((await page.locator("#taskList").innerText()).includes("1 / 5 句達標"), "返回任務頁後達標狀態未保留");

  const selfRole = page.locator(".self-practice-item").filter({ hasText: "老夫人" });
  await selfRole.locator("a").click();
  await page.waitForFunction(() => document.querySelector(".qa-badge")?.textContent === "自主練習");
  assert((await page.locator(".assignment-context").innerText()).includes("老夫人自主練習"), "自主練習頁缺少角色資訊");
  assert(await page.locator(".script-line:visible").count() === 18, "自主練習沒有開放所選角色的全部台詞");
  await page.locator("#startRecording").click();
  await page.waitForFunction(() => document.body.classList.contains("is-recording"));
  await page.waitForTimeout(650);
  await page.locator("#stopRecording").click();
  await page.waitForFunction(() => !document.querySelector("#recordingPlayback").hidden);
  await page.locator("#recognizedText").fill(await page.locator("#selectedJapanese").innerText());
  await page.locator("#evaluateRecording").click();
  await page.waitForFunction(() => document.querySelector("#cloudSyncStatus")?.classList.contains("is-saved"));
  assert((await page.locator("#cloudSyncStatus").innerText()).includes("自主練習已保存"), "自主練習沒有保存");

  await page.goto(`${baseUrl}portal.html?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector("#studentView").hidden && document.querySelector("#selfPracticeList")?.textContent.includes("1 / 18 句已練"));
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
  assert(await page.locator("#groupRows .teacher-member-list").count() >= 2, "老師端未顯示各組成員排名");
  assert(await page.locator("#groupRows .member-rank-score").count() >= 4, "老師端成員排名未顯示精確完成度");
  await page.screenshot({ path: `${outputDir}/teacher-groups-desktop.png`, fullPage: true });
  await page.locator('.teacher-tab[data-tab="showcase"]').click();
  await page.waitForFunction(() => document.querySelectorAll("#teacherShowcaseList .showcase-card").length >= 2);
  assert(await page.locator("#teacherShowcaseList .showcase-card").count() >= 2, "老師端未顯示小組成果驗收");
  assert(await page.locator("#teacherShowcaseList .showcase-member-list").count() >= 2, "老師端應能查看各組成員完成度");
  await page.locator('.teacher-tab[data-tab="students"]').click();
  const parsedIdentityStudent = await page.evaluate(() => parseStudentImport("1\t416001\t測試姓名\t416\tA123456789")[0]);
  assert(parsedIdentityStudent.initialPin === "56789", "含身分證字號的匯入資料未取最後五碼作為初始 PIN");
  assert(!Object.hasOwn(parsedIdentityStudent, "identity"), "匯入資料不應保留完整身分證字號");
  const parsedBirthdayStudent = await page.evaluate(() => parseStudentImport("2\t416002\t測試姓名二\t416\t990101")[0]);
  assert(parsedBirthdayStudent.initialPin === "990101", "六碼民國生日未作為初始 PIN");
  let demoRow = page.locator("#studentRows tr").filter({ hasText: "測試學生" });
  await demoRow.locator(".group-name-input").fill("第 3 組");
  await demoRow.locator(".save-group-button").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("組別已更新"));
  demoRow = page.locator("#studentRows tr").filter({ hasText: "測試學生" });
  assert(await demoRow.locator(".group-name-input").inputValue() === "第 3 組", "老師設定的學生組別沒有保存");
  assert((await demoRow.innerText()).includes("琪琪、老夫人"), "老師名單未顯示學生的複數角色");
  await demoRow.locator(".history-button").click();
  await page.waitForFunction(() => document.querySelector("#historyDialog")?.open);
  assert((await page.locator("#historyTitle").innerText()).includes("測試學生"), "逐句歷程沒有顯示學生姓名");
  assert(Number(await page.locator("#historyAttempts").innerText()) >= 1, "逐句歷程沒有累計練習次數");
  const historyTarget = await page.locator("#historyLineRows [lang=ja]").first().innerText();
  assert(historyTarget !== "—" && historyTarget.length > 5, "逐句歷程沒有保存練習台詞");
  await page.screenshot({ path: `${outputDir}/teacher-history-desktop.png`, fullPage: true });
  await page.locator("#historyClose").click();

  await page.locator('.teacher-tab[data-tab="assign"]').click();
  assert(await page.locator("#masteryGoalFields").isVisible(), "發派頁預設未顯示整體完成度模式");
  assert(await page.locator("#lineGoalFields").isHidden(), "整體完成度模式不應同時顯示逐句欄位");
  await page.locator("#targetPercent").fill("80");
  await page.locator("#assignmentTitle").fill("今日熟練度 80%");
  await page.locator("#assignmentForm button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已發派"));
  await page.waitForFunction(() => document.querySelector("#assignmentRows")?.textContent.includes("今日熟練度 80%"));

  await page.locator('input[name="assignmentGoalMode"][value="line_score"]').check();
  await page.locator("#assignmentWork").selectOption("kiki");
  await page.waitForFunction(() => document.querySelectorAll("#assignmentRole option").length > 1);
  await page.locator("#assignmentRole").selectOption("琪琪");
  await page.locator("#assignmentCount").fill("3");
  await page.locator("#targetScore").fill("55");
  await page.locator("#assignmentTitle").fill("琪琪三句 55 分");
  await page.locator("#assignmentForm button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已發派"));
  await page.waitForFunction(() => document.querySelector("#assignmentRows")?.textContent.includes("琪琪三句 55 分"));
  await page.locator('.teacher-tab[data-tab="progress"]').click();
  assert((await page.locator("#assignmentRows").innerText()).includes("整體熟練度 80%"), "完成度要求未出現在進度表");
  assert((await page.locator("#assignmentRows").innerText()).includes("每句 55 分"), "逐句最低分數未出現在進度表");
  await page.screenshot({ path: `${outputDir}/teacher-dashboard-desktop.png`, fullPage: true });
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mobile.grantPermissions(["microphone"], { origin: new URL(baseUrl).origin });
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
  await mobilePage.waitForFunction(() => document.querySelectorAll("#preferenceRoles input[type=checkbox]").length > 1);
  await mobilePage.locator('#preferenceRoles input[value="琪琪"]').check();
  await mobilePage.locator('#preferenceRoles input[value="吉吉"]').check();
  await mobilePage.locator("#preferenceForm button[type=submit]").click();
  await mobilePage.waitForFunction(() => document.querySelectorAll(".task-item").length > 0);
  assert(await mobilePage.locator(".self-practice-item").count() === 2, "手機版未顯示複數角色自主練習");
  await mobilePage.locator("#changePreference").click();
  await mobilePage.waitForFunction(() => document.querySelector("#preferenceDialog")?.open);
  await mobilePage.locator("#preferenceWork").selectOption("ponyo");
  await mobilePage.waitForFunction(() => document.querySelectorAll("#preferenceRoles input[type=checkbox]").length > 1);
  const firstPonyoRole = mobilePage.locator("#preferenceRoles input[type=checkbox]").first();
  const firstPonyoRoleName = await firstPonyoRole.getAttribute("value");
  await firstPonyoRole.check();
  await mobilePage.locator("#preferenceForm button[type=submit]").click();
  await mobilePage.waitForFunction(() => document.querySelector("#studentPreferenceLabel")?.textContent.includes("崖上的波妞"));
  assert((await mobilePage.locator("#studentPreferenceLabel").innerText()).includes(firstPonyoRoleName), "學生變更作品與角色沒有保存");
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

  await mobilePage.goto(`${baseUrl}index.html?work=kiki`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForFunction(() => document.querySelectorAll(".script-line").length > 0);
  await mobilePage.locator("#startRecording").click();
  await mobilePage.waitForFunction(() => document.body.classList.contains("is-recording"));
  assert(await mobilePage.locator("#karaokeOverlay").isVisible(), "手機錄音頁未顯示卡啦 OK 字幕");
  await mobilePage.waitForTimeout(700);
  assert(await mobilePage.locator(".karaoke-character.is-sung").count() > 0, "手機版字幕沒有隨影片時間變色");
  const karaokeFitsVideo = await mobilePage.locator("#karaokeOverlay").evaluate((overlay) => {
    const shell = overlay.parentElement.getBoundingClientRect();
    const bounds = overlay.getBoundingClientRect();
    return bounds.left >= shell.left - 1 && bounds.right <= shell.right + 1 && bounds.top >= shell.top - 1 && bounds.bottom <= shell.bottom + 1;
  });
  assert(karaokeFitsVideo, "手機卡啦 OK 字幕超出影片範圍");
  await mobilePage.screenshot({ path: `${outputDir}/karaoke-recording-mobile.png`, fullPage: true });
  await mobilePage.locator("#stopRecording").click();
  await mobilePage.waitForFunction(() => !document.querySelector("#recordingReview").hidden);
  const karaokeOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!karaokeOverflow, "手機卡啦 OK 錄音頁出現水平溢位");

  await mobilePage.goto(`${baseUrl}index.html?work=kiki#line-9001`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForFunction(() => document.body.classList.contains("sound-effect-mode"));
  assert((await mobilePage.locator("#selectedRole").innerText()).startsWith("音效＿"), "音效時間軸未轉成正式角色名稱");
  assert(await mobilePage.locator(".transcription-field").isHidden(), "音效錄製不應要求逐字辨識");
  await mobilePage.locator("#startRecording").click();
  await mobilePage.waitForFunction(() => document.body.classList.contains("is-recording"));
  await mobilePage.waitForTimeout(700);
  await mobilePage.locator("#stopRecording").click();
  await mobilePage.waitForFunction(() => !document.querySelector("#recordingReview").hidden);
  await mobilePage.locator("#evaluateRecording").click();
  await mobilePage.waitForFunction(() => document.querySelector("#resultMode")?.textContent.includes("音效時間軸"));
  assert((await mobilePage.locator("#scoreRows").innerText()).includes("時間軸配合"), "音效評分缺少時間軸配合指標");
  await mobilePage.screenshot({ path: `${outputDir}/sound-effect-recording-mobile.png`, fullPage: true });
  await mobile.close();

  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("Platform passed group showcase privacy and playback, sound-effect roles, karaoke recording, delay-free scoring, assignments, history, desktop, and mobile checks.\n");
} finally {
  await browser.close();
}
