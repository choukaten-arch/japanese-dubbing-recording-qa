const platformConfig = window.PLATFORM_CONFIG || {
  apiUrl: "",
  sessionKey: "dubbingPlatformSessionV1",
  taskKey: "dubbingPlatformActiveTaskV1",
};

const SHOWCASE_CLIP_GAP_SECONDS = 0.04;
const SHOWCASE_SCHEDULE_LOOKAHEAD_SECONDS = 8;
const SHOWCASE_PREFETCH_LOOKAHEAD_SECONDS = 12;
const RECORDING_AUDIO_CONCURRENCY = 3;
const PLATFORM_RETRYABLE_ACTIONS = new Set([
  "studentLogin",
  "teacherLogin",
  "studentTasks",
  "groupShowcases",
  "groupShowcaseClip",
  "studentReviewClip",
  "teacherOverview",
  "studentHistory",
]);
const PLATFORM_AUDIO_ACTIONS = new Set(["groupShowcaseClip", "studentReviewClip"]);
const PLATFORM_RETRYABLE_ERROR_CODES = new Set([
  "SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_INVALID_RESPONSE",
]);

const portalState = {
  session: null,
  teacherData: null,
  workData: new Map(),
  selectedRoleLines: [],
  selfPractice: [],
  credentials: [],
  showcases: [],
  showcasePlayers: new Map(),
  showcaseAudioCache: new Map(),
  showcaseAudioContext: null,
  recordingAudioQueue: [],
  recordingAudioActive: 0,
  studentReviewAudioCache: new Map(),
  studentReview: {
    data: null,
    clips: [],
    selectedIndex: -1,
    mode: "",
    source: null,
    sourceStartedAt: 0,
    sourceOffset: 0,
    frame: 0,
    stopAt: 0,
    waiting: false,
    generation: 0,
    playRequest: 0,
  },
  setupRequired: false,
  demo: new URLSearchParams(location.search).get("demo") === "1",
};

const portalElements = {};

function cachePortalElements() {
  [
    "accountBar", "accountLabel", "logoutButton", "authView", "studentMode", "teacherMode",
    "studentLoginPanel", "teacherLoginPanel", "studentId", "studentPin", "teacherPin",
    "loginMessage", "studentView", "studentDate", "studentTitle", "studentCompleted", "studentNotice",
    "studentPreferenceBar", "studentPreferencePoster", "studentPreferenceLabel", "changePreference",
    "studentPerformance", "studentRadar", "studentPracticedLines", "studentTotalAttempts", "studentTotalDuration",
    "viewMyCompletedClips",
    "preferenceDialog", "preferenceForm", "preferenceClose", "preferenceWork", "preferenceRoles",
    "preferencePoster", "preferenceMessage", "classProgressSection", "classProgressUpdated", "classProgressGroups",
    "studentShowcaseSection", "studentShowcaseUpdated", "studentShowcaseList",
    "taskList", "studentEmpty", "selfPracticeSection", "selfPracticeCount", "selfPracticeList",
    "teacherView", "sheetLink", "driveLink", "metricStudents",
    "metricAssignments", "metricSubmissions", "metricAverage", "assignPanel", "progressPanel",
    "groupsPanel", "groupRows", "showcasePanel", "teacherShowcaseList", "refreshShowcases", "studentsPanel", "assignmentForm", "assignmentTitle", "targetClass", "assignedDate", "dueDate",
    "masteryGoalFields", "lineGoalFields", "targetPercent", "targetScore",
    "assignmentWork", "assignmentRole", "assignmentStart", "assignmentCount", "linePreview",
    "assignmentLineCount", "assignmentMessage", "assignmentRows", "recentResultRows", "refreshTeacher",
    "studentCountLabel", "studentImportForm", "studentImportText", "resetExistingPins", "studentRows", "knownGroups",
    "historyDialog", "historyClose", "historyStudentMeta", "historyTitle", "historyMastery", "historyLines",
    "historyAttempts", "historyDuration", "historyGrowth", "historyTrend", "historyLineRows",
    "clipReviewDialog", "clipReviewClose", "clipReviewStudentMeta", "clipReviewTitle", "clipReviewCount",
    "clipReviewContent", "clipReviewList", "clipReviewVideo", "clipReviewStatus", "clipReviewPosition",
    "clipReviewScore", "clipReviewLineTitle", "clipReviewJapanese", "clipReviewTranslation",
    "clipReviewAccent", "clipReviewIntonation", "clipReviewSpeed", "clipReviewVolume",
    "clipReviewPrevious", "clipReviewCompare", "clipReviewOriginal", "clipReviewNext", "clipReviewEmpty",
    "credentialDialog", "credentialContent", "downloadCredentials", "printCredentials", "toast",
  ].forEach((id) => { portalElements[id] = document.getElementById(id); });
}

function escapePortalHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function taipeiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function displayDate(value) {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : String(value);
}

function displayDateTime(value) {
  if (!value) return "尚未登入";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function displayDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours} 小時 ${minutes} 分`;
  return `${minutes} 分 ${remainder} 秒`;
}

function masteryText(value) {
  return `${Math.max(0, Math.min(100, Number(value) || 0)).toFixed(1).replace(/\.0$/, "")}%`;
}

const MASTERY_TIERS = {
  gold: { label: "金色", order: 5 },
  silver: { label: "銀色", order: 4 },
  bronze: { label: "銅色", order: 3 },
  iron: { label: "鐵色", order: 2 },
  rust: { label: "生鏽色", order: 1 },
};

function masteryTierKey(value) {
  const score = Math.max(0, Math.min(100, Number(value) || 0));
  if (score >= 90) return "gold";
  if (score >= 80) return "silver";
  if (score >= 70) return "bronze";
  if (score >= 60) return "iron";
  return "rust";
}

function memberMasteryTier(member) {
  return Object.hasOwn(MASTERY_TIERS, member?.masteryTier)
    ? member.masteryTier
    : masteryTierKey(member?.masteryPercent);
}

function sortedMembersByMastery(members) {
  return (members || []).map((member, sourceIndex) => ({ member, sourceIndex })).sort((left, right) => {
    const leftHasScore = left.member.masteryPercent !== null && left.member.masteryPercent !== undefined
      && Number.isFinite(Number(left.member.masteryPercent));
    const rightHasScore = right.member.masteryPercent !== null && right.member.masteryPercent !== undefined
      && Number.isFinite(Number(right.member.masteryPercent));
    if (leftHasScore && rightHasScore && Number(left.member.masteryPercent) !== Number(right.member.masteryPercent)) {
      return Number(right.member.masteryPercent) - Number(left.member.masteryPercent);
    }
    const leftOrder = Number(left.member.completionOrder);
    const rightOrder = Number(right.member.completionOrder);
    if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) return leftOrder - rightOrder;
    const tierDifference = MASTERY_TIERS[memberMasteryTier(right.member)].order - MASTERY_TIERS[memberMasteryTier(left.member)].order;
    if (tierDifference) return tierDifference;
    return String(left.member.name || "").localeCompare(String(right.member.name || ""), "zh-Hant")
      || left.sourceIndex - right.sourceIndex;
  }).map(({ member }) => member);
}

function renderMemberRanking(members, {
  showScores = false,
  currentId = "",
  listClass = "",
  reviewable = false,
} = {}) {
  const orderedMembers = sortedMembersByMastery(members);
  if (!orderedMembers.length) return "";
  const classes = ["member-rank-list", listClass].filter(Boolean).join(" ");
  return `<ol class="${classes}">${orderedMembers.map((member, index) => {
    const tier = memberMasteryTier(member);
    const tierLabel = MASTERY_TIERS[tier].label;
    const hasScore = showScores && member.masteryPercent !== null && member.masteryPercent !== undefined
      && Number.isFinite(Number(member.masteryPercent));
    const score = hasScore ? masteryText(member.masteryPercent) : "";
    const accessibleLabel = `${member.name}，${tierLabel}${hasScore ? `，完成度 ${score}` : ""}`;
    const name = reviewable && member.studentId
      ? `<button class="member-rank-name student-review-button" type="button" data-student-id="${escapePortalHtml(member.studentId)}" aria-label="檢視${escapePortalHtml(member.name)}的完成片段">${escapePortalHtml(member.name)}</button>`
      : `<span class="member-rank-name">${escapePortalHtml(member.name)}</span>`;
    return `<li class="member-rank-item is-tier-${tier}${member.studentId === currentId ? " is-current" : ""}" aria-label="${escapePortalHtml(accessibleLabel)}" title="${escapePortalHtml(accessibleLabel)}">
      <span class="member-rank-position" aria-hidden="true">${index + 1}</span>
      ${name}
      ${hasScore ? `<span class="member-rank-score">${score}</span>` : ""}
    </li>`;
  }).join("")}</ol>`;
}

function profileRoles(profile) {
  const values = Array.isArray(profile?.roles) && profile.roles.length ? profile.roles : [profile?.role];
  return [...new Set(values.map((role) => String(role || "").trim()).filter(Boolean))];
}

function profileRoleLabel(profile) {
  return profileRoles(profile).join("、") || "—";
}

function posterUrl(slug) {
  const base = window.QA_CONFIG?.productionSiteBase || "https://choukaten-arch.github.io/japanese-dubbing-practice/";
  return new URL(`assets/${slug}.jpg`, base).href;
}

function readStoredSession() {
  try {
    const value = JSON.parse(localStorage.getItem(platformConfig.sessionKey));
    if (!value?.session?.token || Number(value.session.expiresAt) <= Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

function saveSession(value) {
  portalState.session = value;
  localStorage.setItem(platformConfig.sessionKey, JSON.stringify(value));
}

function clearSession() {
  clearShowcasePlayers();
  stopStudentReviewPlayback();
  portalState.session = null;
  localStorage.removeItem(platformConfig.sessionKey);
  localStorage.removeItem(platformConfig.taskKey);
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label || "處理中";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function showToast(message) {
  portalElements.toast.textContent = message;
  portalElements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { portalElements.toast.hidden = true; }, 4200);
}

async function platformRequest(action, payload = {}) {
  if (portalState.demo) return mockRequest(action, payload);
  if (!platformConfig.apiUrl) throw new Error("雲端後端尚未連結。");
  const attemptCount = PLATFORM_AUDIO_ACTIONS.has(action)
    ? 4
    : PLATFORM_RETRYABLE_ACTIONS.has(action) ? 3 : 1;
  let lastError;

  for (let attempt = 0; attempt < attemptCount; attempt += 1) {
    if (attempt > 0) {
      const backoff = 700 * (2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 350);
      await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(platformConfig.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        redirect: "follow",
        body: JSON.stringify({ action, userAgent: navigator.userAgent, ...payload }),
        signal: controller.signal,
      });
      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        const error = new Error("雲端服務暫時回應異常，請稍後再試。");
        error.code = "INVALID_CLOUD_RESPONSE";
        error.retryable = true;
        throw error;
      }
      if (!data.ok) {
        const error = new Error(data.error?.message || "雲端服務暫時無法處理。");
        error.code = data.error?.code;
        error.retryable = PLATFORM_RETRYABLE_ERROR_CODES.has(error.code);
        throw error;
      }
      return data;
    } catch (error) {
      const isTimeout = error.name === "AbortError";
      const canRetry = PLATFORM_RETRYABLE_ACTIONS.has(action)
        && (isTimeout || error.retryable || error.name === "TypeError");
      lastError = isTimeout
        ? new Error("雲端服務回應逾時，請稍後再試。")
        : error;
      if (!canRetry || attempt === attemptCount - 1) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("雲端服務暫時無法處理。");
}

function drainRecordingAudioQueue() {
  while (portalState.recordingAudioActive < RECORDING_AUDIO_CONCURRENCY
      && portalState.recordingAudioQueue.length) {
    const entry = portalState.recordingAudioQueue.shift();
    portalState.recordingAudioActive += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        portalState.recordingAudioActive -= 1;
        drainRecordingAudioQueue();
      });
  }
}

function queueRecordingAudioRequest(task, { priority = false } = {}) {
  return new Promise((resolve, reject) => {
    const entry = { task, resolve, reject };
    if (priority) portalState.recordingAudioQueue.unshift(entry);
    else portalState.recordingAudioQueue.push(entry);
    drainRecordingAudioQueue();
  });
}

function demoStore() {
  const key = "dubbingPlatformDemoDataV1";
  let value;
  try { value = JSON.parse(localStorage.getItem(key)); } catch {}
  if (!value) {
    value = {
      assignments: [{
        assignmentId: "DEMO-001",
        title: "琪琪台詞練習",
        targetClass: "416",
        assignedDate: taipeiDate(),
        dueDate: taipeiDate(),
        workSlug: "kiki",
        workTitle: "魔女宅急便",
        role: "琪琪",
        goalMode: "line_score",
        targetScore: null,
        requiredCount: 5,
        lineIndices: [1, 3, 6, 9, 10],
        status: "Active",
      }],
      lineResults: {},
      selfResults: {},
      recentResults: [],
      profile: null,
      groupName: "第 1 組",
    };
    localStorage.setItem(key, JSON.stringify(value));
  }
  value.lineResults ||= {};
  value.selfResults ||= {};
  value.recentResults ||= [];
  value.assignments ||= [];
  value.assignments.forEach((assignment) => { assignment.goalMode ||= "line_score"; });
  return {
    value,
    save() { localStorage.setItem(key, JSON.stringify(value)); },
  };
}

function demoTasks() {
  const store = demoStore();
  return store.value.assignments
    .filter((assignment) => assignment.status === "Active")
    .filter((assignment) => assignment.goalMode === "mastery_target" || (store.value.profile
      && assignment.workSlug === store.value.profile.workSlug
      && profileRoles(store.value.profile).includes(assignment.role)))
    .map((assignment) => {
      if (assignment.goalMode === "mastery_target") {
        const progress = demoClassProgress()[0];
        const achieved = progress.masteryPercent >= assignment.targetPercent;
        return {
          ...assignment,
          currentMastery: progress.masteryPercent,
          achieved,
          completed: achieved ? 1 : 0,
          requiredCount: 1,
          lineIndices: [],
          lineResults: {},
          completionRate: Math.min(100, Math.round((progress.masteryPercent / assignment.targetPercent) * 100)),
          overdue: assignment.dueDate < taipeiDate(),
        };
      }
      const lineResults = store.value.lineResults[assignment.assignmentId] || {};
      Object.values(lineResults).forEach((result) => {
        result.achieved = assignment.targetScore == null || Number(result.score) >= Number(assignment.targetScore);
      });
      const completed = Object.values(lineResults).filter((result) => result.achieved).length;
      return {
        ...assignment,
        completed,
        completionRate: Math.round((completed / assignment.lineIndices.length) * 100),
        lineResults,
        overdue: assignment.dueDate < taipeiDate(),
      };
    });
}

function demoSelfKey(workSlug, role) {
  return `${workSlug}|${role}`;
}

async function demoSelfPractice() {
  const store = demoStore();
  const profile = store.value.profile;
  if (!profile) return [];
  const data = await fetchWorkData(profile.workSlug);
  return profileRoles(profile).map((role) => {
    const lineIndices = data.lines.filter((line) => line.role === role).map((line) => line.index);
    const lineResults = { ...(store.value.selfResults[demoSelfKey(profile.workSlug, role)] || {}) };
    store.value.assignments.filter((assignment) => assignment.workSlug === profile.workSlug && assignment.role === role)
      .forEach((assignment) => Object.assign(lineResults, store.value.lineResults[assignment.assignmentId] || {}));
    const values = Object.values(lineResults);
    const scoreTotal = values.reduce((sum, result) => sum + (Number(result.score) || 0), 0);
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
      completed: values.length,
      completionRate: lineIndices.length ? Math.round((values.length / lineIndices.length) * 100) : 0,
      masteryPercent: lineIndices.length ? Math.round((scoreTotal / lineIndices.length) * 10) / 10 : 0,
      lineResults,
    };
  });
}

function demoClassProgress() {
  const store = demoStore();
  const latest = {};
  store.value.assignments.forEach((assignment) => {
    if (!store.value.profile || assignment.workSlug !== store.value.profile.workSlug || !profileRoles(store.value.profile).includes(assignment.role)) return;
    Object.entries(store.value.lineResults[assignment.assignmentId] || {}).forEach(([lineIndex, result]) => { latest[`${assignment.role}|${lineIndex}`] = result; });
  });
  Object.entries(store.value.selfResults).forEach(([key, resultMap]) => {
    const separator = key.indexOf("|");
    const workSlug = separator >= 0 ? key.slice(0, separator) : store.value.profile?.workSlug;
    const role = separator >= 0 ? key.slice(separator + 1) : key;
    if (!store.value.profile || workSlug !== store.value.profile.workSlug || !profileRoles(store.value.profile).includes(role)) return;
    Object.entries(resultMap || {}).forEach(([lineIndex, result]) => { latest[`${role}|${lineIndex}`] = result; });
  });
  const scores = Object.values(latest).map((result) => Number(result.score) || 0);
  const selectedLineTotal = Number(store.value.profile?.totalLines) || (store.value.profile ? 22 : 0);
  const mastery = selectedLineTotal && scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / selectedLineTotal) * 10) / 10 : 0;
  const attempts = store.value.recentResults.length;
  const duration = store.value.recentResults.reduce((sum, result) => sum + Math.max(0, Number(result.durationSec) || 0), 0);
  return [
    { seatNo: "0", studentId: "demo", name: "測試學生", className: "416", groupName: store.value.groupName, profile: store.value.profile, masteryPercent: mastery, practicedLines: scores.length, totalLines: selectedLineTotal, totalAttempts: attempts, totalDurationSec: duration, aspectAverages: demoAspectAverages(store.value.recentResults) },
    { seatNo: "2", studentId: "demo-02", name: "示範組員甲", className: "416", groupName: "第 1 組", profile: { workSlug: "kiki", workTitle: "魔女宅急便", roles: ["琪琪", "吉吉"], role: "琪琪" }, masteryPercent: 46.2, practicedLines: 12, totalLines: 28, totalAttempts: 27, totalDurationSec: 218, aspectAverages: { accent: 72, intonation: 68, speed: 81, volume: 76 } },
    { seatNo: "3", studentId: "demo-03", name: "示範組員乙", className: "416", groupName: "第 1 組", profile: { workSlug: "kiki", workTitle: "魔女宅急便", roles: ["老夫人"], role: "老夫人" }, masteryPercent: 51.8, practicedLines: 13, totalLines: 18, totalAttempts: 31, totalDurationSec: 246, aspectAverages: { accent: 76, intonation: 75, speed: 70, volume: 82 } },
    { seatNo: "4", studentId: "demo-04", name: "示範組員丙", className: "416", groupName: "第 2 組", profile: { workSlug: "ponyo", workTitle: "崖上的波妞", roles: ["波妞"], role: "波妞" }, masteryPercent: 37.5, practicedLines: 10, totalLines: 24, totalAttempts: 19, totalDurationSec: 164, aspectAverages: { accent: 66, intonation: 73, speed: 64, volume: 79 } },
  ];
}

function demoAspectAverages(results) {
  const entries = results.map((item) => item.aspects).filter(Boolean);
  const average = (key) => entries.length ? Math.round(entries.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / entries.length) : 0;
  return { accent: average("accent"), intonation: average("intonation"), speed: average("speed"), volume: average("volume") };
}

function demoGroupProgress() {
  const students = demoClassProgress();
  const ownGroupName = demoStore().value.groupName;
  const groups = new Map();
  students.forEach((student) => {
    const groupName = student.groupName || "未分組";
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(student);
  });
  return [...groups].map(([groupName, members]) => {
    const practicedLines = members.reduce((sum, member) => sum + Number(member.practicedLines || 0), 0);
    const totalLines = members.reduce((sum, member) => sum + Number(member.totalLines || 0), 0);
    const isOwnGroup = groupName === ownGroupName;
    const orderedMembers = sortedMembersByMastery(members);
    return {
      groupName,
      memberCount: members.length,
      averageMastery: members.reduce((sum, member) => sum + Number(member.masteryPercent || 0), 0) / members.length,
      practicedLines,
      totalLines,
      completionRate: totalLines ? Math.round(practicedLines / totalLines * 100) : 0,
      isOwnGroup,
      canSeeMemberScores: isOwnGroup,
      members: orderedMembers.map((member, index) => ({
        studentId: member.studentId,
        name: member.name,
        masteryTier: masteryTierKey(member.masteryPercent),
        completionOrder: index + 1,
        masteryPercent: isOwnGroup ? member.masteryPercent : null,
        practicedLines: isOwnGroup ? member.practicedLines : null,
        totalLines: isOwnGroup ? member.totalLines : null,
      })),
    };
  });
}

function demoToneBase64() {
  const sampleRate = 8000;
  const sampleCount = 9600;
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
    const fade = Math.min(1, index / 120, (sampleCount - index) / 120);
    view.setInt16(44 + index * 2, Math.sin(index / sampleRate * Math.PI * 2 * 440) * 4200 * fade, true);
  }
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function demoGroupShowcases(isTeacher = false) {
  const profile = demoStore().value.profile || { workSlug: "kiki", workTitle: "魔女宅急便" };
  const ownData = await fetchWorkData(profile.workSlug);
  const otherData = await fetchWorkData(profile.workSlug === "ponyo" ? "totoro" : "ponyo");
  const ownMembers = demoClassProgress().filter((student) => student.groupName === demoStore().value.groupName);
  const otherMembers = demoClassProgress().filter((student) => student.groupName === "第 2 組");
  const demoMembers = (members, canSeeScores) => sortedMembersByMastery(members).map((member, index) => ({
    studentId: member.studentId,
    name: member.name,
    masteryTier: masteryTierKey(member.masteryPercent),
    completionOrder: index + 1,
    masteryPercent: canSeeScores ? member.masteryPercent : null,
    practicedLines: canSeeScores ? member.practicedLines : null,
    totalLines: canSeeScores ? member.totalLines : null,
  }));
  return {
    showcases: [
      {
        showcaseId: "demo-own",
        groupName: demoStore().value.groupName,
        workSlug: profile.workSlug,
        workTitle: profile.workTitle,
        memberCount: ownMembers.length,
        recordedSegments: 2,
        totalSegments: ownData.lines.length,
        completionRate: Math.round(2 / ownData.lines.length * 100),
        averageMastery: ownMembers.reduce((sum, member) => sum + member.masteryPercent, 0) / ownMembers.length,
        isOwnGroup: !isTeacher,
        canSeeMembers: true,
        canSeeMemberScores: true,
        members: demoMembers(ownMembers, true),
        segments: ownData.lines.slice(0, 2).map((line, index) => ({ resultKey: `demo-own-${index}`, lineIndex: line.index, role: line.role, score: 82 - index * 3, recordingDuration: line.end - line.start + 2.4, studentName: ownMembers[index % ownMembers.length]?.name || "測試學生", updatedAt: new Date().toISOString() })),
        updatedAt: new Date().toISOString(),
      },
      {
        showcaseId: "demo-other",
        groupName: "第 2 組",
        workSlug: otherData.slug,
        workTitle: otherData.title,
        memberCount: 1,
        recordedSegments: 1,
        totalSegments: otherData.lines.length,
        completionRate: Math.round(1 / otherData.lines.length * 100),
        averageMastery: 37.5,
        isOwnGroup: false,
        canSeeMembers: true,
        canSeeMemberScores: isTeacher,
        members: demoMembers(otherMembers, isTeacher),
        segments: [{ resultKey: "demo-other-0", lineIndex: otherData.lines[0].index, role: otherData.lines[0].role, score: 76, recordingDuration: otherData.lines[0].end - otherData.lines[0].start + 2.4, studentName: "", updatedAt: new Date().toISOString() }],
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

async function mockRequest(action, payload) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const session = {
    token: `demo-${Date.now()}`,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };
  if (action === "studentLogin") {
    if (payload.studentId !== "demo" || payload.pin !== "123456") throw new Error("示範學生帳號為 demo，PIN 為 123456。");
    return {
      ok: true,
      session,
      account: { type: "student", studentId: "demo", name: "測試學生", className: "416", seatNo: "0", profile: demoStore().value.profile },
      needsSetup: !demoStore().value.profile,
    };
  }
  if (action === "teacherLogin") {
    if (payload.pin !== "teacher1") throw new Error("示範老師密碼為 teacher1。");
    return { ok: true, session, account: { type: "teacher", name: "測試老師" } };
  }
  if (action === "studentTasks") {
    const profile = demoStore().value.profile;
    const progress = demoClassProgress()[0];
    return {
      ok: true,
      account: { type: "student", studentId: "demo", name: "測試學生", className: "416", seatNo: "0", profile },
      profile,
      needsSetup: !profile,
      progress,
      classProgress: demoClassProgress().filter((student) => student.groupName === demoStore().value.groupName),
      groupProgress: demoGroupProgress(),
      selfPractice: await demoSelfPractice(),
      tasks: demoTasks(),
    };
  }
  if (action === "setStudentPreference") {
    const store = demoStore();
    const work = (window.QA_WORKS || []).find((item) => item.slug === payload.workSlug);
    const roleInputs = Array.isArray(payload.roles) ? payload.roles : [payload.role];
    const roles = [...new Set(roleInputs.map((role) => String(role || "").trim()).filter(Boolean))];
    const workData = portalState.workData.get(payload.workSlug);
    const totalLines = (workData?.roles || [])
      .filter((role) => roles.includes(role.role))
      .reduce((sum, role) => sum + Number(role.lineCount || 0), 0);
    store.value.profile = { groupName: store.value.groupName, workSlug: payload.workSlug, workTitle: work?.title || payload.workSlug, roles, role: roles[0], totalLines };
    store.save();
    return { ok: true, profile: store.value.profile };
  }
  if (action === "setStudentGroup") {
    const store = demoStore();
    store.value.groupName = payload.groupName;
    if (store.value.profile) store.value.profile.groupName = payload.groupName;
    store.save();
    return { ok: true, studentId: payload.studentId, groupName: payload.groupName };
  }
  if (action === "teacherOverview") return mockTeacherOverview();
  if (action === "groupShowcases") return demoGroupShowcases(portalState.session?.account?.type === "teacher");
  if (action === "groupShowcaseClip") return { ok: true, resultKey: payload.resultKey, mimeType: "audio/wav", audioBase64: demoToneBase64() };
  if (action === "studentReviewClip") {
    if (portalState.session?.account?.type === "student" && payload.studentId !== portalState.session.account.studentId) {
      throw new Error("只能查看自己的完成片段。");
    }
    return { ok: true, resultKey: payload.resultKey, mimeType: "audio/wav", audioBase64: demoToneBase64() };
  }
  if (action === "studentHistory") {
    if (portalState.session?.account?.type === "student" && payload.studentId !== portalState.session.account.studentId) {
      throw new Error("只能查看自己的完成片段。");
    }
    return mockStudentHistory(payload.studentId);
  }
  if (action === "createAssignment") {
    const store = demoStore();
    const work = (window.QA_WORKS || []).find((item) => item.slug === payload.assignment.workSlug);
    const goalMode = payload.assignment.goalMode || "line_score";
    const assignment = {
      assignmentId: `DEMO-${Date.now()}`,
      title: payload.assignment.title || (goalMode === "mastery_target"
        ? `熟練度達 ${payload.assignment.targetPercent}%`
        : `${work?.title || "作品"}練習`),
      targetClass: payload.assignment.targetClass,
      assignedDate: payload.assignment.assignedDate,
      dueDate: payload.assignment.dueDate,
      goalMode,
      targetPercent: goalMode === "mastery_target" ? Number(payload.assignment.targetPercent) : null,
      targetScore: goalMode === "line_score" ? Number(payload.assignment.targetScore) : null,
      workSlug: goalMode === "line_score" ? payload.assignment.workSlug : "",
      workTitle: goalMode === "line_score" ? work?.title || payload.assignment.workSlug : "依學生目前選角",
      role: goalMode === "line_score" ? payload.assignment.role : "",
      requiredCount: goalMode === "line_score" ? payload.assignment.lineIndices.length : 0,
      lineIndices: goalMode === "line_score" ? payload.assignment.lineIndices : [],
      status: "Active",
    };
    store.value.assignments.unshift(assignment);
    store.save();
    return { ok: true, assignmentId: assignment.assignmentId, title: assignment.title, goalMode, lineIndices: assignment.lineIndices };
  }
  if (action === "updateAssignmentStatus") {
    const store = demoStore();
    const assignment = store.value.assignments.find((item) => item.assignmentId === payload.assignmentId);
    if (assignment) assignment.status = payload.status;
    store.save();
    return { ok: true, assignmentId: payload.assignmentId, status: payload.status };
  }
  if (action === "resetStudentPin") return { ok: true, credential: { studentId: "demo", name: "測試學生", pin: "654321" } };
  if (action === "upsertStudents") {
    return { ok: true, created: payload.students.length, updated: 0, credentials: payload.students.map((student, index) => ({ ...student, pin: student.initialPin || String(731200 + index) })) };
  }
  throw new Error("示範模式不支援此操作。");
}

function mockTeacherOverview() {
  const store = demoStore();
  const assignments = store.value.assignments.map((assignment) => {
    if (assignment.goalMode === "mastery_target") {
      const progress = demoClassProgress()[0];
      const achieved = progress.masteryPercent >= assignment.targetPercent ? 1 : 0;
      return {
        ...assignment,
        students: 1,
        achievedStudents: achieved,
        completedLines: achieved,
        expectedLines: 1,
        completionRate: achieved * 100,
        averageScore: progress.masteryPercent,
      };
    }
    const results = store.value.lineResults[assignment.assignmentId] || {};
    const values = Object.values(results);
    const achieved = values.filter((item) => assignment.targetScore == null || Number(item.score) >= Number(assignment.targetScore));
    return {
      ...assignment,
      students: 1,
      completedLines: achieved.length,
      expectedLines: assignment.lineIndices.length,
      completionRate: Math.round((achieved.length / assignment.lineIndices.length) * 100),
      averageScore: values.length ? Math.round(values.reduce((sum, item) => sum + item.score, 0) / values.length) : null,
    };
  });
  const scores = store.value.recentResults.map((item) => item.score);
  const students = demoClassProgress().map((student) => ({ ...student, lastLoginAt: new Date().toISOString() }));
  const grouped = new Map();
  students.forEach((student) => {
    const groupName = student.groupName || "未分組";
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(student);
  });
  const groups = [...grouped].map(([groupName, members]) => ({
    groupName,
    memberCount: members.length,
    averageMastery: Math.round((members.reduce((sum, member) => sum + member.masteryPercent, 0) / members.length) * 10) / 10,
    practicedLines: members.reduce((sum, member) => sum + member.practicedLines, 0),
    totalLines: members.reduce((sum, member) => sum + member.totalLines, 0),
    totalAttempts: members.reduce((sum, member) => sum + member.totalAttempts, 0),
    totalDurationSec: members.reduce((sum, member) => sum + member.totalDurationSec, 0),
    students: members.map((member) => ({ studentId: member.studentId, name: member.name, masteryPercent: member.masteryPercent })),
  }));
  return {
    ok: true,
    summary: {
      activeStudents: 41,
      activeAssignments: assignments.filter((item) => item.status === "Active").length,
      todaySubmissions: store.value.recentResults.length,
      averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    },
    assignments,
    groups,
    students,
    recentResults: store.value.recentResults,
    sheetUrl: "#",
    recordingFolderUrl: "#",
  };
}

async function mockStudentHistory(studentId) {
  const store = demoStore();
  const student = demoClassProgress().find((item) => item.studentId === studentId) || demoClassProgress()[0];
  const recent = store.value.recentResults.filter((item) => item.studentId === studentId || studentId === "demo");
  const profile = student.profile || { workSlug: "kiki", workTitle: "魔女宅急便", roles: ["老夫人"], role: "老夫人" };
  const data = await fetchWorkData(profile.workSlug);
  const demoLines = data.lines.filter((line) => profileRoles(profile).includes(line.role)).slice(0, 2);
  const records = recent.length || studentId === "demo" ? recent : demoLines.map((line, index) => ({
    studentId: student.studentId,
    studentName: student.name,
    workSlug: data.slug,
    workTitle: data.title,
    role: line.role,
    lineIndex: line.index,
    targetText: line.japanese,
    score: 78 + index * 6,
    attempts: 1,
    durationSec: Math.max(1, line.end - line.start + 2),
    aspects: { accent: 76 + index * 4, intonation: 74 + index * 5, speed: 82, volume: 80 + index * 3 },
    updatedAt: new Date(Date.now() - index * 60000).toISOString(),
  }));
  const byLine = new Map();
  records.slice().reverse().forEach((item) => {
    const key = `${item.workSlug}|${item.role}|${item.lineIndex}`;
    if (!byLine.has(key)) {
      byLine.set(key, {
        workSlug: item.workSlug,
        workTitle: item.workTitle,
        role: item.role,
        lineIndex: item.lineIndex,
        targetText: item.targetText || "",
        resultKey: `demo-review-${student.studentId}-${item.workSlug}-${item.role}-${item.lineIndex}`,
        attempts: [],
      });
    }
    byLine.get(key).attempts.push({
      score: item.score,
      aspects: item.aspects || {},
      durationSec: Number(item.durationSec) || 0,
      submittedAt: item.updatedAt,
      attemptNumber: item.attempts,
    });
  });
  const lines = [...byLine.values()].map((line) => {
    const scores = line.attempts.map((attempt) => attempt.score);
    const latest = line.attempts.at(-1) || {};
    return {
      ...line,
      latestScore: scores.at(-1) || 0,
      bestScore: scores.length ? Math.max(...scores) : 0,
      growthPoints: scores.length > 1 ? scores.at(-1) - scores[0] : 0,
      totalDurationSec: line.attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0),
      latestRecordingDurationSec: Number(latest.durationSec) || 0,
      latestAspects: latest.aspects || {},
      latestUpdatedAt: latest.submittedAt || "",
      latestAudioUrl: "",
    };
  });
  const timeline = records.slice().reverse().slice(-40).map((item) => ({
    score: item.score,
    aspects: item.aspects || {},
    durationSec: Number(item.durationSec) || 0,
    lineIndex: item.lineIndex,
    submittedAt: item.updatedAt,
  }));
  return {
    student: { ...student, profile: student.profile },
    summary: { masteryPercent: student.masteryPercent, practicedLines: student.practicedLines, totalLines: student.totalLines, totalAttempts: student.totalAttempts, totalDurationSec: student.totalDurationSec, growthPoints: timeline.length > 1 ? timeline.at(-1).score - timeline[0].score : 0, practiceDays: timeline.length ? 1 : 0 },
    lines,
    timeline,
  };
}

function switchLoginMode(mode) {
  const student = mode === "student";
  portalElements.studentMode.classList.toggle("is-active", student);
  portalElements.teacherMode.classList.toggle("is-active", !student);
  portalElements.studentMode.setAttribute("aria-selected", String(student));
  portalElements.teacherMode.setAttribute("aria-selected", String(!student));
  portalElements.studentLoginPanel.hidden = !student;
  portalElements.teacherLoginPanel.hidden = student;
  portalElements.loginMessage.textContent = "";
  if (student) portalElements.studentId.focus();
  else portalElements.teacherPin.focus();
}

async function handleStudentLogin(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "登入中");
  portalElements.loginMessage.textContent = "";
  try {
    const response = await platformRequest("studentLogin", {
      studentId: portalElements.studentId.value.trim(),
      pin: portalElements.studentPin.value.trim(),
    });
    saveSession({ session: response.session, account: response.account });
    await showStudentDashboard();
  } catch (error) {
    portalElements.loginMessage.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function handleTeacherLogin(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "登入中");
  portalElements.loginMessage.textContent = "";
  try {
    const response = await platformRequest("teacherLogin", { pin: portalElements.teacherPin.value.trim() });
    saveSession({ session: response.session, account: response.account });
    await showTeacherDashboard();
  } catch (error) {
    portalElements.loginMessage.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function showAuthenticatedShell(label) {
  portalElements.authView.hidden = true;
  portalElements.accountBar.hidden = false;
  portalElements.accountLabel.textContent = label;
}

async function showStudentDashboard() {
  const { account, session } = portalState.session;
  showAuthenticatedShell(`${account.className} 班 ${account.name}`);
  portalElements.teacherView.hidden = true;
  portalElements.studentView.hidden = false;
  portalElements.studentTitle.textContent = `${account.name}的配音任務`;
  portalElements.studentDate.textContent = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(new Date());
  portalElements.taskList.innerHTML = '<div class="empty-state"><strong>載入作業中</strong></div>';
  try {
    const response = await platformRequest("studentTasks", { token: session.token });
    const profile = response.profile || response.account?.profile || null;
    saveSession({ session, account: { ...account, ...(response.account || {}), profile } });
    portalState.selfPractice = response.selfPractice || [];
    renderStudentProfile(profile);
    renderStudentPerformance(response.progress || {});
    renderClassProgress(response.groupProgress || groupProgressFromStudents(response.classProgress || []));
    renderStudentTasks(response.tasks || []);
    renderSelfPractice(portalState.selfPractice);
    if (profile) await loadGroupShowcases("student");
    else portalElements.studentShowcaseSection.hidden = true;
    if (response.needsSetup) await openPreferenceDialog(true);
  } catch (error) {
    handleSessionError(error);
    portalElements.taskList.innerHTML = `<div class="empty-state"><strong>無法載入作業</strong><span>${escapePortalHtml(error.message)}</span></div>`;
  }
}

function renderStudentPerformance(progress) {
  const hasProfile = Boolean(portalState.session?.account?.profile);
  portalElements.studentPerformance.hidden = !hasProfile;
  if (!hasProfile) return;
  portalElements.studentCompleted.textContent = masteryText(progress.masteryPercent);
  portalElements.studentPracticedLines.textContent = `${Number(progress.practicedLines) || 0} / ${Number(progress.totalLines) || 0}`;
  portalElements.studentTotalAttempts.textContent = `${Number(progress.totalAttempts) || 0} 次`;
  portalElements.studentTotalDuration.textContent = displayDuration(progress.totalDurationSec);
  window.drawPracticeRadar?.(portalElements.studentRadar, progress.aspectAverages || {});
}

function renderStudentProfile(profile) {
  portalElements.studentPreferenceBar.hidden = !profile;
  portalElements.changePreference.hidden = Boolean(profile?.preferenceLocked);
  if (!profile) return;
  portalElements.studentPreferencePoster.src = posterUrl(profile.workSlug);
  portalElements.studentPreferencePoster.alt = profile.workTitle;
  const group = profile.groupName ? `${profile.groupName}｜` : "";
  portalElements.studentPreferenceLabel.textContent = `${group}${profile.workTitle} · ${profileRoleLabel(profile)}`;
}

function groupProgressFromStudents(students) {
  const ownGroupName = portalState.session?.account?.profile?.groupName || "";
  const grouped = new Map();
  students.forEach((student) => {
    const groupName = student.groupName || "未分組";
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(student);
  });
  return [...grouped].map(([groupName, members]) => {
    const practicedLines = members.reduce((sum, member) => sum + Number(member.practicedLines || 0), 0);
    const totalLines = members.reduce((sum, member) => sum + Number(member.totalLines || 0), 0);
    const isOwnGroup = Boolean(ownGroupName && groupName === ownGroupName);
    const orderedMembers = sortedMembersByMastery(members);
    return {
      groupName,
      memberCount: members.length,
      averageMastery: members.reduce((sum, member) => sum + Number(member.masteryPercent || 0), 0) / members.length,
      practicedLines,
      totalLines,
      completionRate: totalLines ? Math.round(practicedLines / totalLines * 100) : 0,
      isOwnGroup,
      canSeeMemberScores: isOwnGroup,
      members: orderedMembers.map((member, index) => ({
        studentId: member.studentId,
        name: member.name,
        masteryTier: masteryTierKey(member.masteryPercent),
        completionOrder: index + 1,
        masteryPercent: isOwnGroup ? member.masteryPercent : null,
      })),
    };
  });
}

function renderClassProgress(groups) {
  portalElements.classProgressSection.hidden = groups.length === 0;
  portalElements.classProgressUpdated.textContent = groups.length ? `${groups.length} 組` : "";
  if (!groups.length) {
    portalElements.classProgressGroups.replaceChildren();
    return;
  }
  const currentId = portalState.session?.account?.studentId;
  portalElements.classProgressGroups.innerHTML = groups.map((group) => {
    const members = group.members || [];
    const showScores = group.canSeeMemberScores ?? group.isOwnGroup;
    return `<section class="group-progress-block${group.isOwnGroup ? " is-own-group" : ""}" aria-label="${escapePortalHtml(group.groupName)}">
      <header class="group-progress-heading"><strong>${escapePortalHtml(group.groupName)}${group.isOwnGroup ? '<span class="own-group-label">我的組別</span>' : ""}</strong><span>熟練度 ${masteryText(group.averageMastery)}</span></header>
      <div class="group-completion"><span class="mastery-track" aria-label="小組完成度 ${masteryText(group.completionRate)}"><span style="width:${Math.max(0, Math.min(100, Number(group.completionRate) || 0))}%"></span></span><strong>${masteryText(group.completionRate)}</strong></div>
      <div class="group-member-area">
        <div class="group-summary-meta"><span>${group.memberCount} 人</span><span>${group.practicedLines} / ${group.totalLines} 段</span></div>
        ${renderMemberRanking(members, { showScores, currentId, listClass: "group-member-list" })}
      </div>
    </section>`;
  }).join("");
}

function audioBlobFromBase64(base64, mimeType) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType || "audio/webm" });
}

function getShowcaseAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("此瀏覽器不支援小組合成音訊。");
  if (!portalState.showcaseAudioContext || portalState.showcaseAudioContext.state === "closed") {
    portalState.showcaseAudioContext = new AudioContextConstructor({ latencyHint: "interactive" });
  }
  return portalState.showcaseAudioContext;
}

function clampShowcaseValue(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function analyzeShowcaseBuffer(buffer) {
  const sampleRate = Number(buffer?.sampleRate) || 0;
  const length = Number(buffer?.length) || 0;
  const channelCount = Math.max(0, Math.min(2, Number(buffer?.numberOfChannels) || 0));
  const duration = Number(buffer?.duration) || (sampleRate ? length / sampleRate : 0);
  if (!sampleRate || !length || !channelCount || typeof buffer.getChannelData !== "function") {
    return { active: false, activeStart: 0, activeEnd: duration, rms: 0, peak: 0, noiseFloor: 0, activity: [] };
  }

  const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
  const frameSize = Math.max(128, Math.round(sampleRate * 0.02));
  const frameLevels = [];
  for (let frameStart = 0; frameStart < length; frameStart += frameSize) {
    const frameEnd = Math.min(length, frameStart + frameSize);
    let energy = 0;
    let sampleCount = 0;
    for (let sample = frameStart; sample < frameEnd; sample += 2) {
      for (const channel of channels) {
        const value = Number(channel[sample]) || 0;
        energy += value * value;
        sampleCount += 1;
      }
    }
    frameLevels.push(sampleCount ? Math.sqrt(energy / sampleCount) : 0);
  }

  const smoothedLevels = frameLevels.map((level, index) => (
    ((frameLevels[index - 1] ?? level) + level + (frameLevels[index + 1] ?? level)) / 3
  ));
  const sortedLevels = [...smoothedLevels].sort((left, right) => left - right);
  const noiseFloor = sortedLevels[Math.floor(sortedLevels.length * 0.2)] || 0;
  const loudestFrame = Math.max(0, ...smoothedLevels);
  if (loudestFrame < 0.0012) {
    return { active: false, activeStart: 0, activeEnd: duration, rms: 0, peak: 0, noiseFloor, activity: [] };
  }

  const threshold = Math.min(
    loudestFrame * 0.45,
    Math.max(0.0012, noiseFloor * 2.8, loudestFrame * 0.08),
  );
  const firstActiveFrame = smoothedLevels.findIndex((level) => level >= threshold);
  let lastActiveFrame = -1;
  for (let index = smoothedLevels.length - 1; index >= 0; index -= 1) {
    if (smoothedLevels[index] >= threshold) {
      lastActiveFrame = index;
      break;
    }
  }
  if (firstActiveFrame < 0 || lastActiveFrame < firstActiveFrame) {
    return { active: false, activeStart: 0, activeEnd: duration, rms: 0, peak: 0, noiseFloor, activity: [] };
  }

  const activeStart = Math.max(0, firstActiveFrame * frameSize / sampleRate - 0.035);
  const activeEnd = Math.min(duration, (lastActiveFrame + 1) * frameSize / sampleRate + 0.16);
  const sampleStart = Math.max(0, Math.floor(activeStart * sampleRate));
  const sampleEnd = Math.min(length, Math.ceil(activeEnd * sampleRate));
  let energy = 0;
  let peak = 0;
  let sampleCount = 0;
  for (let sample = sampleStart; sample < sampleEnd; sample += 1) {
    for (const channel of channels) {
      const value = Math.abs(Number(channel[sample]) || 0);
      energy += value * value;
      peak = Math.max(peak, value);
      sampleCount += 1;
    }
  }
  return {
    active: true,
    activeStart,
    activeEnd,
    rms: sampleCount ? Math.sqrt(energy / sampleCount) : 0,
    peak,
    noiseFloor,
    activity: smoothedLevels.map((rms, index) => ({
      start: index * frameSize / sampleRate,
      end: Math.min(duration, (index + 1) * frameSize / sampleRate),
      active: rms >= threshold,
    })),
  };
}

function showcaseActiveSecondsAfter(activity, startSeconds) {
  return (Array.isArray(activity) ? activity : []).reduce((total, frame) => {
    if (!frame.active || Number(frame.end) <= startSeconds) return total;
    return total + Math.max(0, Number(frame.end) - Math.max(startSeconds, Number(frame.start) || 0));
  }, 0);
}

function diagnoseShowcaseSegment(segment, analysis) {
  const mandatory = [];
  const review = [];
  if (segment.syncStatus === "rerecord" || segment.requiresRerecord) {
    mandatory.push(segment.syncReason || "先前的時間軸評分未通過");
  } else if (segment.syncStatus === "review" && segment.syncReason) {
    review.push(segment.syncReason);
  }
  const expectedDuration = Math.max(0.1, Number(segment.expectedDuration) || Number(segment.cueEnd) - Number(segment.start));
  let onsetErrorSec = null;
  let overrunSec = 0;
  if (!analysis.active) {
    mandatory.push(segment.isSoundEffect ? "錄音中沒有偵測到音效" : "錄音中沒有偵測到足夠的人聲");
  } else if (segment.isSoundEffect) {
    const expectedOnset = Math.max(0, Number(segment.expectedOnset) || 0);
    onsetErrorSec = analysis.activeStart - expectedOnset;
    if (Math.abs(onsetErrorSec) > 0.8) {
      mandatory.push(`音效第一拍比提示${onsetErrorSec > 0 ? "晚" : "早"} ${Math.abs(onsetErrorSec).toFixed(2)} 秒`);
    } else if (Math.abs(onsetErrorSec) > 0.35) {
      review.push(`音效第一拍比提示${onsetErrorSec > 0 ? "晚" : "早"} ${Math.abs(onsetErrorSec).toFixed(2)} 秒`);
    }
    const events = Array.isArray(segment.expectedEvents) ? segment.expectedEvents : [];
    if (events.length) {
      const hitCount = events.filter((event) => analysis.activity.some((frame) => (
        frame.active && Number(frame.end) >= event.start && Number(frame.start) <= event.end
      ))).length;
      const coverage = Math.round(hitCount / events.length * 100);
      if (coverage < 45) mandatory.push(`只命中 ${hitCount} / ${events.length} 個音效事件`);
      else if (coverage < 65) review.push(`只命中 ${hitCount} / ${events.length} 個音效事件`);
    }
  } else {
    onsetErrorSec = analysis.activeStart;
    overrunSec = Math.max(0, analysis.activeEnd - expectedDuration);
    const lateLimit = Math.max(0.7, Math.min(0.95, expectedDuration * 0.25));
    const reviewLateLimit = Math.max(0.4, Math.min(0.6, expectedDuration * 0.15));
    if (analysis.activeStart > lateLimit) {
      mandatory.push(`開口比台詞開始晚 ${analysis.activeStart.toFixed(2)} 秒`);
    } else if (analysis.activeStart > reviewLateLimit) {
      review.push(`開口比台詞開始晚 ${analysis.activeStart.toFixed(2)} 秒`);
    }
    const sustainedOverrun = showcaseActiveSecondsAfter(analysis.activity, expectedDuration + 0.65);
    if (overrunSec > 0.8 && sustainedOverrun >= 0.12) {
      mandatory.push(`句尾超出原台詞 ${overrunSec.toFixed(2)} 秒，會壓到下一句`);
    } else if (overrunSec > 0.45 && sustainedOverrun >= 0.08) {
      review.push(`句尾超出原台詞 ${overrunSec.toFixed(2)} 秒，請複核`);
    }
  }
  const reasons = [...new Set(mandatory.length ? mandatory : review)];
  Object.assign(segment, {
    syncStatus: mandatory.length ? "rerecord" : review.length ? "review" : "ok",
    syncReason: reasons.join("；"),
    requiresRerecord: mandatory.length > 0,
    syncOnsetErrorSec: onsetErrorSec,
    syncOverrunSec: overrunSec,
  });
  return segment;
}

function reflowShowcaseTimeline(segments) {
  let previousVoicePlaybackEnd = Number.NEGATIVE_INFINITY;
  segments.forEach((segment) => {
    const baseStart = Number(segment.start) || 0;
    if (segment.requiresRerecord) {
      Object.assign(segment, {
        mixStart: baseStart,
        fitRate: 1,
        playbackEnd: baseStart,
        timelineDelay: 0,
        extendedPastCueSeconds: 0,
        activeSpeechTrimmedSeconds: 0,
      });
      return;
    }
    const cueEnd = Math.max(baseStart + 0.08, Number(segment.cueEnd) || Number(segment.end) || baseStart + 0.08);
    const hasDecodedAudio = Number.isFinite(Number(segment.sourceDuration))
      && Number(segment.sourceDuration) > 0;
    const sourceDuration = hasDecodedAudio
      ? Number(segment.sourceDuration)
      : Math.max(0.08, cueEnd - baseStart);
    const isSoundEffect = Boolean(segment.isSoundEffect);
    const mixStart = isSoundEffect
      ? baseStart
      : Math.max(
        baseStart,
        Number.isFinite(previousVoicePlaybackEnd)
          ? previousVoicePlaybackEnd + SHOWCASE_CLIP_GAP_SECONDS
          : baseStart,
      );
    const playbackEnd = mixStart + sourceDuration;

    Object.assign(segment, {
      mixStart,
      fitRate: 1,
      playbackEnd,
      timelineDelay: Math.max(0, mixStart - baseStart),
      extendedPastCueSeconds: Math.max(0, playbackEnd - cueEnd),
      activeSpeechTrimmedSeconds: 0,
    });
    if (!isSoundEffect) previousVoicePlaybackEnd = playbackEnd;
  });
  return segments;
}

function calibrateShowcaseSegment(segment, buffer) {
  const analysis = analyzeShowcaseBuffer(buffer);
  const sourceOffset = 0;
  const sourceEnd = analysis.active
    ? Math.max(0.04, analysis.activeEnd)
    : Number(buffer.duration) || 0;
  const sourceDuration = Math.max(0.04, sourceEnd - sourceOffset);
  let normalizationGain = 1;
  if (analysis.active && analysis.rms > 0.0005) {
    normalizationGain = 0.095 / analysis.rms;
    if (analysis.peak > 0.0005) normalizationGain = Math.min(normalizationGain, 0.86 / analysis.peak);
    normalizationGain = clampShowcaseValue(normalizationGain, 0.35, 2.4);
  }

  Object.assign(segment, {
    audioDuration: Number(buffer.duration) || 0,
    sourceOffset,
    sourceDuration,
    normalizationGain,
    activeRms: analysis.rms,
    activePeak: analysis.peak,
    preservedLeadInSeconds: analysis.active ? analysis.activeStart : 0,
    trimmedLeadingSeconds: 0,
    trimmedTrailingSeconds: Math.max(0, (Number(buffer.duration) || 0) - sourceOffset - sourceDuration),
  });
  diagnoseShowcaseSegment(segment, analysis);
  reflowShowcaseTimeline([segment]);
  return segment;
}

function ensureShowcaseOutput(player) {
  if (player.outputGain) return player.outputGain;
  const context = getShowcaseAudioContext();
  const outputGain = context.createGain();
  outputGain.gain.value = 0.96;
  const compressor = typeof context.createDynamicsCompressor === "function"
    ? context.createDynamicsCompressor()
    : null;
  if (compressor) {
    compressor.threshold.value = -14;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    outputGain.connect(compressor);
    compressor.connect(context.destination);
  } else {
    outputGain.connect(context.destination);
  }
  player.outputGain = outputGain;
  player.outputCompressor = compressor;
  return outputGain;
}

function stopShowcaseSources(player) {
  if (!player) return;
  player.playbackGeneration += 1;
  player.scheduledSources.forEach((entry) => {
    entry.source.onended = null;
    try { entry.source.stop(); } catch {}
    try { entry.source.disconnect(); } catch {}
    try { entry.gainNode?.disconnect(); } catch {}
  });
  player.scheduledSources.clear();
}

function stopShowcasePlayer(player) {
  if (!player) return;
  cancelAnimationFrame(player.frame);
  player.frame = 0;
  stopShowcaseSources(player);
  player.waiting = false;
  player.button.innerHTML = '<span aria-hidden="true">▶</span><span>播放合成</span>';
}

function clearShowcasePlayers() {
  portalState.showcasePlayers.forEach((player) => {
    player.video.pause();
    stopShowcasePlayer(player);
    try { player.outputGain?.disconnect(); } catch {}
    try { player.outputCompressor?.disconnect(); } catch {}
  });
  portalState.showcasePlayers.clear();
}

async function loadShowcaseAudio(resultKey) {
  if (portalState.showcaseAudioCache.has(resultKey)) return portalState.showcaseAudioCache.get(resultKey);
  const request = queueRecordingAudioRequest(() => platformRequest("groupShowcaseClip", {
    token: portalState.session.session.token,
    resultKey,
  })).then(async (response) => {
    const context = getShowcaseAudioContext();
    const blob = audioBlobFromBase64(response.audioBase64, response.mimeType);
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("錄音內容無法播放。");
    return buffer;
  })
    .catch((error) => {
      portalState.showcaseAudioCache.delete(resultKey);
      throw error;
    });
  portalState.showcaseAudioCache.set(resultKey, request);
  return request;
}

async function ensureShowcaseSegmentAudio(player, segment) {
  if (player.audioBuffers.has(segment.resultKey)) return player.audioBuffers.get(segment.resultKey);
  if (!player.audioPromises.has(segment.resultKey)) {
    const request = loadShowcaseAudio(segment.resultKey).then((buffer) => {
      player.audioBuffers.set(segment.resultKey, buffer);
      calibrateShowcaseSegment(segment, buffer);
      reflowShowcaseTimeline(player.segments);
      renderShowcaseSyncAlert(player);
      segment.loadError = false;
      segment.retryAudioAt = 0;
      player.audioPromises.delete(segment.resultKey);
      return buffer;
    }).catch((error) => {
      player.audioPromises.delete(segment.resultKey);
      segment.loadError = true;
      segment.retryAudioAt = Date.now() + 5000;
      throw error;
    });
    player.audioPromises.set(segment.resultKey, request);
  }
  return player.audioPromises.get(segment.resultKey);
}

async function prepareShowcaseWindow(player, currentTime, lookAhead = SHOWCASE_PREFETCH_LOOKAHEAD_SECONDS) {
  const upcoming = player.segments.filter((segment) => (
    !segment.requiresRerecord
    &&
    (segment.playbackEnd || segment.end) >= currentTime - 0.5
    && (segment.mixStart ?? segment.start) <= currentTime + lookAhead
  ));
  await Promise.allSettled(upcoming.map((segment) => ensureShowcaseSegmentAudio(player, segment)));
}

function activeShowcaseSegments(player, time) {
  return player.segments.filter((segment) => (
    !segment.requiresRerecord
    &&
    time >= (segment.mixStart ?? segment.start) - 0.08
    && time < (segment.playbackEnd || segment.end)
  ));
}

function scheduleShowcaseSegment(player, segment) {
  if (segment.requiresRerecord
      || player.scheduledSources.has(segment.resultKey)
      || player.schedulePromises.has(segment.resultKey)
      || player.finishedSources.get(segment.resultKey) === player.playbackGeneration
      || Number(segment.retryAudioAt) > Date.now()) return;
  const generation = player.playbackGeneration;
  const request = ensureShowcaseSegmentAudio(player, segment).then((buffer) => {
    if (generation !== player.playbackGeneration || player.video.paused || player.video.ended || player.waiting) return;
    const videoTime = player.video.currentTime;
    const playbackEnd = segment.playbackEnd || segment.end;
    const mixStart = segment.mixStart ?? segment.start;
    const timelineOffset = Math.max(0, videoTime - mixStart);
    const sourceStart = Number(segment.sourceOffset) || 0;
    const sourceEnd = Math.min(buffer.duration, sourceStart + (Number(segment.sourceDuration) || buffer.duration));
    const sourceOffset = sourceStart + timelineOffset;
    const delay = Math.max(0, mixStart - videoTime);
    if (videoTime >= playbackEnd || sourceOffset >= sourceEnd - 0.01) {
      player.finishedSources.set(segment.resultKey, generation);
      return;
    }
    if (delay > SHOWCASE_SCHEDULE_LOOKAHEAD_SECONDS + 0.5) return;

    const context = getShowcaseAudioContext();
    const source = context.createBufferSource();
    const gainNode = context.createGain();
    const startAt = context.currentTime + (delay || 0.015);
    const sourceDuration = sourceEnd - sourceOffset;
    const sourceRate = 1;
    const outputDuration = sourceDuration;
    const fadeIn = Math.min(0.025, outputDuration * 0.2);
    const fadeOut = Math.min(0.075, outputDuration * 0.25);
    const gain = clampShowcaseValue(segment.normalizationGain || 1, 0.35, 2.4);
    source.buffer = buffer;
    source.playbackRate.value = 1;
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(gain, startAt + fadeIn);
    gainNode.gain.setValueAtTime(gain, Math.max(startAt + fadeIn, startAt + outputDuration - fadeOut));
    gainNode.gain.linearRampToValueAtTime(0, startAt + outputDuration);
    source.connect(gainNode);
    gainNode.connect(ensureShowcaseOutput(player));
    const entry = {
      source,
      gainNode,
      segment,
      startAt,
      sourceOffset,
      sourceRate,
      fitRate: 1,
      playbackRate: 1,
    };
    source.onended = () => {
      if (player.scheduledSources.get(segment.resultKey) === entry) {
        player.scheduledSources.delete(segment.resultKey);
        player.finishedSources.set(segment.resultKey, generation);
      }
      try { source.disconnect(); } catch {}
      try { gainNode.disconnect(); } catch {}
      if (player.video.ended && player.scheduledSources.size === 0) {
        player.status.textContent = "本次驗收播放完成";
        player.button.disabled = false;
        player.button.innerHTML = '<span aria-hidden="true">▶</span><span>重新播放</span>';
      }
    };
    player.scheduledSources.set(segment.resultKey, entry);
    source.start(startAt, sourceOffset, sourceDuration);
  }).catch(() => {}).finally(() => {
    if (player.schedulePromises.get(segment.resultKey) === request) {
      player.schedulePromises.delete(segment.resultKey);
    }
  });
  player.schedulePromises.set(segment.resultKey, request);
}

function correctShowcaseDrift(player, videoTime) {
  const context = portalState.showcaseAudioContext;
  if (!context || context.state !== "running" || context.currentTime - player.lastDriftCheck < 1) return;
  player.lastDriftCheck = context.currentTime;
  const entry = [...player.scheduledSources.values()].find((candidate) => (
    context.currentTime >= candidate.startAt
    && videoTime >= (candidate.segment.mixStart ?? candidate.segment.start)
    && videoTime < (candidate.segment.playbackEnd || candidate.segment.end)
  ));
  if (!entry) return;
  const audioOffset = entry.sourceOffset + Math.max(0, context.currentTime - entry.startAt) * entry.sourceRate;
  const expectedOffset = (Number(entry.segment.sourceOffset) || 0)
    + Math.max(0, videoTime - (entry.segment.mixStart ?? entry.segment.start));
  if (Math.abs(audioOffset - expectedOffset) > 0.4) stopShowcaseSources(player);
}

function syncShowcasePlayer(player) {
  if (player.video.paused || player.video.ended || player.waiting) return;
  const time = player.video.currentTime;
  const active = activeShowcaseSegments(player, time);
  player.segments
    .filter((segment) => (
      time < (segment.playbackEnd || segment.end)
      && (segment.mixStart ?? segment.start) <= time + SHOWCASE_SCHEDULE_LOOKAHEAD_SECONDS
    ))
    .forEach((segment) => scheduleShowcaseSegment(player, segment));
  correctShowcaseDrift(player, time);
  if (active.length) {
    const labels = active.map((segment) => segment.studentName
      ? `${segment.role}｜${segment.studentName}`
      : segment.role);
    player.status.textContent = active.some((segment) => segment.loadError)
      ? "有錄音載入失敗，請暫停後再播放"
      : labels.join("＋");
  } else {
    player.status.textContent = "目前區段尚無錄音";
  }
  if (!player.prefetchAt || time > player.prefetchAt) {
    player.prefetchAt = time + 8;
    prepareShowcaseWindow(player, time).catch(() => {});
  }
  player.frame = requestAnimationFrame(() => syncShowcasePlayer(player));
}

async function toggleShowcasePlayback(showcaseId) {
  const player = portalState.showcasePlayers.get(showcaseId);
  if (!player || player.preparing) return;
  if (!player.video.paused) {
    player.video.pause();
    return;
  }
  player.preparing = true;
  player.button.disabled = true;
  player.status.textContent = "正在載入目前片段";
  try {
    portalState.showcasePlayers.forEach((otherPlayer) => {
      if (otherPlayer !== player && !otherPlayer.video.paused) otherPlayer.video.pause();
    });
    const context = getShowcaseAudioContext();
    ensureShowcaseOutput(player);
    const resume = context.resume();
    await Promise.all([resume, prepareShowcaseWindow(player, player.video.currentTime, 4)]);
    prepareShowcaseWindow(player, player.video.currentTime).catch(() => {});
    if (context.state !== "running") throw new Error("請再按一次播放以啟用聲音。");
    player.video.muted = true;
    await player.video.play();
  } catch (error) {
    player.status.textContent = error.message || "目前無法播放合成成果";
  } finally {
    player.preparing = false;
    player.button.disabled = false;
  }
}

function showcaseMemberList(showcase) {
  if (!showcase.members?.length) return "";
  const showScores = showcase.canSeeMemberScores
    ?? (showcase.isOwnGroup || portalState.session?.account?.type === "teacher");
  return renderMemberRanking(showcase.members, {
    showScores,
    listClass: "showcase-member-list",
    reviewable: portalState.session?.account?.type === "teacher",
  });
}

function renderShowcaseSyncAlert(player) {
  if (!player?.alert) return;
  const mandatory = player.segments.filter((segment) => segment.requiresRerecord);
  const review = player.segments.filter((segment) => !segment.requiresRerecord && segment.syncStatus === "review");
  const flagged = mandatory.length ? mandatory : review;
  player.alert.hidden = flagged.length === 0;
  if (!flagged.length) {
    player.alert.replaceChildren();
    return;
  }
  const heading = mandatory.length
    ? `${mandatory.length} 段時間軸未通過，已暫停加入合成`
    : `${review.length} 段時間軸建議複核`;
  const items = flagged.map((segment) => {
    const student = segment.studentName ? `${segment.studentName} · ` : "";
    return `<li><strong>${escapePortalHtml(student)}${escapePortalHtml(segment.role)} · 第 ${segment.lineIndex} 段</strong><span>${escapePortalHtml(segment.syncReason || "錄音與影片時間軸有差異")}</span></li>`;
  }).join("");
  player.alert.className = `showcase-sync-alert${mandatory.length ? " is-rerecord" : ""}`;
  player.alert.innerHTML = `<div><strong>${escapePortalHtml(heading)}</strong><span>${mandatory.length ? "請由負責同學重新錄音；修正後會自動回到合成影片。" : "目前仍可播放，建議老師搭配原片確認。"}</span></div><ul>${items}</ul>`;
}

async function renderGroupShowcases(showcases, container) {
  clearShowcasePlayers();
  container.replaceChildren();
  if (!showcases.length) {
    container.innerHTML = '<div class="empty-state"><strong>尚無可驗收的小組成果</strong></div>';
    return;
  }
  for (const showcase of showcases) {
    const data = await fetchWorkData(showcase.workSlug);
    const orderedLines = [...data.lines].sort((left, right) => left.start - right.start || left.index - right.index);
    const lineMap = new Map(orderedLines.map((line, index) => [
      Number(line.index),
      { line, nextLine: orderedLines[index + 1] || null },
    ]));
    const segments = (showcase.segments || []).map((segment) => {
      const lineEntry = lineMap.get(Number(segment.lineIndex));
      const line = lineEntry?.line;
      const nextLine = lineEntry?.nextLine;
      const duration = Number(data.duration) || Infinity;
      if (!line) return null;
      const nextCueBoundary = nextLine && nextLine.start >= line.end
        ? nextLine.start - SHOWCASE_CLIP_GAP_SECONDS
        : nextLine ? line.end : duration;
      const windowEnd = Math.min(duration, Math.max(line.end, nextCueBoundary));
      const expectedEvents = (Array.isArray(line.soundEvents) ? line.soundEvents : []).map((event) => ({
        start: Math.max(0, Number(event.start) - Number(line.start)),
        end: Math.max(0.1, Number(event.end) - Number(line.start)),
      }));
      return {
        ...segment,
        start: line.start,
        mixStart: line.start,
        cueEnd: line.end,
        windowEnd,
        end: windowEnd,
        playbackEnd: windowEnd,
        isSoundEffect: Boolean(line.isSoundEffect),
        expectedDuration: Math.max(0.1, Number(line.end) - Number(line.start)),
        expectedOnset: expectedEvents.length
          ? expectedEvents[0].start
          : Math.max(0, Number(line.cueStart ?? line.start) - Number(line.start)),
        expectedEvents,
      };
    }).filter(Boolean).sort((left, right) => left.start - right.start);
    reflowShowcaseTimeline(segments);
    const article = document.createElement("article");
    article.className = `showcase-card${showcase.isOwnGroup ? " is-own-group" : ""}`;
    article.dataset.showcaseId = showcase.showcaseId;
    article.innerHTML = `
      <header class="showcase-heading">
        <div><span>${escapePortalHtml(showcase.groupName)}${showcase.isOwnGroup ? '<b class="own-group-label">我的組別</b>' : ""}</span><h3>${escapePortalHtml(showcase.workTitle)}</h3></div>
        <strong>${masteryText(showcase.completionRate)}</strong>
      </header>
      <div class="showcase-sync-alert" role="alert" hidden></div>
      <div class="showcase-video-shell">
        <video muted playsinline preload="metadata" poster="${escapePortalHtml(posterUrl(showcase.workSlug))}"></video>
        <div class="showcase-now" role="status">${segments.length ? "準備播放" : "尚無錄音片段"}</div>
      </div>
      <div class="showcase-controls">
        <button class="primary-button showcase-play-button" type="button" data-showcase-id="${escapePortalHtml(showcase.showcaseId)}" ${segments.some((segment) => !segment.requiresRerecord) ? "" : "disabled"}><span aria-hidden="true">▶</span><span>播放合成</span></button>
        <span>${showcase.recordedSegments} / ${showcase.totalSegments} 段</span>
      </div>
      <div class="progress-track" aria-label="小組完成度 ${masteryText(showcase.completionRate)}"><span style="width:${Math.max(0, Math.min(100, Number(showcase.completionRate) || 0))}%"></span></div>
      ${showcaseMemberList(showcase)}`;
    const video = article.querySelector("video");
    const button = article.querySelector(".showcase-play-button");
    const status = article.querySelector(".showcase-now");
    const alert = article.querySelector(".showcase-sync-alert");
    video.src = new URL(data.video, window.QA_CONFIG.productionSiteBase).href;
    video.muted = true;
    video.defaultPlaybackRate = 1;
    video.playbackRate = 1;
    video.controls = true;
    const player = {
      showcase,
      segments,
      duration: Number(data.duration) || Infinity,
      video,
      button,
      status,
      alert,
      frame: 0,
      preparing: false,
      prefetchAt: 0,
      waiting: false,
      playbackGeneration: 0,
      lastDriftCheck: 0,
      audioBuffers: new Map(),
      audioPromises: new Map(),
      scheduledSources: new Map(),
      schedulePromises: new Map(),
      finishedSources: new Map(),
      outputGain: null,
      outputCompressor: null,
    };
    portalState.showcasePlayers.set(showcase.showcaseId, player);
    renderShowcaseSyncAlert(player);
    button.addEventListener("click", () => toggleShowcasePlayback(showcase.showcaseId));
    video.addEventListener("play", () => {
      video.muted = true;
      video.playbackRate = 1;
      player.waiting = false;
      getShowcaseAudioContext().resume().catch(() => {
        status.textContent = "請再按一次播放以啟用聲音";
      });
      portalState.showcasePlayers.forEach((otherPlayer) => {
        if (otherPlayer !== player && !otherPlayer.video.paused) otherPlayer.video.pause();
      });
      button.innerHTML = '<span aria-hidden="true">Ⅱ</span><span>暫停</span>';
      cancelAnimationFrame(player.frame);
      player.frame = requestAnimationFrame(() => syncShowcasePlayer(player));
    });
    video.addEventListener("pause", () => {
      if (video.ended && player.scheduledSources.size > 0) {
        cancelAnimationFrame(player.frame);
        player.frame = 0;
        player.status.textContent = "影片已到尾端，正在播放完整句尾";
        player.button.disabled = true;
        player.button.innerHTML = '<span aria-hidden="true">Ⅱ</span><span>句尾播放中</span>';
        return;
      }
      stopShowcasePlayer(player);
    });
    video.addEventListener("waiting", () => {
      player.waiting = true;
      stopShowcaseSources(player);
      status.textContent = "影片緩衝中，聲音會自動接回";
    });
    video.addEventListener("playing", () => {
      player.waiting = false;
      cancelAnimationFrame(player.frame);
      player.frame = requestAnimationFrame(() => syncShowcasePlayer(player));
    });
    video.addEventListener("seeking", () => {
      player.waiting = true;
      stopShowcaseSources(player);
    });
    video.addEventListener("seeked", () => {
      player.waiting = false;
      prepareShowcaseWindow(player, video.currentTime).then(() => {
        if (!video.paused) {
          cancelAnimationFrame(player.frame);
          player.frame = requestAnimationFrame(() => syncShowcasePlayer(player));
        }
      }).catch(() => {});
    });
    video.addEventListener("ratechange", () => {
      if (Math.abs(video.playbackRate - 1) > 0.001) {
        video.playbackRate = 1;
        status.textContent = "合成成果固定使用原始速度";
        return;
      }
      stopShowcaseSources(player);
      if (!video.paused) {
        cancelAnimationFrame(player.frame);
        player.frame = requestAnimationFrame(() => syncShowcasePlayer(player));
      }
    });
    video.addEventListener("ended", () => {
      if (player.scheduledSources.size > 0) {
        status.textContent = "影片已到尾端，正在播放完整句尾";
        button.disabled = true;
      } else {
        status.textContent = "本次驗收播放完成";
      }
    });
    video.addEventListener("volumechange", () => { video.muted = true; });
    container.append(article);
  }
}

async function loadGroupShowcases(target) {
  const student = target === "student";
  const container = student ? portalElements.studentShowcaseList : portalElements.teacherShowcaseList;
  const section = student ? portalElements.studentShowcaseSection : portalElements.showcasePanel;
  if (!container || !section) return;
  if (student) section.hidden = false;
  container.innerHTML = '<div class="empty-state"><strong>載入小組成果中</strong></div>';
  try {
    const response = await platformRequest("groupShowcases", { token: portalState.session.session.token });
    portalState.showcases = response.showcases || [];
    if (student) portalElements.studentShowcaseUpdated.textContent = `${portalState.showcases.length} 組成果`;
    await renderGroupShowcases(portalState.showcases, container);
  } catch (error) {
    handleSessionError(error);
    container.innerHTML = `<div class="empty-state"><strong>成果載入失敗</strong><span>${escapePortalHtml(error.message)}</span></div>`;
  }
}

function populatePreferenceWorks() {
  if (portalElements.preferenceWork.options.length) return;
  (window.QA_WORKS || []).forEach((work) => {
    const option = document.createElement("option");
    option.value = work.slug;
    option.textContent = work.title;
    portalElements.preferenceWork.append(option);
  });
}

async function updatePreferenceRoles(preferredRoles = []) {
  const work = (window.QA_WORKS || []).find((item) => item.slug === portalElements.preferenceWork.value);
  portalElements.preferencePoster.src = posterUrl(portalElements.preferenceWork.value);
  portalElements.preferencePoster.alt = work?.title || "配音作品";
  portalElements.preferenceRoles.innerHTML = '<span class="role-loading">載入角色中</span>';
  const data = await fetchWorkData(portalElements.preferenceWork.value);
  const selected = new Set(Array.isArray(preferredRoles) ? preferredRoles : [preferredRoles]);
  const fragment = document.createDocumentFragment();
  data.roles.forEach((role) => {
    const label = document.createElement("label");
    label.className = `preference-role-option${role.isSoundEffect ? " is-sound-effect" : ""}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "preferenceRole";
    input.value = role.role;
    input.checked = selected.has(role.role);
    const name = document.createElement("strong");
    name.textContent = role.role;
    const count = document.createElement("small");
    count.textContent = role.isSoundEffect ? role.cueTime : `${role.lineCount} 句`;
    label.append(input, name, count);
    fragment.append(label);
  });
  portalElements.preferenceRoles.replaceChildren(fragment);
}

async function openPreferenceDialog(required = false) {
  portalState.setupRequired = required;
  portalElements.preferenceClose.hidden = required;
  portalElements.preferenceMessage.textContent = "";
  populatePreferenceWorks();
  const profile = portalState.session?.account?.profile;
  if (profile?.workSlug) portalElements.preferenceWork.value = profile.workSlug;
  await updatePreferenceRoles(profileRoles(profile));
  if (!portalElements.preferenceDialog.open) portalElements.preferenceDialog.showModal();
}

async function handlePreferenceSubmit(event) {
  event.preventDefault();
  const roles = [...portalElements.preferenceRoles.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value);
  if (!roles.length) {
    portalElements.preferenceMessage.textContent = "請至少選擇一個角色。";
    return;
  }
  const button = event.submitter;
  setBusy(button, true, "儲存中");
  portalElements.preferenceMessage.textContent = "";
  try {
    const response = await platformRequest("setStudentPreference", {
      token: portalState.session.session.token,
      workSlug: portalElements.preferenceWork.value,
      roles,
    });
    saveSession({
      session: portalState.session.session,
      account: { ...portalState.session.account, profile: response.profile },
    });
    portalState.setupRequired = false;
    portalElements.preferenceDialog.close();
    await showStudentDashboard();
  } catch (error) {
    handleSessionError(error);
    portalElements.preferenceMessage.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function renderStudentTasks(tasks) {
  portalElements.taskList.replaceChildren();
  portalElements.studentEmpty.hidden = tasks.length > 0;
  const overdue = tasks.filter((task) => task.overdue && !task.achieved && task.completed < task.requiredCount).length;
  portalElements.studentNotice.hidden = overdue === 0;
  portalElements.studentNotice.textContent = overdue ? `有 ${overdue} 項要求已到截止日，仍可繼續練習。` : "";

  tasks.forEach((task) => {
    const masteryGoal = task.goalMode === "mastery_target";
    const complete = masteryGoal ? Boolean(task.achieved) : task.completed >= task.requiredCount;
    const rerecordCount = Object.values(task.lineResults || {}).filter((result) => result.requiresRerecord).length;
    const article = document.createElement("article");
    article.className = "task-item";
    const demoParam = portalState.demo ? "&demo=1" : "";
    let linkedTask = task;
    let href;
    let detail;
    let progressLabel;
    let actionLabel;
    let actionHint;
    if (masteryGoal) {
      linkedTask = portalState.selfPractice[0] || null;
      const next = linkedTask ? nextPracticeLine(linkedTask) : 1;
      href = linkedTask
        ? `index.html?work=${encodeURIComponent(linkedTask.workSlug)}&practice=1&role=${encodeURIComponent(linkedTask.role)}${demoParam}#line-${next}`
        : "#";
      detail = `目前 ${masteryText(task.currentMastery)} · 目標 ${masteryText(task.targetPercent)} · 截止 ${displayDate(task.dueDate)}`;
      progressLabel = complete ? "已達成今日完成度" : `還差 ${masteryText(Math.max(0, task.targetPercent - task.currentMastery))}`;
      actionLabel = complete ? "繼續精進" : "前往練習";
      actionHint = linkedTask ? `從 ${linkedTask.role} 開始` : "請先設定角色";
    } else {
      const firstIncomplete = task.lineIndices.find((index) => task.lineResults?.[index]?.requiresRerecord)
        || task.lineIndices.find((index) => !task.lineResults?.[index]?.achieved)
        || task.lineIndices[0];
      href = `index.html?work=${encodeURIComponent(task.workSlug)}&assignment=${encodeURIComponent(task.assignmentId)}${demoParam}#line-${firstIncomplete}`;
      const scoreGoal = task.targetScore == null ? "完成指定句" : `每句至少 ${task.targetScore} 分`;
      detail = `${task.workTitle} · ${task.role} · ${scoreGoal} · 截止 ${displayDate(task.dueDate)}${rerecordCount ? ` · ${rerecordCount} 句需重新錄音` : ""}`;
      progressLabel = `${task.completed} / ${task.requiredCount} 句達標`;
      actionLabel = rerecordCount ? "前往重錄" : complete ? "再次練習" : task.completed ? "繼續練習" : "開始練習";
      actionHint = rerecordCount ? "時間軸未通過" : complete ? "可重錄更新最後版本" : `尚餘 ${task.requiredCount - task.completed} 句`;
    }
    article.innerHTML = `
      <img class="task-poster" src="${escapePortalHtml(posterUrl(task.workSlug || portalState.session.account.profile?.workSlug))}" alt="${escapePortalHtml(task.workTitle || portalState.session.account.profile?.workTitle || "配音作品")}">
      <div class="task-content">
        <div class="task-topline"><strong>${escapePortalHtml(task.title)}</strong><span class="task-role">${masteryGoal ? "整體完成度" : escapePortalHtml(task.role)}</span>${rerecordCount ? `<span class="status-badge is-overdue">${rerecordCount} 句需重錄</span>` : task.overdue && !complete ? '<span class="status-badge is-overdue">已到期</span>' : complete ? '<span class="status-badge">已達標</span>' : ""}</div>
        <p>${escapePortalHtml(detail)}</p>
        <div class="progress-track" aria-label="完成率 ${task.completionRate}%"><span style="width:${Math.max(0, Math.min(100, task.completionRate))}%"></span></div>
        <div class="task-progress-label">${escapePortalHtml(progressLabel)}</div>
      </div>
      <div class="task-action"><a href="${escapePortalHtml(href)}" ${linkedTask ? "" : 'aria-disabled="true"'}>${escapePortalHtml(actionLabel)}</a><span>${escapePortalHtml(actionHint)}</span></div>`;
    article.querySelector("a").addEventListener("click", () => {
      if (linkedTask) localStorage.setItem(platformConfig.taskKey, JSON.stringify(linkedTask));
    });
    portalElements.taskList.append(article);
  });
}

function nextPracticeLine(task) {
  const rerecord = task.lineIndices.find((index) => task.lineResults?.[index]?.requiresRerecord);
  if (rerecord) return rerecord;
  const unpracticed = task.lineIndices.find((index) => !task.lineResults?.[index]);
  if (unpracticed) return unpracticed;
  return task.lineIndices.slice().sort((left, right) => Number(task.lineResults?.[left]?.score || 0) - Number(task.lineResults?.[right]?.score || 0))[0]
    || task.lineIndices[0];
}

function renderSelfPractice(practices) {
  portalElements.selfPracticeSection.hidden = practices.length === 0;
  portalElements.selfPracticeCount.textContent = `${practices.length} 個角色`;
  portalElements.selfPracticeList.replaceChildren();
  practices.forEach((task) => {
    const next = nextPracticeLine(task);
    const rerecordCount = Object.values(task.lineResults || {}).filter((result) => result.requiresRerecord).length;
    const demoParam = portalState.demo ? "&demo=1" : "";
    const article = document.createElement("article");
    article.className = "self-practice-item";
    article.innerHTML = `<div class="self-practice-copy">
      <h3>${escapePortalHtml(task.role)}</h3>
      <p>${task.completed} / ${task.requiredCount} 句已練 · 熟練度 ${masteryText(task.masteryPercent)}${rerecordCount ? ` · ${rerecordCount} 句需重新錄音` : ""}</p>
      <div class="progress-track" aria-label="熟練度 ${masteryText(task.masteryPercent)}"><span style="width:${Math.max(0, Math.min(100, Number(task.masteryPercent) || 0))}%"></span></div>
    </div>
    <div class="self-practice-action"><a href="index.html?work=${encodeURIComponent(task.workSlug)}&practice=1&role=${encodeURIComponent(task.role)}${demoParam}#line-${next}">${rerecordCount ? "前往重錄" : task.completed ? "繼續練習" : "開始練習"}</a><span>第 ${next} 句${rerecordCount ? " · 時間軸未通過" : ""}</span></div>`;
    article.querySelector("a").addEventListener("click", () => {
      localStorage.setItem(platformConfig.taskKey, JSON.stringify(task));
    });
    portalElements.selfPracticeList.append(article);
  });
}

async function showTeacherDashboard() {
  const { account } = portalState.session;
  showAuthenticatedShell(account.name || "老師");
  portalElements.studentView.hidden = true;
  portalElements.teacherView.hidden = false;
  setTeacherDates();
  populateWorkSelect();
  syncAssignmentGoalMode();
  await refreshTeacherData();
  await loadGroupShowcases("teacher");
}

function setTeacherDates() {
  const today = taipeiDate();
  portalElements.assignedDate.value ||= today;
  portalElements.dueDate.value ||= today;
}

function selectedAssignmentGoalMode() {
  return document.querySelector('input[name="assignmentGoalMode"]:checked')?.value || "mastery_target";
}

function syncAssignmentGoalMode() {
  const mastery = selectedAssignmentGoalMode() === "mastery_target";
  portalElements.masteryGoalFields.hidden = !mastery;
  portalElements.lineGoalFields.hidden = mastery;
  portalElements.targetPercent.disabled = !mastery;
  portalElements.targetPercent.required = mastery;
  [portalElements.assignmentWork, portalElements.assignmentRole, portalElements.assignmentStart, portalElements.assignmentCount, portalElements.targetScore]
    .forEach((element) => {
      element.disabled = mastery;
      element.required = !mastery;
    });
  if (!portalElements.assignmentTitle.value) {
    portalElements.assignmentTitle.placeholder = mastery
      ? `例如：${displayDate(portalElements.assignedDate.value)} 熟練度達 ${portalElements.targetPercent.value}%`
      : "例如：琪琪每句達 80 分";
  }
  updateLinePreview();
}

function populateWorkSelect() {
  if (portalElements.assignmentWork.options.length) return;
  (window.QA_WORKS || []).forEach((work) => {
    const option = document.createElement("option");
    option.value = work.slug;
    option.textContent = work.title;
    portalElements.assignmentWork.append(option);
  });
  updateWorkRoles();
}

async function fetchWorkData(slug) {
  if (portalState.workData.has(slug)) return portalState.workData.get(slug);
  const release = encodeURIComponent(window.QA_RELEASE || "latest");
  const response = await fetch(`data/${encodeURIComponent(slug)}.json?v=${release}`, { cache: "no-store" });
  if (!response.ok) throw new Error("作品台詞資料載入失敗。");
  const raw = await response.json();
  const data = window.extendWorkDataWithSoundEffects?.(raw) || raw;
  portalState.workData.set(slug, data);
  return data;
}

async function updateWorkRoles() {
  try {
    const data = await fetchWorkData(portalElements.assignmentWork.value);
    portalElements.assignmentRole.innerHTML = '<option value="">選擇角色</option>';
    data.roles.forEach((role) => {
      const option = document.createElement("option");
      option.value = role.role;
      option.textContent = role.isSoundEffect ? role.role : `${role.role}（${role.lineCount} 句）`;
      portalElements.assignmentRole.append(option);
    });
    portalElements.assignmentStart.innerHTML = '<option value="">請先選角色</option>';
    portalState.selectedRoleLines = [];
    updateLinePreview();
  } catch (error) {
    portalElements.assignmentMessage.textContent = error.message;
  }
}

async function updateRoleLines() {
  const data = await fetchWorkData(portalElements.assignmentWork.value);
  portalState.selectedRoleLines = data.lines.filter((line) => line.role === portalElements.assignmentRole.value);
  portalElements.assignmentStart.innerHTML = "";
  portalState.selectedRoleLines.forEach((line, position) => {
    const option = document.createElement("option");
    option.value = String(position);
    option.textContent = line.isSoundEffect
      ? `${line.cueTime}｜${line.soundName}`
      : `角色第 ${position + 1} 句（原片第 ${line.index} 句）`;
    portalElements.assignmentStart.append(option);
  });
  portalElements.assignmentCount.max = String(Math.min(30, portalState.selectedRoleLines.length));
  if (Number(portalElements.assignmentCount.value) > portalState.selectedRoleLines.length) {
    portalElements.assignmentCount.value = String(Math.min(5, portalState.selectedRoleLines.length));
  }
  if (selectedAssignmentGoalMode() === "line_score" && !portalElements.assignmentTitle.value && portalElements.assignmentRole.value) {
    portalElements.assignmentTitle.value = `${displayDate(portalElements.assignedDate.value)} ${portalElements.assignmentRole.value}台詞練習`;
  }
  updateLinePreview();
}

function selectedAssignmentLines() {
  const start = Math.max(0, Number(portalElements.assignmentStart.value) || 0);
  const count = Math.max(1, Number(portalElements.assignmentCount.value) || 1);
  return portalState.selectedRoleLines.slice(start, start + count);
}

function updateLinePreview() {
  if (selectedAssignmentGoalMode() === "mastery_target") {
    const target = Math.max(1, Math.min(100, Number(portalElements.targetPercent.value) || 80));
    portalElements.assignmentLineCount.textContent = `完成度目標 ${target}%`;
    return;
  }
  const lines = selectedAssignmentLines();
  portalElements.assignmentLineCount.textContent = lines.length ? `將指定 ${lines.length} 句` : "尚未選擇";
  if (!lines.length) {
    portalElements.linePreview.innerHTML = "選擇角色後顯示台詞範圍。";
    return;
  }
  portalElements.linePreview.innerHTML = `<ul>${lines.map((line) => `<li><span>${escapePortalHtml(line.isSoundEffect ? line.cueTime : `第 ${line.index} 句`)}</span><span lang="ja">${escapePortalHtml(line.japanese)}</span></li>`).join("")}</ul>`;
}

async function handleAssignmentSubmit(event) {
  event.preventDefault();
  const goalMode = selectedAssignmentGoalMode();
  const lines = goalMode === "line_score" ? selectedAssignmentLines() : [];
  if (goalMode === "line_score" && !lines.length) {
    portalElements.assignmentMessage.textContent = "請先選擇角色與句數。";
    return;
  }
  const button = event.submitter;
  setBusy(button, true, "發派中");
  portalElements.assignmentMessage.textContent = "";
  try {
    const response = await platformRequest("createAssignment", {
      token: portalState.session.session.token,
      assignment: {
        title: portalElements.assignmentTitle.value.trim(),
        targetClass: portalElements.targetClass.value.trim(),
        assignedDate: portalElements.assignedDate.value,
        dueDate: portalElements.dueDate.value,
        goalMode,
        targetPercent: Number(portalElements.targetPercent.value),
        targetScore: Number(portalElements.targetScore.value),
        workSlug: goalMode === "line_score" ? portalElements.assignmentWork.value : "",
        role: goalMode === "line_score" ? portalElements.assignmentRole.value : "",
        lineIndices: lines.map((line) => line.index),
      },
    });
    showToast(`已發派「${response.title}」`);
    portalElements.assignmentTitle.value = "";
    await refreshTeacherData();
  } catch (error) {
    handleSessionError(error);
    portalElements.assignmentMessage.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function refreshTeacherData() {
  try {
    const response = await platformRequest("teacherOverview", { token: portalState.session.session.token });
    portalState.teacherData = response;
    renderTeacherData(response);
  } catch (error) {
    handleSessionError(error);
    showToast(error.message);
  }
}

function renderTeacherData(data) {
  portalElements.metricStudents.textContent = data.summary.activeStudents ?? "—";
  portalElements.metricAssignments.textContent = data.summary.activeAssignments ?? "—";
  portalElements.metricSubmissions.textContent = data.summary.todaySubmissions ?? "—";
  portalElements.metricAverage.textContent = data.summary.averageScore == null ? "—" : data.summary.averageScore;
  portalElements.sheetLink.href = data.sheetUrl || "#";
  portalElements.driveLink.href = data.recordingFolderUrl || "#";
  renderAssignmentRows(data.assignments || []);
  renderRecentRows(data.recentResults || []);
  renderGroupRows(data.groups || []);
  renderStudentRows(data.students || []);
}

function renderGroupRows(groups) {
  portalElements.groupRows.innerHTML = groups.length ? groups.map((group) => `<tr>
    <td><strong>${escapePortalHtml(group.groupName)}</strong></td>
    <td>${group.memberCount}</td>
    <td class="score-cell">${masteryText(group.averageMastery)}</td>
    <td>${group.practicedLines} / ${group.totalLines}</td>
    <td>${group.totalAttempts}</td>
    <td>${escapePortalHtml(displayDuration(group.totalDurationSec))}</td>
    <td class="group-members">${renderMemberRanking(group.students || [], { showScores: true, listClass: "teacher-member-list", reviewable: true })}</td>
  </tr>`).join("") : '<tr><td colspan="7">尚未設定學生組別。</td></tr>';
}

function renderAssignmentRows(assignments) {
  portalElements.assignmentRows.innerHTML = assignments.length ? assignments.map((assignment) => {
    const nextStatus = assignment.status === "Active" ? "Closed" : "Active";
    const actionLabel = assignment.status === "Active" ? "關閉" : "重新開放";
    const mastery = assignment.goalMode === "mastery_target";
    const goal = mastery
      ? `整體熟練度 ${masteryText(assignment.targetPercent)}`
      : `${assignment.role} · ${assignment.requiredCount} 句 · 每句 ${assignment.targetScore == null ? "完成" : `${assignment.targetScore} 分`}`;
    const progress = mastery
      ? `${assignment.achievedStudents ?? assignment.completedLines} / ${assignment.students} 人`
      : `${assignment.completedLines} / ${assignment.expectedLines} 句`;
    return `<tr>
      <td><strong>${escapePortalHtml(assignment.title)}</strong><br>${escapePortalHtml(assignment.workTitle)}</td>
      <td>${escapePortalHtml(goal)}</td>
      <td>${escapePortalHtml(displayDate(assignment.dueDate))}</td>
      <td>${escapePortalHtml(progress)}</td>
      <td>${assignment.completionRate}%</td>
      <td class="score-cell">${assignment.averageScore ?? "—"}</td>
      <td><span class="table-status ${assignment.status === "Active" ? "" : "is-closed"}">${assignment.status === "Active" ? "進行中" : "已關閉"}</span> <button class="row-button assignment-status-button" type="button" data-id="${escapePortalHtml(assignment.assignmentId)}" data-status="${nextStatus}">${actionLabel}</button></td>
    </tr>`;
  }).join("") : '<tr><td colspan="7">尚未發派作業。</td></tr>';
}

function renderRecentRows(results) {
  portalElements.recentResultRows.innerHTML = results.length ? results.map((result) => `<tr>
    <td><button class="student-review-button" type="button" data-student-id="${escapePortalHtml(result.studentId)}" aria-label="檢視${escapePortalHtml(result.studentName)}的完成片段">${escapePortalHtml(result.studentName)}</button><br>${escapePortalHtml(result.studentId)}</td>
    <td>${escapePortalHtml(result.workTitle)}<br>${escapePortalHtml(result.role)}</td>
    <td>第 ${result.lineIndex} 句</td>
    <td class="score-cell">${result.score}</td>
    <td>${result.attempts}</td>
    <td>${escapePortalHtml(displayDateTime(result.updatedAt))}</td>
    <td>${result.audioUrl ? `<a href="${escapePortalHtml(result.audioUrl)}" target="_blank" rel="noopener">播放</a>` : "—"}</td>
  </tr>`).join("") : '<tr><td colspan="7">尚無逐句結果。</td></tr>';
}

function renderStudentRows(students) {
  portalElements.studentCountLabel.textContent = `${students.length} 人`;
  const groups = [...new Set(students.map((student) => student.groupName).filter(Boolean))].sort();
  portalElements.knownGroups.innerHTML = groups.map((group) => `<option value="${escapePortalHtml(group)}"></option>`).join("");
  portalElements.studentRows.innerHTML = students.length ? students.map((student) => `<tr>
    <td>${escapePortalHtml(student.seatNo)}</td>
    <td>${escapePortalHtml(student.studentId)}</td>
    <td><button class="student-review-button" type="button" data-student-id="${escapePortalHtml(student.studentId)}" aria-label="檢視${escapePortalHtml(student.name)}的完成片段">${escapePortalHtml(student.name)}</button></td>
    <td><div class="group-editor"><input class="group-name-input" aria-label="${escapePortalHtml(student.name)}的組別" data-id="${escapePortalHtml(student.studentId)}" value="${escapePortalHtml(student.groupName || "")}" list="knownGroups" maxlength="40"><button class="row-button save-group-button" type="button" data-id="${escapePortalHtml(student.studentId)}">儲存</button></div></td>
    <td>${escapePortalHtml(student.profile?.workTitle || "尚未選擇")}</td>
    <td>${escapePortalHtml(profileRoleLabel(student.profile))}</td>
    <td class="mastery-cell"><strong>${masteryText(student.masteryPercent)}</strong><div class="mastery-track"><span style="width:${Math.max(0, Math.min(100, Number(student.masteryPercent) || 0))}%"></span></div></td>
    <td>${escapePortalHtml(displayDateTime(student.lastLoginAt))}</td>
    <td><button class="row-button history-button" type="button" data-id="${escapePortalHtml(student.studentId)}">查看歷程</button></td>
    <td><button class="row-button reset-pin-button" type="button" data-id="${escapePortalHtml(student.studentId)}">重設 PIN</button></td>
  </tr>`).join("") : '<tr><td colspan="10">沒有啟用中的學生。</td></tr>';
}

async function handleAssignmentRowClick(event) {
  const button = event.target.closest(".assignment-status-button");
  if (!button) return;
  setBusy(button, true, "更新中");
  try {
    await platformRequest("updateAssignmentStatus", {
      token: portalState.session.session.token,
      assignmentId: button.dataset.id,
      status: button.dataset.status,
    });
    await refreshTeacherData();
  } catch (error) {
    handleSessionError(error);
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

async function handleStudentRowClick(event) {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  if (button.classList.contains("save-group-button")) {
    const input = portalElements.studentRows.querySelector(`.group-name-input[data-id="${CSS.escape(button.dataset.id)}"]`);
    setBusy(button, true, "儲存中");
    try {
      await platformRequest("setStudentGroup", {
        token: portalState.session.session.token,
        studentId: button.dataset.id,
        groupName: input?.value.trim() || "",
      });
      showToast("組別已更新");
      await refreshTeacherData();
    } catch (error) {
      handleSessionError(error);
      showToast(error.message);
    } finally {
      setBusy(button, false);
    }
    return;
  }
  if (button.classList.contains("history-button")) {
    setBusy(button, true, "載入中");
    try {
      const response = await platformRequest("studentHistory", {
        token: portalState.session.session.token,
        studentId: button.dataset.id,
      });
      renderStudentHistory(response);
      portalElements.historyDialog.showModal();
    } catch (error) {
      handleSessionError(error);
      showToast(error.message);
    } finally {
      setBusy(button, false);
    }
    return;
  }
  if (!button.classList.contains("reset-pin-button")) return;
  setBusy(button, true, "重設中");
  try {
    const response = await platformRequest("resetStudentPin", {
      token: portalState.session.session.token,
      studentId: button.dataset.id,
    });
    showCredentials([response.credential]);
  } catch (error) {
    handleSessionError(error);
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

function handleTeacherStudentReviewClick(event) {
  const button = event.target.closest(".student-review-button[data-student-id]");
  if (!button || !portalElements.teacherView.contains(button)) return;
  openStudentReview(button.dataset.studentId, button);
}

function renderStudentHistory(data) {
  const { student, summary } = data;
  portalElements.historyStudentMeta.textContent = `${student.groupName || "未分組"} · ${student.studentId}`;
  portalElements.historyTitle.textContent = `${student.name}的逐句練習紀錄`;
  portalElements.historyMastery.textContent = masteryText(summary.masteryPercent);
  portalElements.historyLines.textContent = `${summary.practicedLines} / ${summary.totalLines}`;
  portalElements.historyAttempts.textContent = String(summary.totalAttempts || 0);
  portalElements.historyDuration.textContent = displayDuration(summary.totalDurationSec);
  const growth = summary.growthPoints;
  portalElements.historyGrowth.textContent = growth == null ? "—" : `${growth > 0 ? "+" : ""}${growth}`;
  portalElements.historyGrowth.className = growth > 0 ? "growth-positive" : growth < 0 ? "growth-negative" : "";

  portalElements.historyTrend.innerHTML = (data.timeline || []).length
    ? data.timeline.map((item) => `<li title="${escapePortalHtml(displayDateTime(item.submittedAt))}｜第 ${item.lineIndex} 句｜${item.score} 分"><span style="height:${Math.max(2, Math.min(100, Number(item.score) || 0))}%"></span><small>${item.score}</small></li>`).join("")
    : '<li class="trend-empty"><small>—</small></li>';

  portalElements.historyLineRows.innerHTML = (data.lines || []).length ? data.lines.map((line) => {
    const attempts = line.attempts || [];
    const visible = attempts.slice(-10);
    const prefix = attempts.length > visible.length ? '<span>…</span>' : "";
    const growthClass = line.growthPoints > 0 ? "growth-positive" : line.growthPoints < 0 ? "growth-negative" : "";
    const syncLabel = line.requiresRerecord
      ? `<span class="history-sync-status is-rerecord">需重錄：${escapePortalHtml(line.syncReason || "時間軸未通過")}</span>`
      : line.syncStatus === "review"
        ? `<span class="history-sync-status">待複核：${escapePortalHtml(line.syncReason || "時間軸分數偏低")}</span>`
        : "";
    return `<tr>
      <td>${escapePortalHtml(line.workTitle)}<br>${escapePortalHtml(line.role)}</td>
      <td class="history-line-text"><strong>第 ${line.lineIndex} 句</strong><br><span lang="ja">${escapePortalHtml(line.targetText || "—")}</span>${syncLabel}</td>
      <td><div class="score-trail">${prefix}${visible.map((attempt) => `<span title="${escapePortalHtml(displayDateTime(attempt.submittedAt))}">${attempt.score}</span>`).join("")}</div></td>
      <td>${attempts.length || 0}</td>
      <td>${escapePortalHtml(displayDuration(line.totalDurationSec))}</td>
      <td class="${growthClass}">${line.growthPoints > 0 ? "+" : ""}${line.growthPoints || 0}</td>
      <td>${line.latestAudioUrl ? `<a href="${escapePortalHtml(line.latestAudioUrl)}" target="_blank" rel="noopener">播放</a>` : "—"}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="7">尚無逐句練習紀錄。</td></tr>';
}

function formatReviewTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function currentStudentReviewClip() {
  return portalState.studentReview.clips[portalState.studentReview.selectedIndex] || null;
}

function stopStudentReviewSource() {
  const review = portalState.studentReview;
  review.generation += 1;
  if (review.source) {
    review.source.onended = null;
    try { review.source.stop(); } catch {}
    try { review.source.disconnect(); } catch {}
  }
  review.source = null;
  review.sourceStartedAt = 0;
  review.sourceOffset = 0;
}

function updateStudentReviewButtons() {
  if (!portalElements.clipReviewCompare) return;
  const review = portalState.studentReview;
  const clip = currentStudentReviewClip();
  const playing = Boolean(clip && portalElements.clipReviewVideo && !portalElements.clipReviewVideo.paused);
  portalElements.clipReviewPrevious.disabled = !clip || review.selectedIndex <= 0;
  portalElements.clipReviewNext.disabled = !clip || review.selectedIndex >= review.clips.length - 1;
  portalElements.clipReviewCompare.disabled = !clip;
  portalElements.clipReviewOriginal.disabled = !clip;
  portalElements.clipReviewCompare.innerHTML = playing && review.mode === "compare"
    ? '<span aria-hidden="true">Ⅱ</span><span>暫停同步</span>'
    : '<span aria-hidden="true">▶</span><span>學生錄音同步</span>';
  portalElements.clipReviewOriginal.innerHTML = playing && review.mode === "original"
    ? '<span aria-hidden="true">Ⅱ</span><span>暫停原片</span>'
    : '<span aria-hidden="true">♪</span><span>原片原音</span>';
}

function stopStudentReviewPlayback({ resetMode = false } = {}) {
  const review = portalState.studentReview;
  review.playRequest += 1;
  cancelAnimationFrame(review.frame);
  review.frame = 0;
  stopStudentReviewSource();
  portalElements.clipReviewVideo?.pause();
  review.waiting = false;
  if (resetMode) review.mode = "";
  updateStudentReviewButtons();
}

async function loadStudentReviewAudio(clip) {
  const cacheKey = `${clip.studentId}|${clip.resultKey}`;
  if (portalState.studentReviewAudioCache.has(cacheKey)) {
    return portalState.studentReviewAudioCache.get(cacheKey);
  }
  while (portalState.studentReviewAudioCache.size >= 12) {
    portalState.studentReviewAudioCache.delete(portalState.studentReviewAudioCache.keys().next().value);
  }
  const request = queueRecordingAudioRequest(() => platformRequest("studentReviewClip", {
    token: portalState.session.session.token,
    studentId: clip.studentId,
    resultKey: clip.resultKey,
  }), { priority: true }).then(async (response) => {
    const context = getShowcaseAudioContext();
    const blob = audioBlobFromBase64(response.audioBase64, response.mimeType);
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("學生錄音內容無法播放。");
    return buffer;
  }).catch((error) => {
    portalState.studentReviewAudioCache.delete(cacheKey);
    throw error;
  });
  portalState.studentReviewAudioCache.set(cacheKey, request);
  return request;
}

async function buildStudentReviewClips(data) {
  const candidates = (data.lines || []).filter((line) => line.resultKey);
  const slugs = [...new Set(candidates.map((line) => line.workSlug).filter(Boolean))];
  const workEntries = await Promise.all(slugs.map(async (slug) => [slug, await fetchWorkData(slug)]));
  const works = new Map(workEntries);
  const workOrder = new Map((window.QA_WORKS || []).map((work, index) => [work.slug, index]));
  const postRoll = Number(window.QA_RECORDING_TIMING?.postRollSeconds) || 0;
  return candidates.map((historyLine) => {
    const dataForWork = works.get(historyLine.workSlug);
    const line = dataForWork?.lines.find((candidate) => Number(candidate.index) === Number(historyLine.lineIndex));
    if (!dataForWork || !line) return null;
    const duration = Number(dataForWork.duration) || Infinity;
    const recordingDuration = Math.max(0, Number(historyLine.latestRecordingDurationSec) || 0);
    const sourceEnd = Math.min(duration, Number(line.end) || Number(line.start) || 0);
    const compareEnd = Math.min(duration, Math.max(
      sourceEnd + postRoll,
      Number(line.start) + recordingDuration,
    ));
    return {
      ...historyLine,
      studentId: data.student.studentId,
      line,
      workData: dataForWork,
      start: Number(line.start) || 0,
      sourceEnd,
      compareEnd,
      videoUrl: new URL(dataForWork.video, window.QA_CONFIG.productionSiteBase).href,
      posterUrl: new URL(dataForWork.poster, window.QA_CONFIG.productionSiteBase).href,
    };
  }).filter(Boolean).sort((left, right) => (
    (workOrder.get(left.workSlug) ?? 999) - (workOrder.get(right.workSlug) ?? 999)
    || left.start - right.start
    || left.role.localeCompare(right.role)
  ));
}

async function seekStudentReviewVideo(clip) {
  const video = portalElements.clipReviewVideo;
  if (video.readyState < 1) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 3000);
      const ready = () => {
        clearTimeout(timeout);
        video.removeEventListener("error", failed);
        resolve();
      };
      const failed = () => {
        clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", ready);
        reject(new Error("原片目前無法載入。"));
      };
      video.addEventListener("loadedmetadata", ready, { once: true });
      video.addEventListener("error", failed, { once: true });
    });
  }
  if (currentStudentReviewClip() !== clip) return false;
  if (Math.abs(video.currentTime - clip.start) <= 0.04) return true;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1200);
    const done = () => {
      clearTimeout(timeout);
      resolve();
    };
    video.addEventListener("seeked", done, { once: true });
    try {
      video.currentTime = clip.start;
    } catch {
      done();
    }
  });
  return currentStudentReviewClip() === clip;
}

function selectStudentReviewClip(index) {
  const review = portalState.studentReview;
  const clip = review.clips[index];
  if (!clip) return;
  stopStudentReviewPlayback({ resetMode: true });
  review.selectedIndex = index;
  review.stopAt = clip.sourceEnd;

  portalElements.clipReviewList.querySelectorAll(".clip-review-item").forEach((button) => {
    const active = Number(button.dataset.reviewIndex) === index;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "true" : "false");
    if (active) button.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  const video = portalElements.clipReviewVideo;
  if (video.src !== clip.videoUrl) {
    video.src = clip.videoUrl;
    video.poster = clip.posterUrl;
    video.load();
  }
  video.muted = false;
  seekStudentReviewVideo(clip).catch((error) => {
    if (currentStudentReviewClip() === clip) portalElements.clipReviewStatus.textContent = error.message;
  });

  portalElements.clipReviewPosition.textContent = `${index + 1} / ${review.clips.length} · ${formatReviewTime(clip.start)}–${formatReviewTime(clip.sourceEnd)}`;
  portalElements.clipReviewScore.textContent = `${Math.round(Number(clip.latestScore) || 0)} 分`;
  portalElements.clipReviewLineTitle.textContent = `${clip.workTitle} · ${clip.role} · 第 ${clip.lineIndex} 句`;
  portalElements.clipReviewJapanese.innerHTML = clip.line.japaneseHtml || escapePortalHtml(clip.targetText || clip.line.japanese || "—");
  portalElements.clipReviewTranslation.textContent = clip.line.translation || "—";
  const aspects = clip.latestAspects || {};
  portalElements.clipReviewAccent.textContent = Number.isFinite(Number(aspects.accent)) ? Math.round(Number(aspects.accent)) : "—";
  portalElements.clipReviewIntonation.textContent = Number.isFinite(Number(aspects.intonation)) ? Math.round(Number(aspects.intonation)) : "—";
  portalElements.clipReviewSpeed.textContent = Number.isFinite(Number(aspects.speed)) ? Math.round(Number(aspects.speed)) : "—";
  portalElements.clipReviewVolume.textContent = Number.isFinite(Number(aspects.volume)) ? Math.round(Number(aspects.volume)) : "—";
  portalElements.clipReviewStatus.textContent = clip.requiresRerecord
    ? `需重新錄音：${clip.syncReason || "錄音與影片時間軸差異過大"}`
    : clip.syncStatus === "review"
      ? `時間軸待複核：${clip.syncReason || "建議搭配原片確認"}`
      : `最後更新 ${displayDateTime(clip.latestUpdatedAt)} · 可播放學生錄音或原片`;
  updateStudentReviewButtons();
}

async function renderStudentReview(data) {
  stopStudentReviewPlayback({ resetMode: true });
  const clips = await buildStudentReviewClips(data);
  portalState.studentReview.data = data;
  portalState.studentReview.clips = clips;
  portalState.studentReview.selectedIndex = -1;
  portalElements.clipReviewStudentMeta.textContent = `${data.student.groupName || "未分組"} · ${data.student.studentId}`;
  portalElements.clipReviewTitle.textContent = `${data.student.name}的完成片段`;
  portalElements.clipReviewCount.textContent = `${clips.length} 段`;
  portalElements.clipReviewContent.hidden = clips.length === 0;
  portalElements.clipReviewEmpty.hidden = clips.length > 0;
  portalElements.clipReviewList.innerHTML = clips.map((clip, index) => `<li>
    <button class="clip-review-item${clip.requiresRerecord ? " requires-rerecord" : clip.syncStatus === "review" ? " needs-review" : ""}" type="button" data-review-index="${index}">
      <span class="clip-review-item__meta">${escapePortalHtml(clip.workTitle)} · ${escapePortalHtml(clip.role)} · 第 ${clip.lineIndex} 句</span>
      <strong class="clip-review-item__score">${Math.round(Number(clip.latestScore) || 0)}</strong>
      <span class="clip-review-item__text" lang="ja">${escapePortalHtml(clip.targetText || clip.line.japanese || "—")}</span>
      <span class="clip-review-item__time">${clip.requiresRerecord ? "需重新錄音" : clip.syncStatus === "review" ? "時間軸待複核" : escapePortalHtml(displayDateTime(clip.latestUpdatedAt))}</span>
    </button>
  </li>`).join("");
  if (clips.length) selectStudentReviewClip(0);
}

async function openStudentReview(studentId, button) {
  const account = portalState.session?.account;
  const allowed = account?.type === "teacher"
    || (account?.type === "student" && String(account.studentId) === String(studentId));
  if (!studentId || !allowed) return;
  setBusy(button, true, "載入中");
  try {
    const response = await platformRequest("studentHistory", {
      token: portalState.session.session.token,
      studentId,
    });
    await renderStudentReview(response);
    portalElements.clipReviewDialog.showModal();
  } catch (error) {
    handleSessionError(error);
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

function scheduleStudentReviewSource() {
  const review = portalState.studentReview;
  const clip = currentStudentReviewClip();
  const video = portalElements.clipReviewVideo;
  const buffer = review.audioBuffer;
  if (!clip || !buffer || review.mode !== "compare" || video.paused || review.waiting || review.source) return;
  const offset = Math.max(0, video.currentTime - clip.start);
  if (offset >= buffer.duration - 0.01) return;
  const context = getShowcaseAudioContext();
  const generation = review.generation;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = 1;
  source.connect(context.destination);
  review.source = source;
  review.sourceStartedAt = context.currentTime + 0.018;
  review.sourceOffset = offset;
  source.onended = () => {
    if (review.generation === generation && review.source === source) review.source = null;
    try { source.disconnect(); } catch {}
  };
  source.start(review.sourceStartedAt, offset);
}

function syncStudentReviewPlayback() {
  const review = portalState.studentReview;
  const video = portalElements.clipReviewVideo;
  const clip = currentStudentReviewClip();
  if (!clip || video.paused || video.ended) return;
  if (video.currentTime >= review.stopAt - 0.02) {
    video.pause();
    video.currentTime = Math.min(review.stopAt, Number(clip.workData.duration) || review.stopAt);
    portalElements.clipReviewStatus.textContent = review.mode === "compare" ? "學生錄音片段播放完成" : "原片片段播放完成";
    return;
  }
  if (review.mode === "compare") {
    scheduleStudentReviewSource();
    const context = portalState.showcaseAudioContext;
    if (context?.state === "running" && review.source) {
      const audioOffset = review.sourceOffset + Math.max(0, context.currentTime - review.sourceStartedAt);
      const videoOffset = video.currentTime - clip.start;
      if (Math.abs(audioOffset - videoOffset) > 0.35) {
        stopStudentReviewSource();
        scheduleStudentReviewSource();
      }
    }
  }
  review.frame = requestAnimationFrame(syncStudentReviewPlayback);
}

async function toggleStudentReviewPlayback(mode) {
  const review = portalState.studentReview;
  const clip = currentStudentReviewClip();
  const video = portalElements.clipReviewVideo;
  if (!clip || !video) return;
  video.defaultPlaybackRate = 1;
  video.playbackRate = 1;
  if (!video.paused && review.mode === mode) {
    video.pause();
    return;
  }
  const canResume = video.paused
    && review.mode === mode
    && video.currentTime >= clip.start
    && video.currentTime < review.stopAt - 0.05;
  if (!video.paused) video.pause();
  stopStudentReviewSource();
  cancelAnimationFrame(review.frame);
  review.frame = 0;
  const playRequest = ++review.playRequest;
  review.mode = mode;
  review.waiting = false;

  try {
    if (!canResume && !await seekStudentReviewVideo(clip)) return;
    if (playRequest !== review.playRequest || currentStudentReviewClip() !== clip || review.mode !== mode) return;
    if (mode === "compare") {
      portalElements.clipReviewStatus.textContent = "正在載入學生錄音";
      review.audioBuffer = await loadStudentReviewAudio(clip);
      if (playRequest !== review.playRequest || currentStudentReviewClip() !== clip || review.mode !== mode) return;
      clip.compareEnd = Math.min(
        Number(clip.workData.duration) || Infinity,
        Math.max(clip.compareEnd, clip.start + review.audioBuffer.duration),
      );
      review.stopAt = clip.compareEnd;
      const context = getShowcaseAudioContext();
      await context.resume();
      if (playRequest !== review.playRequest || currentStudentReviewClip() !== clip || review.mode !== mode) return;
      if (context.state !== "running") throw new Error("請再按一次以啟用聲音。");
      video.muted = true;
      portalElements.clipReviewStatus.textContent = "學生錄音同步播放中";
    } else {
      review.audioBuffer = null;
      review.stopAt = clip.sourceEnd;
      video.muted = false;
      video.volume = 1;
      portalElements.clipReviewStatus.textContent = "原片原音播放中";
    }
    await video.play();
    if (mode === "compare") scheduleStudentReviewSource();
    cancelAnimationFrame(review.frame);
    review.frame = requestAnimationFrame(syncStudentReviewPlayback);
  } catch (error) {
    stopStudentReviewPlayback();
    portalElements.clipReviewStatus.textContent = error.message || "目前無法播放這段錄音";
  }
  updateStudentReviewButtons();
}

function closeStudentReview() {
  stopStudentReviewPlayback({ resetMode: true });
  portalElements.clipReviewDialog.close();
  portalElements.clipReviewVideo.removeAttribute("src");
  portalElements.clipReviewVideo.load();
  portalState.studentReview.data = null;
  portalState.studentReview.clips = [];
  portalState.studentReview.selectedIndex = -1;
}

function parseStudentImport(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => !line.includes("學號")).map((line) => {
    const parts = line.split(/\t|,/).map((part) => part.trim());
    if (parts.length < 3) return null;
    const credentialSource = String(parts[4] || "").toUpperCase().replace(/\s+/g, "");
    const initialPin = /^[A-Z][12]\d{8}$/.test(credentialSource)
      ? credentialSource.slice(-5)
      : /^\d{6}$/.test(credentialSource) ? credentialSource : "";
    return {
      seatNo: parts[0],
      studentId: parts[1],
      name: parts[2],
      className: parts[3] || portalElements.targetClass.value || "416",
      ...(initialPin ? { initialPin } : {}),
    };
  }).filter(Boolean);
}

async function handleStudentImport(event) {
  event.preventDefault();
  const students = parseStudentImport(portalElements.studentImportText.value);
  if (!students.length) {
    showToast("沒有可匯入的學生資料。");
    return;
  }
  const button = event.submitter;
  setBusy(button, true, "匯入中");
  try {
    const response = await platformRequest("upsertStudents", {
      token: portalState.session.session.token,
      students,
      resetExisting: portalElements.resetExistingPins.checked,
    });
    portalElements.studentImportText.value = "";
    showCredentials(response.credentials || []);
    await refreshTeacherData();
  } catch (error) {
    handleSessionError(error);
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

function showCredentials(credentials) {
  portalState.credentials = credentials;
  portalElements.credentialContent.innerHTML = credentials.length
    ? `<div class="credential-grid"><span>座號</span><span>學號</span><span>姓名</span><span>個人 PIN</span>${credentials.map((item) => `<span>${escapePortalHtml(item.seatNo || "")}</span><span>${escapePortalHtml(item.studentId)}</span><span>${escapePortalHtml(item.name)}</span><span class="credential-pin">${escapePortalHtml(item.pin)}</span>`).join("")}</div>`
    : "沒有產生新的 PIN。既有學生的 PIN 維持不變。";
  portalElements.credentialDialog.showModal();
}

function downloadCredentials() {
  if (!portalState.credentials.length) return;
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [["座號", "學號", "姓名", "班級", "個人 PIN"], ...portalState.credentials.map((item) => [item.seatNo, item.studentId, item.name, item.className, item.pin])];
  const csv = `\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `配音平台_PIN發放_${taipeiDate()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function switchTeacherTab(tabName) {
  if (tabName !== "showcase") portalState.showcasePlayers.forEach((player) => player.video.pause());
  document.querySelectorAll(".teacher-tab").forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== tabName; });
}

function handleSessionError(error) {
  if (!["SESSION_INVALID", "SESSION_EXPIRED", "ACCOUNT_INACTIVE"].includes(error.code)) return;
  clearSession();
  location.replace("portal.html");
}

function bindPortalEvents() {
  portalElements.studentMode.addEventListener("click", () => switchLoginMode("student"));
  portalElements.teacherMode.addEventListener("click", () => switchLoginMode("teacher"));
  portalElements.studentLoginPanel.addEventListener("submit", handleStudentLogin);
  portalElements.teacherLoginPanel.addEventListener("submit", handleTeacherLogin);
  portalElements.changePreference.addEventListener("click", () => openPreferenceDialog(false));
  portalElements.viewMyCompletedClips.addEventListener("click", (event) => {
    openStudentReview(portalState.session?.account?.studentId, event.currentTarget);
  });
  portalElements.preferenceWork.addEventListener("change", () => updatePreferenceRoles());
  portalElements.preferenceForm.addEventListener("submit", handlePreferenceSubmit);
  portalElements.preferenceClose.addEventListener("click", () => {
    if (!portalState.setupRequired) portalElements.preferenceDialog.close();
  });
  portalElements.preferenceDialog.addEventListener("cancel", (event) => {
    if (portalState.setupRequired) event.preventDefault();
  });
  portalElements.historyClose.addEventListener("click", () => portalElements.historyDialog.close());
  portalElements.clipReviewClose.addEventListener("click", closeStudentReview);
  portalElements.clipReviewDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeStudentReview();
  });
  portalElements.clipReviewList.addEventListener("click", (event) => {
    const button = event.target.closest(".clip-review-item[data-review-index]");
    if (button) selectStudentReviewClip(Number(button.dataset.reviewIndex));
  });
  portalElements.clipReviewPrevious.addEventListener("click", () => selectStudentReviewClip(portalState.studentReview.selectedIndex - 1));
  portalElements.clipReviewNext.addEventListener("click", () => selectStudentReviewClip(portalState.studentReview.selectedIndex + 1));
  portalElements.clipReviewCompare.addEventListener("click", () => toggleStudentReviewPlayback("compare"));
  portalElements.clipReviewOriginal.addEventListener("click", () => toggleStudentReviewPlayback("original"));
  portalElements.clipReviewVideo.addEventListener("play", () => {
    const review = portalState.studentReview;
    const clip = currentStudentReviewClip();
    if (!clip) {
      portalElements.clipReviewVideo.pause();
      return;
    }
    portalElements.clipReviewVideo.playbackRate = 1;
    if (!review.mode) {
      review.mode = "original";
      review.stopAt = clip.sourceEnd;
      portalElements.clipReviewVideo.muted = false;
      portalElements.clipReviewStatus.textContent = "原片原音播放中";
    }
    review.waiting = false;
    if (review.mode === "compare") scheduleStudentReviewSource();
    cancelAnimationFrame(review.frame);
    review.frame = requestAnimationFrame(syncStudentReviewPlayback);
    updateStudentReviewButtons();
  });
  portalElements.clipReviewVideo.addEventListener("pause", () => {
    cancelAnimationFrame(portalState.studentReview.frame);
    portalState.studentReview.frame = 0;
    stopStudentReviewSource();
    updateStudentReviewButtons();
  });
  portalElements.clipReviewVideo.addEventListener("waiting", () => {
    portalState.studentReview.waiting = true;
    stopStudentReviewSource();
    portalElements.clipReviewStatus.textContent = "影片緩衝中，聲音會自動接回";
  });
  portalElements.clipReviewVideo.addEventListener("playing", () => {
    portalState.studentReview.waiting = false;
    if (portalState.studentReview.mode === "compare") scheduleStudentReviewSource();
  });
  portalElements.clipReviewVideo.addEventListener("seeking", stopStudentReviewSource);
  portalElements.clipReviewVideo.addEventListener("seeked", () => {
    if (!portalElements.clipReviewVideo.paused && portalState.studentReview.mode === "compare") scheduleStudentReviewSource();
  });
  portalElements.clipReviewVideo.addEventListener("ratechange", () => {
    if (Math.abs(portalElements.clipReviewVideo.playbackRate - 1) > 0.001) {
      portalElements.clipReviewVideo.playbackRate = 1;
      portalElements.clipReviewStatus.textContent = "逐句檢視固定使用原始速度";
      return;
    }
    if (!portalElements.clipReviewVideo.paused && portalState.studentReview.mode === "compare") {
      stopStudentReviewSource();
      scheduleStudentReviewSource();
    }
  });
  portalElements.logoutButton.addEventListener("click", () => {
    clearSession();
    location.replace(`portal.html${portalState.demo ? "?demo=1" : ""}`);
  });
  document.querySelectorAll(".teacher-tab").forEach((button) => button.addEventListener("click", () => switchTeacherTab(button.dataset.tab)));
  portalElements.assignmentWork.addEventListener("change", updateWorkRoles);
  portalElements.assignmentRole.addEventListener("change", updateRoleLines);
  portalElements.assignmentStart.addEventListener("change", updateLinePreview);
  portalElements.assignmentCount.addEventListener("input", updateLinePreview);
  portalElements.targetPercent.addEventListener("input", updateLinePreview);
  document.querySelectorAll('input[name="assignmentGoalMode"]').forEach((input) => input.addEventListener("change", syncAssignmentGoalMode));
  portalElements.assignedDate.addEventListener("change", () => {
    if (portalElements.dueDate.value < portalElements.assignedDate.value) portalElements.dueDate.value = portalElements.assignedDate.value;
  });
  portalElements.assignmentForm.addEventListener("submit", handleAssignmentSubmit);
  portalElements.assignmentRows.addEventListener("click", handleAssignmentRowClick);
  portalElements.teacherView.addEventListener("click", handleTeacherStudentReviewClick);
  portalElements.studentRows.addEventListener("click", handleStudentRowClick);
  portalElements.studentImportForm.addEventListener("submit", handleStudentImport);
  portalElements.refreshTeacher.addEventListener("click", refreshTeacherData);
  portalElements.refreshShowcases.addEventListener("click", () => loadGroupShowcases(portalState.session?.account?.type === "teacher" ? "teacher" : "student"));
  portalElements.downloadCredentials.addEventListener("click", downloadCredentials);
  portalElements.printCredentials.addEventListener("click", () => window.print());
}

async function initializePortal() {
  cachePortalElements();
  bindPortalEvents();
  if (portalState.demo) {
    document.getElementById("loginSubtitle").textContent = "示範學生：demo / 123456；老師：teacher1";
  }
  portalState.session = readStoredSession();
  if (!portalState.session) return;
  if (portalState.session.account.type === "student") await showStudentDashboard();
  else if (portalState.session.account.type === "teacher") await showTeacherDashboard();
  else clearSession();
}

document.addEventListener("DOMContentLoaded", initializePortal);
