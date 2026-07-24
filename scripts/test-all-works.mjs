import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const moduleRoot = process.env.WORKSPACE_NODE_MODULES;
const require = createRequire(moduleRoot ? `${moduleRoot}/package.json` : import.meta.url);
const { chromium } = require("playwright");

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4273/";
const outputDir = resolve(import.meta.dirname, "../test-results/all-works");
const works = [
  { slug: "kiki", title: "魔女宅急便", lines: 59, roles: 6, soundEffects: 11, soundEvents: 72 },
  { slug: "ponyo", title: "崖上的波妞", lines: 77, roles: 8, soundEffects: 10, soundEvents: 60 },
  { slug: "maruko", title: "櫻桃小丸子：來自義大利的少年", lines: 88, roles: 22, soundEffects: 9, soundEvents: 49 },
  { slug: "spirited-away", title: "神隱少女", lines: 70, roles: 8, soundEffects: 11, soundEvents: 62 },
  { slug: "totoro", title: "龍貓", lines: 54, roles: 5, soundEffects: 10, soundEvents: 51 },
];
const errors = [];

await mkdir(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cueSeconds(value) {
  return String(value || "").split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function cueRange(value) {
  return String(value || "").split("–").map(cueSeconds);
}

const appsScriptSource = await readFile(resolve(import.meta.dirname, "../apps-script/Code.gs"), "utf8");
const soundCatalogStart = appsScriptSource.indexOf("const SOUND_EFFECT_WORKS");
const soundCatalogEnd = appsScriptSource.indexOf("\n\nfunction onOpen", soundCatalogStart);
assert(soundCatalogStart >= 0 && soundCatalogEnd > soundCatalogStart, "Apps Script 缺少音效角色清單");
const soundCatalogContext = {};
runInNewContext(`${appsScriptSource.slice(soundCatalogStart, soundCatalogEnd)}\nthis.soundWorks = SOUND_EFFECT_WORKS;`, soundCatalogContext);
const backendSoundWorks = soundCatalogContext.soundWorks;
const pronunciationContext = {};
const specialRoleFixtures = [
  {
    studentId: "900001",
    workSlug: "totoro",
    workTitle: "龍貓",
    sourceRole: "おばあちゃん",
    role: "おばあちゃん（A 專用）",
    lineIndices: [1, 3, 7, 8, 16, 17, 18, 24, 25, 26, 32, 34, 40, 46, 48],
  },
  {
    studentId: "900002",
    workSlug: "totoro",
    workTitle: "龍貓",
    sourceRole: "おばあちゃん",
    role: "おばあちゃん（B 專用）",
    lineIndices: [9, 11, 21, 22, 33, 52],
  },
];
runInNewContext(
  `${appsScriptSource}
this.pronunciationApi = { score: bestPronunciationAccuracy_ };
const specialRoleFixtures = ${JSON.stringify(specialRoleFixtures)};
this.specialRoleApi = {
  assignments: normalizeSpecialRoleAssignments_(specialRoleFixtures),
  catalogRows: specialRoleCatalogRows_(specialRoleFixtures),
};`,
  pronunciationContext,
);
const totoroData = JSON.parse(await readFile(resolve(import.meta.dirname, "../data/totoro.json"), "utf8"));
const specialAssignments = pronunciationContext.specialRoleApi.assignments;
const specialCatalogRows = pronunciationContext.specialRoleApi.catalogRows;
const firstSplitLines = [...specialAssignments[0].lineIndices];
const secondSplitLines = [...specialAssignments[1].lineIndices];
const publicGrandmaLines = totoroData.lines
  .filter((line) => line.role === "おばあちゃん")
  .map((line) => line.index);
const splitGrandmaLines = [...new Set([...firstSplitLines, ...secondSplitLines])].sort((left, right) => left - right);
assert(JSON.stringify(firstSplitLines) === JSON.stringify([1, 3, 7, 8, 16, 17, 18, 24, 25, 26, 32, 34, 40, 46, 48]), "龍貓婆婆第一組逐句分配錯誤");
assert(JSON.stringify(secondSplitLines) === JSON.stringify([9, 11, 21, 22, 33, 52]), "龍貓婆婆第二組螢光標記句分配錯誤");
assert(firstSplitLines.every((line) => !secondSplitLines.includes(line)), "龍貓婆婆兩組逐句分配重疊");
assert(JSON.stringify(splitGrandmaLines) === JSON.stringify(publicGrandmaLines), "龍貓婆婆拆分後沒有完整涵蓋 21 句");
assert([25, 26].every((line) => firstSplitLines.includes(line) && !secondSplitLines.includes(line)), "照片中打叉的兩句仍在螢光標記組");
assert(specialCatalogRows.every((row) => row.is_special_assignment
  && row.total_lines === String(row.line_indices).split(",").length), "隱藏專用角色的完成度分母錯誤");
assert(specialAssignments.every((assignment) => (
  !totoroData.roles.some((role) => role.role === assignment.role)
)), "隱藏專用角色不應出現在公開角色選單");

function readingFromHtml(line) {
  return String(line.japaneseHtml || line.japanese || "")
    .replace(/<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g, "$2")
    .replace(/<[^>]+>/g, "");
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
    ({ title, totalLines }) => document.getElementById("pageTitle")?.textContent === title
      && document.querySelectorAll(".script-line").length === totalLines,
    { title: work.title, totalLines: work.lines + work.soundEffects },
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
    await page.goto(`${baseUrl}?public=1&work=${work.slug}#line-1`, { waitUntil: "domcontentloaded" });
    await waitForWork(page, work);

    const data = await page.evaluate(async (slug) => (await (await fetch(`data/${slug}.json`)).json()), work.slug);
    const backendSoundWork = backendSoundWorks.find((item) => item.workSlug === work.slug);
    const frontendSoundRoles = data.soundCues.map((cue) => `音效＿${cue.sound}＿${cue.time}`);
    const backendSoundRoles = (backendSoundWork?.cues || []).map((cue) => `音效＿${cue[1]}＿${cue[0]}`);
    assert(JSON.stringify(frontendSoundRoles) === JSON.stringify(backendSoundRoles), `${work.title} 前後端音效角清單不同步`);
    assert(data.lines.length === work.lines, `${work.title} 的資料行數錯誤`);
    assert(data.soundCues.length === work.soundEffects, `${work.title} 的音效場景數量錯誤`);
    const pronunciationAudit = await page.evaluate(() => state.data.lines
      .filter((line) => !line.isSoundEffect)
      .map((line) => {
        const reading = japaneseReadingForLine(line);
        const longVowelVariant = reading
          .replace(/おお|おう/g, "お")
          .replace(/ええ|えい/g, "え")
          .replace(/([あいうえお])\1/g, "$1")
          .replace(/ー/g, "");
        const choonVariant = reading
          .replace(/おお|おう/g, "おー")
          .replace(/ええ|えい/g, "えー");
        const hiraganaVariant = reading.replace(
          /[\u30A1-\u30F6]/g,
          (character) => String.fromCharCode(character.charCodeAt(0) - 0x60),
        );
        const particleVariant = reading.replace(/は/g, "わ").replace(/へ/g, "え").replace(/を/g, "お");
        const voicedVariant = reading.replace(/ぢ/g, "じ").replace(/づ/g, "ず").replace(/ゔ/g, "ぶ");
        const variants = [line.japanese, reading, longVowelVariant, choonVariant, hiraganaVariant, particleVariant, voicedVariant];
        return {
          index: line.index,
          reading,
          scores: variants.map((variant) => compareJapaneseTranscript(line, variant).accuracy),
        };
      }));
    assert(pronunciationAudit.length === work.lines, `${work.title} 的全台詞讀音稽核數量錯誤`);
    const failedPronunciations = pronunciationAudit.filter((line) => line.scores.some((score) => score !== 100));
    assert(!failedPronunciations.length, `${work.title} 有讀音表記未被等價辨識：${JSON.stringify(failedPronunciations.slice(0, 3))}`);
    assert(pronunciationAudit.every((line) => !/[一-龯々0-9]/u.test(line.reading)), `${work.title} 的完整讀音仍殘留漢字或數字`);
    const backendPronunciationFailures = data.lines.filter((line) => {
      const reading = readingFromHtml(line);
      const variants = [
        line.japanese,
        reading,
        reading.replace(/おお|おう/g, "おー").replace(/ええ|えい/g, "えー"),
        reading.replace(/おお|おう/g, "お").replace(/ええ|えい/g, "え").replace(/ー/g, ""),
      ];
      return variants.some((variant) => pronunciationContext.pronunciationApi.score(line.japanese, variant, reading) !== 100);
    });
    assert(!backendPronunciationFailures.length, `${work.title} 的歷史分數校正規則未通過全台詞讀音測試`);
    assert(data.soundCues.every((cue) => Array.isArray(cue.onomatopoeia) && cue.onomatopoeia.length > 0), `${work.title} 有音效缺少日文擬聲語`);
    assert(data.soundCues.flatMap((cue) => cue.onomatopoeia).every((word) => /[ぁ-ヿ]/.test(word)), `${work.title} 的音效提示不是日文擬聲語`);
    assert(data.soundCues.every((cue) => Array.isArray(cue.events) && cue.events.length > 0), `${work.title} 仍有音效使用平均切段而非逐事件時間`);
    assert(data.soundCues.flatMap((cue) => cue.events).length === work.soundEvents, `${work.title} 的逐事件音效盤點數量錯誤`);
    let previousCueEnd = 0;
    for (const cue of data.soundCues) {
      const [cueStart, cueEnd] = cueRange(cue.time);
      assert(Number.isFinite(cueStart) && Number.isFinite(cueEnd) && cueEnd > cueStart, `${work.title} 的音效場景時間格式錯誤：${cue.time}`);
      assert(cueStart >= previousCueEnd - 0.001, `${work.title} 的音效場景互相重疊：${cue.time}`);
      assert(cueEnd <= data.duration + 0.001, `${work.title} 的音效場景超出影片：${cue.time}`);
      previousCueEnd = cueEnd;
      assert(JSON.stringify(cue.onomatopoeia) === JSON.stringify(cue.events.map((event) => event.word)), `${work.title} 的擬聲語與逐事件清單不同步：${cue.sound}`);
      let previousEventStart = cueStart;
      for (const event of cue.events) {
        const [eventStart, eventEnd] = cueRange(event.time);
        const [previewStart, previewEnd] = cueRange(event.preview);
        assert(event.word && /[ぁ-ヿ]/.test(event.word) && event.sound, `${work.title} 有逐事件音效缺少擬聲語或名稱：${cue.sound}`);
        assert(eventStart >= previousEventStart - 0.001, `${work.title} 的逐事件音效順序錯誤：${event.sound}`);
        assert(eventStart >= cueStart - 0.001 && eventEnd <= cueEnd + 0.001 && eventEnd > eventStart, `${work.title} 的逐事件音效超出場景：${event.sound}`);
        assert(previewStart >= cueStart - 0.001 && previewEnd <= cueEnd + 0.001 && previewEnd > previewStart, `${work.title} 的示範片段超出場景：${event.sound}`);
        previousEventStart = eventStart;
      }
    }
    if (work.slug === "kiki") {
      const longVowelLine = await page.evaluate(() => state.data.lines.find((line) => line.japanese.includes("大仕事")));
      const longVowelScores = await page.evaluate((lineIndex) => {
        const line = state.data.lines.find((candidate) => candidate.index === lineIndex);
        const variants = [
          "そうはいっても大仕事よ",
          "そうはいってもおおしごとよ",
          "そうはいってもおうしごとよ",
          "そうはいってもおーしごとよ",
          "そうはいってもおしごとよ",
        ];
        return {
          scores: variants.map((variant) => compareJapaneseTranscript(line, variant).accuracy),
          chosen: closestRecognitionText(
            ["そうはいっても大きい仕事よ", "そうはいっても大仕事よ"],
            "",
            line,
          ),
        };
      }, longVowelLine.index);
      assert(longVowelScores.scores.every((score) => score === 100), "大仕事的 おお／おう／おー 長音表記仍被錯判");
      assert(longVowelScores.chosen === "そうはいっても大仕事よ", "多候選辨識沒有選到最接近大仕事台詞的結果");
      const kikiEvents = data.soundCues.flatMap((cue) => cue.events);
      assert(!data.soundCues.some((cue) => /風箱|時鐘提醒|雷/.test(cue.sound)), "魔女宅急便仍保留原片中不存在的風箱、鐘響或雷聲");
      assert(["燈泡玻璃與燈罩輕碰", "杯子與杯碟清楚碰響", "孫女打開屋門", "在收據上簽名", "列車或電車長鳴笛"].every((sound) => kikiEvents.some((event) => event.sound === sound)), "魔女宅急便的關鍵漏音仍未補齊");
      const doorbell = kikiEvents.find((event) => event.sound === "門鈴響起");
      assert(doorbell?.word === "ピンポーン" && doorbell.time.startsWith("04:44.80"), "魔女宅急便門鈴沒有校正到原片 04:45.2 左右");
      const closingDoor = kikiEvents.find((event) => event.sound === "屋門在琪琪面前關上");
      assert(closingDoor?.word === "バタン" && closingDoor.time.startsWith("05:20.40"), "魔女宅急便關門沒有校正到原片 05:20.7 左右");
    }
    const demoCoverage = await page.evaluate(() => state.data.lines.filter((line) => line.isSoundEffect).every((line) => {
      const words = soundWordsForLine(line);
      const beats = buildSoundEffectBeats(line).filter((beat) => beat.target);
      return words.every((word) => beats.some((beat) => beat.word === word))
        && beats.every((beat) => beat.demoEnd > beat.demoStart && beat.demoStart >= line.start && beat.demoEnd <= line.end);
    }));
    assert(demoCoverage, `${work.title} 有擬聲語缺少對應的原片播放區間`);
    const renderedSoundCues = await page.evaluate(() => state.data.lines.filter((line) => line.isSoundEffect).map((line) => {
      const lineIndex = state.data.lines.indexOf(line);
      selectLine(lineIndex, false);
      renderKaraokeOverlay();
      const buttons = [...document.querySelectorAll(".sound-beat.is-target")];
      const row = document.querySelector(".sound-beat-row");
      const shell = document.querySelector(".video-shell")?.getBoundingClientRect();
      const caption = document.querySelector(".sound-effect-mode .karaoke-caption")?.getBoundingClientRect();
      const guide = document.querySelector(".sound-effect-mode .karaoke-guide")?.getBoundingClientRect();
      return {
        expected: line.soundEvents.length,
        rendered: buttons.length,
        words: buttons.map((button) => button.textContent),
        labelsComplete: buttons.every((button) => button.dataset.soundLabel
          && Number(button.dataset.demoEnd) > Number(button.dataset.demoStart)
          && button.getAttribute("aria-label")?.includes(button.textContent)),
        overflow: row ? row.scrollHeight > row.clientHeight + 1 : true,
        rowHeight: row?.getBoundingClientRect().height || 0,
        clearStageRatio: shell && caption && guide ? Math.max(0, guide.top - caption.bottom) / shell.height : 0,
      };
    }));
    assert(renderedSoundCues.every((cue) => cue.rendered === cue.expected), `${work.title} 有逐事件音效未顯示在卡啦 OK 節拍列`);
    assert(renderedSoundCues.every((cue) => cue.labelsComplete), `${work.title} 有音效示範按鈕缺少名稱或原片區間`);
    assert(renderedSoundCues.every((cue) => !cue.overflow && cue.rowHeight <= 27), `${work.title} 的音效提示未維持單列時間軸`);
    assert(renderedSoundCues.every((cue) => cue.clearStageRatio >= 0.42), `${work.title} 的音效提示遮住太多影片畫面`);
    await page.evaluate(() => {
      hideKaraokeOverlay();
      selectLine(0, false);
    });
    assert(await page.locator(".work-switcher__link").count() === 5, "作品切換列應顯示五部");
    assert(await page.locator(".work-switcher__link.is-active").count() === 1, `${work.title} 沒有唯一選取狀態`);
    assert((await page.locator("#workMeta").textContent()).includes(`${work.roles + work.soundEffects} 角`), `${work.title} 的角色資訊錯誤`);
    assert(await page.locator("#roleFilter option").count() === work.roles + work.soundEffects + 1, `${work.title} 的角色選單錯誤`);
    assert(await page.locator('#roleFilter option[value^="音效＿"]').count() === work.soundEffects, `${work.title} 的音效角色數量錯誤`);
    const soundRoleNames = await page.locator('#roleFilter option[value^="音效＿"]').allTextContents();
    assert(soundRoleNames.every((name) => /^音效＿.+＿\d{2}:\d{2}/.test(name)), `${work.title} 的音效角色未包含名稱與時間軸`);
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
    assert(await page.locator(".score-row").count() === 5, `${work.title} 的評分明細錯誤`);
    const radarPixels = await page.locator("#performanceRadar").evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) colored += 1;
      return colored;
    });
    assert(radarPixels > 1000, `${work.title} 的雷達圖沒有繪製`);
    assert(Number(await page.locator("#overallScore").textContent()) >= 55, `${work.title} 的測試分數異常`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert(!overflow, `${work.title} 桌機版出現水平溢位`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${outputDir}/${work.slug}-desktop.png`, fullPage: false });
    if (work.slug === "kiki") {
      await page.evaluate(() => {
        const index = state.data.lines.findIndex((line) => line.isSoundEffect && line.soundEvents.length === 12);
        selectLine(index, false);
        renderKaraokeOverlay();
      });
      await page.screenshot({ path: `${outputDir}/kiki-sound-cue-desktop.png`, fullPage: false });
    }
    await page.close();
  }
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  for (const work of works) {
    const page = await mobile.newPage();
    monitor(page, `${work.slug} mobile`);
    await page.goto(`${baseUrl}?public=1&work=${work.slug}#line-1`, { waitUntil: "domcontentloaded" });
    await waitForWork(page, work);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert(!overflow, `${work.title} 手機版出現水平溢位`);
    assert(await page.locator(".work-switcher__link.is-active").isVisible(), `${work.title} 手機版未顯示選取作品`);
    await page.screenshot({ path: `${outputDir}/${work.slug}-mobile.png`, fullPage: false });
    await page.close();
  }
  await mobile.close();

  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("All five QA works passed sound-effect roles, data, video, filtering, recording, scoring, URL-state, desktop, and mobile checks.\n");
} finally {
  await browser.close();
}
