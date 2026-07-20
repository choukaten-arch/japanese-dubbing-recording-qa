const bridgeConfig = window.PLATFORM_CONFIG || {};
const bridgeParams = new URLSearchParams(location.search);
const bridgeAssignmentId = bridgeParams.get("assignment");

const bridgeState = {
  stored: readBridgeSession(),
  task: null,
  data: null,
  syncing: false,
  lastAttempt: null,
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
  const value = JSON.parse(localStorage.getItem(key) || "null") || { assignments: [], lineResults: {}, recentResults: [] };
  return { value, save() { localStorage.setItem(key, JSON.stringify(value)); } };
}

function bridgeDemoTasks() {
  const store = bridgeDemoStore();
  return store.value.assignments.filter((assignment) => assignment.status === "Active").map((assignment) => {
    const lineResults = store.value.lineResults[assignment.assignmentId] || {};
    const completed = Object.keys(lineResults).length;
    return { ...assignment, lineResults, completed, completionRate: Math.round((completed / assignment.lineIndices.length) * 100) };
  });
}

function bridgeMockRequest(action, payload) {
  if (action === "studentTasks") return Promise.resolve({ tasks: bridgeDemoTasks() });
  if (action !== "submitAttempt") return Promise.reject(new Error("示範模式不支援此操作。"));
  const store = bridgeDemoStore();
  const assignment = store.value.assignments.find((item) => item.assignmentId === payload.assignmentId);
  if (!assignment) return Promise.reject(new Error("找不到示範作業。"));
  store.value.lineResults[payload.assignmentId] ||= {};
  const existing = store.value.lineResults[payload.assignmentId][payload.lineIndex];
  const result = {
    score: payload.overallScore,
    attempts: existing ? existing.attempts + 1 : 1,
    updatedAt: new Date().toISOString(),
  };
  store.value.lineResults[payload.assignmentId][payload.lineIndex] = result;
  store.value.recentResults.unshift({
    assignmentId: payload.assignmentId,
    studentId: "demo",
    studentName: "測試學生",
    className: "416",
    workTitle: assignment.workTitle,
    role: assignment.role,
    lineIndex: payload.lineIndex,
    targetText: payload.targetText,
    score: payload.overallScore,
    attempts: result.attempts,
    durationSec: payload.recordingDuration,
    audioUrl: "",
    updatedAt: result.updatedAt,
  });
  store.save();
  const task = bridgeDemoTasks().find((item) => item.assignmentId === payload.assignmentId);
  return Promise.resolve({ saved: true, task });
}

async function resolveBridgeTask() {
  const cached = readBridgeTask();
  if (cached?.assignmentId === bridgeAssignmentId) return cached;
  const response = await bridgeRequest("studentTasks", { token: bridgeState.stored.session.token });
  const task = (response.tasks || []).find((item) => item.assignmentId === bridgeAssignmentId);
  if (task) localStorage.setItem(bridgeConfig.taskKey, JSON.stringify(task));
  return task || null;
}

function insertAssignmentBar() {
  if (document.querySelector(".assignment-context")) return;
  const bar = document.createElement("section");
  bar.className = "assignment-context";
  bar.innerHTML = `
    <div class="assignment-context__identity"><a href="portal.html${isBridgeDemo() ? "?demo=1" : ""}">返回今日作業</a><span>${escapeBridgeHtml(bridgeState.stored.account.name)}</span></div>
    <div class="assignment-context__task"><span>${escapeBridgeHtml(bridgeState.task.workTitle)} · ${escapeBridgeHtml(bridgeState.task.role)}</span><strong>${escapeBridgeHtml(bridgeState.task.title)}</strong></div>
    <div class="assignment-context__progress"><strong id="bridgeProgressValue">0 / 0</strong><span id="bridgeProgressText">逐句完成</span></div>`;
  document.querySelector(".work-heading")?.before(bar);
  document.body.classList.add("platform-assignment-mode");
  const badge = document.querySelector(".qa-badge");
  if (badge) badge.textContent = "每日作業";
  const privacy = document.querySelector(".privacy-note");
  if (privacy) privacy.textContent = "評分後保存最新錄音";
  const scriptHeading = document.getElementById("scriptHeading");
  if (scriptHeading) scriptHeading.textContent = "本次指定台詞";
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
  const firstIncomplete = bridgeState.task.lineIndices.find((index) => !bridgeState.task.lineResults?.[index]);
  const selected = bridgeState.task.lineIndices.includes(hashLine) ? hashLine : firstIncomplete || bridgeState.task.lineIndices[0];
  const index = lineListIndex(selected);
  if (index >= 0) selectLine(index, true);
}

function updateBridgeLineButton(button, lineIndex) {
  const result = bridgeState.task.lineResults?.[lineIndex];
  button.classList.toggle("is-completed", Boolean(result));
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
  score.textContent = `已保存 ${Math.round(result.score)} 分`;
}

function renderBridgeProgress() {
  const completed = Object.keys(bridgeState.task.lineResults || {}).length;
  const total = bridgeState.task.lineIndices.length;
  const value = document.getElementById("bridgeProgressValue");
  const text = document.getElementById("bridgeProgressText");
  if (value) value.textContent = `${completed} / ${total}`;
  if (text) text.textContent = completed >= total ? "作業已完成" : "逐句完成";
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

function nextIncompleteLine() {
  return bridgeState.task.lineIndices.find((index) => !bridgeState.task.lineResults?.[index]);
}

async function submitBridgeAttempt(detail) {
  if (bridgeState.syncing) return;
  bridgeState.syncing = true;
  bridgeState.lastAttempt = detail;
  renderSyncStatus("saving", "正在保存分數與最新錄音");
  try {
    const audioBase64 = await blobToBase64(detail.recordingBlob);
    const result = detail.result;
    const response = await bridgeRequest("submitAttempt", {
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
        timing: result.scores?.["節奏長度"] ?? result.scores?.timing ?? 0,
        audioQuality: result.scores?.["錄音品質"] ?? result.scores?.audioQuality ?? 0,
      },
      recordingDuration: detail.recordingDuration,
      mimeType: detail.recordingBlob.type || "audio/webm",
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
    if (next) {
      renderSyncStatus("saved", "已保存到老師後台與雲端硬碟", {
        label: "前往下一句",
        handler: () => selectLine(lineListIndex(next), true),
      });
    } else {
      renderSyncStatus("saved", "本次指定台詞已全部完成", {
        label: "返回今日作業",
        handler: () => { location.href = `portal.html${isBridgeDemo() ? "?demo=1" : ""}`; },
      });
    }
  } catch (error) {
    if (["SESSION_INVALID", "SESSION_EXPIRED", "ACCOUNT_INACTIVE"].includes(error.code)) {
      localStorage.removeItem(bridgeConfig.sessionKey);
      location.replace("portal.html");
      return;
    }
    renderSyncStatus("error", error.message, { label: "重試保存", handler: () => submitBridgeAttempt(bridgeState.lastAttempt) });
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
  if (!bridgeAssignmentId) {
    location.replace(`portal.html${isBridgeDemo() ? "?demo=1" : ""}`);
    return;
  }
  try {
    bridgeState.task = await resolveBridgeTask();
    if (!bridgeState.task) throw new Error("找不到這份作業，可能已由老師關閉。");
    if (bridgeState.task.workSlug !== bridgeState.data.slug) {
      const demo = isBridgeDemo() ? "&demo=1" : "";
      location.replace(`index.html?work=${encodeURIComponent(bridgeState.task.workSlug)}&assignment=${encodeURIComponent(bridgeState.task.assignmentId)}${demo}#line-${bridgeState.task.lineIndices[0]}`);
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
    submitBridgeAttempt(event.detail);
  });
}
