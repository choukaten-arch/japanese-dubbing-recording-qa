const bridgeConfig = window.PLATFORM_CONFIG || {};
const bridgeParams = new URLSearchParams(location.search);
const bridgeAssignmentId = bridgeParams.get("assignment");
const bridgePracticeMode = bridgeParams.get("practice") === "1";
const bridgePracticeRole = bridgeParams.get("role") || "";

const bridgeState = {
  stored: readBridgeSession(),
  task: null,
  data: null,
  syncing: false,
  lastAttempt: null,
  pendingDecision: null,
  comparisonUrls: [],
  comparisonRequest: 0,
};

function readBridgeSession() {
  try {
    const value = JSON.parse(localStorage.getItem(bridgeConfig.sessionKey));
    if (!value?.session?.token || Number(value.session.expiresAt) <= Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

function readBridgeTask() {
  try { return JSON.parse(localStorage.getItem(bridgeConfig.taskKey)); } catch { return null; }
}

function escapeBridgeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isBridgeDemo() {
  return bridgeParams.get("demo") === "1" || String(bridgeState.stored?.session?.token || "").startsWith("demo-");
}

async function bridgeRequest(action, payload = {}) {
  if (isBridgeDemo()) return bridgeMockRequest(action, payload);
  if (!bridgeConfig.apiUrl) throw new Error("雲端後端尚未連結。");
  const response = await fetch(bridgeConfig.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    redirect: "follow",
    body: JSON.stringify({ action, userAgent: navigator.userAgent, ...payload }),
  });
  const data = await response.json();
  if (!data.ok) {
    const error = new Error(data.error?.message || "雲端儲存失敗。");
    error.code = data.error?.code;
    throw error;
  }
  return data;
}

function bridgeDemoStore() {
  const key = "dubbingPlatformDemoDataV1";
  const value = JSON.parse(localStorage.getItem(key) || "null") || { assignments: [], lineResults: {}, selfResults: {}, recentResults: [] };
  value.lineResults ||= {};
  value.selfResults ||= {};
  value.recentResults ||= [];
  return { value, save() { localStorage.setItem(key, JSON.stringify(value)); } };
}

function bridgeDemoTasks() {
  const store = bridgeDemoStore();
  return store.value.assignments
    .filter((assignment) => assignment.status === "Active" && assignment.goalMode !== "mastery_target")
    .map((assignment) => {
    const lineResults = store.value.lineResults[assignment.assignmentId] || {};
    Object.values(lineResults).forEach((result) => {
      result.achieved = assignment.targetScore == null || Number(result.score) >= Number(assignment.targetScore);
    });
    const completed = Object.values(lineResults).filter((result) => result.achieved).length;
    return { ...assignment, lineResults, completed, completionRate: Math.round((completed / assignment.lineIndices.length) * 100) };
    });
}

function bridgeDemoSelfKey(workSlug, role) {
  return `${workSlug}|${role}`;
}

function bridgeDemoToneBase64() {
  const sampleRate = 8000;
  const sampleCount = 6400;
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  writeText(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = Math.min(1, index / 100, (sampleCount - index) / 100);
    view.setInt16(44 + index * 2, Math.sin(index / sampleRate * Math.PI * 2 * 330) * 3600 * fade, true);
  }
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function bridgeDemoResultByKey(store, resultKey) {
  const maps = [
    ...Object.values(store.value.lineResults || {}),
    ...Object.values(store.value.selfResults || {}),
  ];
  for (const resultMap of maps) {
    const result = Object.values(resultMap || {}).find((item) => item.resultKey === resultKey);
    if (result) return result;
  }
  return null;
}

function bridgeDemoSelfPractice() {
  const store = bridgeDemoStore();
  const profile = store.value.profile;
  if (!profile || profile.workSlug !== bridgeState.data?.slug) return [];
  const roles = Array.isArray(profile.roles) && profile.roles.length ? profile.roles : [profile.role].filter(Boolean);
  return roles.map((role) => {
    const lineIndices = bridgeState.data.lines.filter((line) => line.role === role).map((line) => line.index);
    const lineResults = { ...(store.value.selfResults[bridgeDemoSelfKey(profile.workSlug, role)] || {}) };
    store.value.assignments.filter((assignment) => assignment.workSlug === profile.workSlug && assignment.role === role)
      .forEach((assignment) => Object.assign(lineResults, store.value.lineResults[assignment.assignmentId] || {}));
    const values = Object.values(lineResults);
    const totalScore = values.reduce((sum, result) => sum + (Number(result.score) || 0), 0);
    return {
      assignmentId: `SELF-${profile.workSlug}-${role}`,
      title: `${role}自主練習`,
      goalMode: "self_practice",
      selfPractice: true,
      workSlug: profile.workSlug,
      workTitle: profile.workTitle,
      role,
      lineIndices,
      requiredCount: lineIndices.length,
      lineResults,
      completed: values.length,
      completionRate: lineIndices.length ? Math.round((values.length / lineIndices.length) * 100) : 0,
      masteryPercent: lineIndices.length ? Math.round((totalScore / lineIndices.length) * 10) / 10 : 0,
    };
  });
}

function bridgeMockRequest(action, payload) {
  if (action === "studentTasks") return Promise.resolve({ tasks: bridgeDemoTasks(), selfPractice: bridgeDemoSelfPractice() });
  if (action === "aiTranscribe") {
    return Promise.resolve({
      ok: true,
      configured: true,
      transcript: payload.targetText || payload.targetReading || "",
      model: "demo-ai-transcribe",
    });
  }
  if (action === "studentReviewClip") {
    if (payload.studentId !== "demo") return Promise.reject(new Error("只能查看自己的完成片段。"));
    const store = bridgeDemoStore();
    const result = bridgeDemoResultByKey(store, payload.resultKey);
    return Promise.resolve({
      ok: true,
      resultKey: payload.resultKey,
      mimeType: result?.mimeType || "audio/wav",
      audioBase64: result?.audioBase64 || bridgeDemoToneBase64(),
    });
  }
  if (!["submitAttempt", "submitPracticeAttempt"].includes(action)) return Promise.reject(new Error("示範模式不支援此操作。"));
  const store = bridgeDemoStore();
  const selfPractice = action === "submitPracticeAttempt";
  const assignment = selfPractice
    ? { assignmentId: `SELF-${payload.workSlug}-${payload.role}`, workSlug: payload.workSlug, workTitle: bridgeState.data.title, role: payload.role, targetScore: null }
    : store.value.assignments.find((item) => item.assignmentId === payload.assignmentId);
  if (!assignment) return Promise.reject(new Error("找不到示範作業。"));
  const resultMap = selfPractice
    ? (store.value.selfResults[bridgeDemoSelfKey(payload.workSlug, payload.role)] ||= {})
    : (store.value.lineResults[payload.assignmentId] ||= {});
  const existing = resultMap[payload.lineIndex];
  const adopted = !existing || payload.replaceCurrent !== false;
  const resultKey = `${assignment.assignmentId}|demo|${payload.lineIndex}`;
  const candidate = {
    resultKey,
    score: payload.overallScore,
    attempts: existing ? existing.attempts + 1 : 1,
    updatedAt: new Date().toISOString(),
    achieved: selfPractice || assignment.targetScore == null || Number(payload.overallScore) >= Number(assignment.targetScore),
    aspects: {
      accent: payload.scores?.accent || 0,
      intonation: payload.scores?.intonation || 0,
      speed: payload.scores?.speed || 0,
      volume: payload.scores?.volume || 0,
    },
    textAccuracy: payload.scores?.textAccuracy || 0,
    mimeType: payload.mimeType || "audio/webm",
    audioBase64: payload.audioBase64 || "",
  };
  resultMap[payload.lineIndex] = adopted
    ? candidate
    : { ...existing, attempts: candidate.attempts };
  store.value.recentResults.unshift({
    assignmentId: assignment.assignmentId,
    studentId: "demo",
    studentName: "測試學生",
    className: "416",
    workTitle: assignment.workTitle,
    workSlug: assignment.workSlug,
    role: assignment.role,
    lineIndex: payload.lineIndex,
    targetText: payload.targetText,
    score: payload.overallScore,
    attempts: candidate.attempts,
    durationSec: payload.recordingDuration,
    aspects: candidate.aspects,
    audioUrl: "",
    updatedAt: candidate.updatedAt,
    selectedAsCurrent: adopted,
  });
  store.save();
  const task = selfPractice
    ? bridgeDemoSelfPractice().find((item) => item.role === payload.role)
    : bridgeDemoTasks().find((item) => item.assignmentId === payload.assignmentId);
  return Promise.resolve({ saved: true, adopted, task });
}

async function resolveBridgeTask() {
  const cached = readBridgeTask();
  if (bridgePracticeMode && cached?.selfPractice && cached.role === bridgePracticeRole) return cached;
  if (!bridgePracticeMode && cached?.assignmentId === bridgeAssignmentId) return cached;
  const response = await bridgeRequest("studentTasks", { token: bridgeState.stored.session.token });
  const task = bridgePracticeMode
    ? (response.selfPractice || []).find((item) => item.role === bridgePracticeRole)
    : (response.tasks || []).find((item) => item.assignmentId === bridgeAssignmentId);
  if (task) localStorage.setItem(bridgeConfig.taskKey, JSON.stringify(task));
  return task || null;
}

function insertAssignmentBar() {
  if (document.querySelector(".assignment-context")) return;
  const bar = document.createElement("section");
  bar.className = "assignment-context";
  const practice = bridgeState.task.selfPractice;
  bar.innerHTML = `
    <div class="assignment-context__identity"><a href="portal.html${isBridgeDemo() ? "?demo=1" : ""}">返回練習首頁</a><span>${escapeBridgeHtml(bridgeState.stored.account.name)}</span></div>
    <div class="assignment-context__task"><span>${escapeBridgeHtml(bridgeState.task.workTitle)} · ${escapeBridgeHtml(bridgeState.task.role)}</span><strong>${escapeBridgeHtml(bridgeState.task.title)}</strong></div>
    <div class="assignment-context__progress"><strong id="bridgeProgressValue">0 / 0</strong><span id="bridgeProgressText">${practice ? "已練句數" : "達標句數"}</span></div>`;
  document.querySelector(".work-heading")?.before(bar);
  document.body.classList.add("platform-assignment-mode");
  const badge = document.querySelector(".qa-badge");
  if (badge) badge.textContent = practice ? "自主練習" : "每日要求";
  const privacy = document.querySelector(".privacy-note");
  if (privacy) privacy.textContent = "評分時使用 AI 辨識；完成後可比較並選擇採用版本";
  const scriptHeading = document.getElementById("scriptHeading");
  if (scriptHeading) scriptHeading.textContent = practice ? `${bridgeState.task.role}的台詞` : "本次指定台詞";
}

function bridgeLineAchieved(lineIndex) {
  const result = bridgeState.task.lineResults?.[lineIndex];
  if (!result) return false;
  if (result.requiresRerecord) return false;
  if (bridgeState.task.selfPractice) return true;
  if (result.achieved !== undefined) return Boolean(result.achieved);
  return bridgeState.task.targetScore == null || Number(result.score) >= Number(bridgeState.task.targetScore);
}

function lineListIndex(lineNumber) {
  return bridgeState.data.lines.findIndex((line) => Number(line.index) === Number(lineNumber));
}

function applyBridgeScope() {
  const allowed = bridgeState.task.lineIndices.map(lineListIndex).filter((index) => index >= 0);
  state.visibleIndexes = allowed;
  document.querySelectorAll(".script-line").forEach((button) => {
    const line = bridgeState.data.lines[Number(button.dataset.index)];
    const visible = bridgeState.task.lineIndices.includes(Number(line?.index));
    button.hidden = !visible;
    if (visible) updateBridgeLineButton(button, line.index);
  });
  if (elements.roleFilter) elements.roleFilter.value = bridgeState.task.role;
  if (elements.visibleCount) elements.visibleCount.textContent = `${allowed.length} 句指定台詞`;
  renderBridgeProgress();

  const hashLine = Number(location.hash.match(/^#line-(\d+)$/)?.[1]);
  const firstIncomplete = bridgeState.task.lineIndices.find((index) => bridgeState.task.lineResults?.[index]?.requiresRerecord)
    || bridgeState.task.lineIndices.find((index) => !bridgeLineAchieved(index));
  const selected = bridgeState.task.lineIndices.includes(hashLine) ? hashLine : firstIncomplete || bridgeState.task.lineIndices[0];
  const index = lineListIndex(selected);
  if (index >= 0) selectLine(index, true);
}

function updateBridgeLineButton(button, lineIndex) {
  const result = bridgeState.task.lineResults?.[lineIndex];
  const achieved = bridgeLineAchieved(lineIndex);
  button.classList.toggle("is-completed", achieved);
  button.classList.toggle("has-attempt", Boolean(result) && !achieved);
  button.classList.toggle("requires-rerecord", Boolean(result?.requiresRerecord));
  let score = button.querySelector(".completed-score");
  if (!result) {
    score?.remove();
    return;
  }
  if (!score) {
    score = document.createElement("span");
    score.className = "completed-score";
    button.querySelector(".script-line__content")?.append(score);
  }
  score.textContent = result.requiresRerecord
    ? `需重新錄音｜${result.syncReason || "時間軸未通過"}`
    : achieved || bridgeState.task.selfPractice
    ? `已保存 ${Math.round(result.score)} 分`
    : `${Math.round(result.score)} 分｜目標 ${bridgeState.task.targetScore} 分`;
}

function renderBridgeProgress() {
  const completed = bridgeState.task.lineIndices.filter((index) => bridgeLineAchieved(index)).length;
  const total = bridgeState.task.lineIndices.length;
  const value = document.getElementById("bridgeProgressValue");
  const text = document.getElementById("bridgeProgressText");
  if (value) value.textContent = `${completed} / ${total}`;
  if (text) text.textContent = completed >= total
    ? (bridgeState.task.selfPractice ? "角色台詞皆已練過" : "本次要求已達成")
    : (bridgeState.task.selfPractice ? "已練句數" : "達標句數");
}

function ensureSyncPanel() {
  let panel = document.getElementById("cloudSyncStatus");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.className = "cloud-sync-status";
  panel.id = "cloudSyncStatus";
  panel.setAttribute("role", "status");
  document.getElementById("resultPanel")?.append(panel);
  return panel;
}

function renderSyncStatus(kind, message, action) {
  const panel = ensureSyncPanel();
  panel.className = `cloud-sync-status is-${kind}`;
  panel.innerHTML = `<span>${escapeBridgeHtml(message)}</span>`;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.handler);
    panel.append(button);
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

if (bridgeParams.get("public") !== "1") {
  window.QA_AI_TRANSCRIBE = async ({ recordingBlob, line, workTitle }) => {
    if (!recordingBlob || line?.isSoundEffect) return null;
    if (!bridgeState.stored?.session?.token || bridgeState.stored?.account?.type !== "student") {
      const error = new Error("AI 精準辨識需要學生登入。");
      error.code = "AI_LOGIN_REQUIRED";
      throw error;
    }
    return bridgeRequest("aiTranscribe", {
      token: bridgeState.stored.session.token,
      workSlug: bridgeState.data?.slug || bridgeState.task?.workSlug || "",
      workTitle: workTitle || bridgeState.data?.title || bridgeState.task?.workTitle || "",
      role: line.role,
      lineIndex: line.index,
      targetText: line.japanese,
      targetReading: typeof japaneseReadingForLine === "function" ? japaneseReadingForLine(line) : line.japanese,
      mimeType: recordingBlob.type || "audio/webm",
      audioBase64: await blobToBase64(recordingBlob),
    });
  };
}

function bridgeAudioBlobFromBase64(base64, mimeType) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType || "audio/webm" });
}

function scoreSnapshotFromDetail(detail) {
  const result = detail.result || {};
  return {
    overall: Number(result.overall) || 0,
    textAccuracy: Number(result.scores?.["台詞正確度"] ?? result.scores?.textAccuracy) || 0,
    accent: Number(result.aspects?.accent ?? result.scores?.["重音"]) || 0,
    intonation: Number(result.aspects?.intonation ?? result.scores?.["語調"]) || 0,
    speed: Number(result.aspects?.speed ?? result.scores?.["語速"] ?? result.scores?.["節奏長度"]) || 0,
    volume: Number(result.aspects?.volume ?? result.scores?.["音量"] ?? result.scores?.["錄音品質"]) || 0,
  };
}

function scoreSnapshotFromCurrent(result) {
  return {
    overall: Number(result?.score) || 0,
    textAccuracy: Number.isFinite(Number(result?.textAccuracy)) ? Number(result.textAccuracy) : null,
    accent: Number(result?.aspects?.accent) || 0,
    intonation: Number(result?.aspects?.intonation) || 0,
    speed: Number(result?.aspects?.speed) || 0,
    volume: Number(result?.aspects?.volume) || 0,
  };
}

function scoreDifferenceMarkup(current, candidate) {
  if (!Number.isFinite(current) || !Number.isFinite(candidate)) return '<span class="score-change is-same">—</span>';
  const difference = Math.round(candidate - current);
  const className = difference > 0 ? "is-positive" : difference < 0 ? "is-negative" : "is-same";
  const label = difference > 0 ? `+${difference}` : String(difference);
  return `<span class="score-change ${className}">${label}</span>`;
}

function ensureAttemptComparison() {
  let panel = document.getElementById("recordingDecision");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.className = "recording-decision";
  panel.id = "recordingDecision";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "recordingDecisionTitle");
  document.getElementById("resultPanel")?.append(panel);
  return panel;
}

function clearAttemptComparison() {
  bridgeState.comparisonRequest += 1;
  bridgeState.comparisonUrls.forEach((url) => URL.revokeObjectURL(url));
  bridgeState.comparisonUrls = [];
  bridgeState.pendingDecision = null;
  const panel = document.getElementById("recordingDecision");
  if (panel) {
    panel.querySelectorAll("audio").forEach((audio) => audio.pause());
    panel.hidden = true;
    panel.replaceChildren();
  }
}

function resultKeyForAttempt(detail, currentResult) {
  if (currentResult?.resultKey) return currentResult.resultKey;
  return `${bridgeState.task.assignmentId}|${bridgeState.stored.account.studentId}|${detail.line.index}`;
}

async function showAttemptComparison(detail, currentResult) {
  if (bridgeState.syncing) return;
  clearAttemptComparison();
  const requestId = ++bridgeState.comparisonRequest;
  const currentScores = scoreSnapshotFromCurrent(currentResult);
  const candidateScores = scoreSnapshotFromDetail(detail);
  const blockedCandidate = Boolean(detail.result?.syncDiagnostic?.requiresRerecord);
  const syncReason = detail.result?.syncDiagnostic?.reason || "錄音與影片時間軸差異過大";
  bridgeState.pendingDecision = { detail, currentResult, requestId };
  const metrics = [
    ["總分", "overall"],
    ["台詞正確度", "textAccuracy"],
    ["重音", "accent"],
    ["語調", "intonation"],
    ["語速", "speed"],
    ["音量", "volume"],
  ];
  const panel = ensureAttemptComparison();
  panel.innerHTML = `
    <header class="recording-decision-heading">
      <span>錄音版本比較</span>
      <h3 id="recordingDecisionTitle">${blockedCandidate ? "這次錄音需要重錄" : "要更換目前採用的錄音嗎？"}</h3>
    </header>
    ${blockedCandidate ? `<div class="recording-sync-block"><strong>不能採用這次錄音</strong><span>${escapeBridgeHtml(syncReason)}。請保留目前版本並重新錄音。</span></div>` : ""}
    <div class="recording-version-audio">
      <section>
        <strong>目前採用</strong>
        <audio id="currentVersionAudio" controls preload="metadata" aria-label="播放目前採用的錄音"></audio>
        <span id="currentVersionAudioStatus">正在載入目前錄音</span>
      </section>
      <section>
        <strong>這次錄音</strong>
        <audio id="candidateVersionAudio" controls preload="metadata" aria-label="播放這次錄音"></audio>
        <span>剛完成的錄音</span>
      </section>
    </div>
    <div class="score-comparison-wrap">
      <table class="score-comparison-table">
        <thead><tr><th scope="col">項目</th><th scope="col">目前</th><th scope="col">這次</th><th scope="col">差異</th></tr></thead>
        <tbody>${metrics.map(([label, key]) => {
          const current = currentScores[key];
          const candidate = candidateScores[key];
          return `<tr><th scope="row">${label}</th><td>${Number.isFinite(current) ? Math.round(current) : "—"}</td><td>${Math.round(candidate)}</td><td>${scoreDifferenceMarkup(current, candidate)}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>
    <p class="recording-decision-note">${blockedCandidate ? "本次分數與練習時間仍可記入歷史，但錄音不會覆蓋目前版本。" : "不論是否更換，本次分數與練習時間都會記入歷史紀錄。"}</p>
    <div class="recording-decision-actions">
      <button class="recording-choice-button is-keep" id="keepCurrentRecording" type="button" disabled>保留目前錄音</button>
      <button class="recording-choice-button is-replace" id="replaceCurrentRecording" type="button" disabled>${blockedCandidate ? "時間軸未通過" : "使用這次錄音"}</button>
    </div>`;
  panel.hidden = false;
  const candidateUrl = URL.createObjectURL(detail.recordingBlob);
  bridgeState.comparisonUrls.push(candidateUrl);
  panel.querySelector("#candidateVersionAudio").src = candidateUrl;
  const keepButton = panel.querySelector("#keepCurrentRecording");
  const replaceButton = panel.querySelector("#replaceCurrentRecording");
  const choose = (replaceCurrent) => {
    const pending = bridgeState.pendingDecision;
    if (!pending || pending.requestId !== requestId) return;
    const attempt = pending.detail;
    clearAttemptComparison();
    submitBridgeAttempt(attempt, replaceCurrent);
  };
  keepButton.addEventListener("click", () => choose(false));
  replaceButton.addEventListener("click", () => choose(true));
  renderSyncStatus(
    blockedCandidate ? "error" : "compare",
    blockedCandidate ? `${syncReason}；請重新錄音` : "請先播放兩個版本、比較成績，再決定是否更換目前錄音",
  );

  try {
    const response = await bridgeRequest("studentReviewClip", {
      token: bridgeState.stored.session.token,
      studentId: bridgeState.stored.account.studentId,
      resultKey: resultKeyForAttempt(detail, currentResult),
    });
    if (bridgeState.pendingDecision?.requestId !== requestId) return;
    const currentUrl = URL.createObjectURL(bridgeAudioBlobFromBase64(response.audioBase64, response.mimeType));
    bridgeState.comparisonUrls.push(currentUrl);
    panel.querySelector("#currentVersionAudio").src = currentUrl;
    panel.querySelector("#currentVersionAudioStatus").textContent = "目前小組合成採用的錄音";
  } catch {
    if (bridgeState.pendingDecision?.requestId !== requestId) return;
    panel.querySelector("#currentVersionAudioStatus").textContent = "目前錄音暫時無法載入，仍可依成績決定";
  } finally {
    if (bridgeState.pendingDecision?.requestId !== requestId) return;
    keepButton.disabled = false;
    replaceButton.disabled = blockedCandidate;
    panel.querySelectorAll("audio").forEach((audio) => {
      audio.addEventListener("play", () => {
        panel.querySelectorAll("audio").forEach((other) => {
          if (other !== audio) other.pause();
        });
      });
    });
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function nextIncompleteLine() {
  return bridgeState.task.lineIndices.find((index) => !bridgeLineAchieved(index));
}

async function submitBridgeAttempt(detail, replaceCurrent = true) {
  if (bridgeState.syncing) return;
  if (replaceCurrent && detail.result?.syncDiagnostic?.requiresRerecord) {
    renderSyncStatus("error", `${detail.result.syncDiagnostic.reason || "錄音與影片時間軸差異過大"}；這次錄音不能採用，請重新錄音`, {
      label: "重新錄音",
      handler: () => resetRecording(),
    });
    return;
  }
  bridgeState.syncing = true;
  bridgeState.lastAttempt = { detail, replaceCurrent };
  renderSyncStatus(
    "saving",
    replaceCurrent ? "正在保存這次錄音為目前版本" : "正在保留目前錄音並記錄這次練習",
  );
  try {
    const audioBase64 = replaceCurrent ? await blobToBase64(detail.recordingBlob) : "";
    const result = detail.result;
    const response = await bridgeRequest(bridgeState.task.selfPractice ? "submitPracticeAttempt" : "submitAttempt", {
      token: bridgeState.stored.session.token,
      assignmentId: bridgeState.task.assignmentId,
      workSlug: bridgeState.task.workSlug,
      role: bridgeState.task.role,
      lineIndex: detail.line.index,
      targetText: detail.line.japanese,
      transcript: detail.transcript,
      overallScore: result.overall,
      scores: {
        textAccuracy: result.scores?.["台詞正確度"] ?? result.scores?.textAccuracy ?? 0,
        accent: result.aspects?.accent ?? result.scores?.["重音"] ?? 0,
        intonation: result.aspects?.intonation ?? result.scores?.["語調"] ?? 0,
        speed: result.aspects?.speed ?? result.scores?.["語速"] ?? result.scores?.["節奏長度"] ?? 0,
        volume: result.aspects?.volume ?? result.scores?.["音量"] ?? result.scores?.["錄音品質"] ?? 0,
      },
      recordingDuration: detail.recordingDuration,
      syncDiagnostic: detail.result?.syncDiagnostic || null,
      replaceCurrent,
      mimeType: replaceCurrent ? detail.recordingBlob.type || "audio/webm" : "",
      audioBase64,
    });
    if (response.task) bridgeState.task = response.task;
    else {
      const refreshed = await resolveBridgeTask();
      if (refreshed) bridgeState.task = refreshed;
    }
    localStorage.setItem(bridgeConfig.taskKey, JSON.stringify(bridgeState.task));
    const lineButton = document.querySelector(`.script-line[data-index="${lineListIndex(detail.line.index)}"]`);
    if (lineButton) updateBridgeLineButton(lineButton, detail.line.index);
    renderBridgeProgress();
    const next = nextIncompleteLine();
    const savedMessage = response.adopted === false
      ? "已保留原本錄音；本次分數已加入練習歷史"
      : (bridgeState.task.selfPractice ? "自主練習已保存" : "已保存；已使用這次錄音並更新老師後台");
    if (next) {
      renderSyncStatus("saved", savedMessage, {
        label: "前往下一句",
        handler: () => selectLine(lineListIndex(next), true),
      });
    } else {
      const completeMessage = response.adopted === false
        ? "已保留原本錄音；本次練習已記錄"
        : (bridgeState.task.selfPractice ? "這個角色的台詞皆已有練習紀錄" : "本次指定台詞已全部達標");
      renderSyncStatus("saved", completeMessage, {
        label: "返回練習首頁",
        handler: () => { location.href = `portal.html${isBridgeDemo() ? "?demo=1" : ""}`; },
      });
    }
  } catch (error) {
    if (["SESSION_INVALID", "SESSION_EXPIRED", "ACCOUNT_INACTIVE"].includes(error.code)) {
      localStorage.removeItem(bridgeConfig.sessionKey);
      location.replace("portal.html");
      return;
    }
    renderSyncStatus("error", error.message, {
      label: "重試保存",
      handler: () => submitBridgeAttempt(bridgeState.lastAttempt.detail, bridgeState.lastAttempt.replaceCurrent),
    });
  } finally {
    bridgeState.syncing = false;
  }
}

async function initializeAssignmentBridge(event) {
  bridgeState.data = event.detail.data;
  if (!bridgeState.stored) {
    location.replace("portal.html");
    return;
  }
  if (bridgeState.stored.account.type !== "student") {
    document.body.classList.add("platform-teacher-preview");
    return;
  }
  if ((!bridgeAssignmentId && !bridgePracticeMode) || (bridgePracticeMode && !bridgePracticeRole)) {
    location.replace(`portal.html${isBridgeDemo() ? "?demo=1" : ""}`);
    return;
  }
  try {
    bridgeState.task = await resolveBridgeTask();
    if (!bridgeState.task) throw new Error(bridgePracticeMode ? "找不到這個自主練習角色，請回首頁重新選擇。" : "找不到這份要求，可能已由老師關閉。");
    if (bridgeState.task.workSlug !== bridgeState.data.slug) {
      const demo = isBridgeDemo() ? "&demo=1" : "";
      const mode = bridgeState.task.selfPractice
        ? `practice=1&role=${encodeURIComponent(bridgeState.task.role)}`
        : `assignment=${encodeURIComponent(bridgeState.task.assignmentId)}`;
      location.replace(`index.html?work=${encodeURIComponent(bridgeState.task.workSlug)}&${mode}${demo}#line-${bridgeState.task.lineIndices[0]}`);
      return;
    }
    insertAssignmentBar();
    applyBridgeScope();
  } catch (error) {
    const fatal = document.getElementById("fatalState");
    if (fatal) {
      fatal.hidden = false;
      fatal.textContent = error.message;
    }
  }
}

if (bridgeParams.get("public") !== "1") {
  document.addEventListener("qa:ready", initializeAssignmentBridge);
  document.addEventListener("qa:evaluated", (event) => {
    if (!bridgeState.task || bridgeState.stored?.account?.type !== "student") return;
    const currentResult = bridgeState.task.lineResults?.[event.detail.line.index];
    if (currentResult) {
      showAttemptComparison(event.detail, currentResult);
    } else if (event.detail.result?.syncDiagnostic?.requiresRerecord) {
      renderSyncStatus("error", `${event.detail.result.syncDiagnostic.reason || "錄音與影片時間軸差異過大"}；請重新錄音後再保存`, {
        label: "重新錄音",
        handler: () => resetRecording(),
      });
    } else {
      submitBridgeAttempt(event.detail, true);
    }
  });
}
