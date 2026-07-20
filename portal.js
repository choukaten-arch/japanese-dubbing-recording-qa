const platformConfig = window.PLATFORM_CONFIG || {
  apiUrl: "",
  sessionKey: "dubbingPlatformSessionV1",
  taskKey: "dubbingPlatformActiveTaskV1",
};

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
    const data = await response.json();
    if (!data.ok) {
      const error = new Error(data.error?.message || "雲端服務暫時無法處理。");
      error.code = data.error?.code;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("雲端服務回應逾時，請稍後再試。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    return {
      groupName,
      memberCount: members.length,
      averageMastery: members.reduce((sum, member) => sum + Number(member.masteryPercent || 0), 0) / members.length,
      practicedLines,
      totalLines,
      completionRate: totalLines ? Math.round(practicedLines / totalLines * 100) : 0,
      isOwnGroup,
      members: isOwnGroup ? members.map((member) => ({
        studentId: member.studentId,
        name: member.name,
        masteryPercent: member.masteryPercent,
        practicedLines: member.practicedLines,
        totalLines: member.totalLines,
      })) : [],
    };
  });
}

function demoToneBase64() {
  const sampleRate = 8000;
  const sampleCount = 1600;
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
        members: ownMembers.map((member) => ({ studentId: member.studentId, name: member.name, masteryPercent: member.masteryPercent, practicedLines: member.practicedLines, totalLines: member.totalLines })),
        segments: ownData.lines.slice(0, 2).map((line, index) => ({ resultKey: `demo-own-${index}`, lineIndex: line.index, role: line.role, score: 82 - index * 3, studentName: ownMembers[index % ownMembers.length]?.name || "測試學生", updatedAt: new Date().toISOString() })),
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
        canSeeMembers: isTeacher,
        members: isTeacher ? otherMembers.map((member) => ({ studentId: member.studentId, name: member.name, masteryPercent: member.masteryPercent, practicedLines: member.practicedLines, totalLines: member.totalLines })) : [],
        segments: [{ resultKey: "demo-other-0", lineIndex: otherData.lines[0].index, role: otherData.lines[0].role, score: 76, studentName: "", updatedAt: new Date().toISOString() }],
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
  if (action === "studentHistory") return mockStudentHistory(payload.studentId);
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

function mockStudentHistory(studentId) {
  const store = demoStore();
  const student = demoClassProgress().find((item) => item.studentId === studentId) || demoClassProgress()[0];
  const recent = store.value.recentResults.filter((item) => item.studentId === studentId || studentId === "demo");
  const byLine = new Map();
  recent.slice().reverse().forEach((item) => {
    const key = `${item.workTitle}|${item.role}|${item.lineIndex}`;
    if (!byLine.has(key)) byLine.set(key, { workTitle: item.workTitle, role: item.role, lineIndex: item.lineIndex, targetText: item.targetText || "", attempts: [] });
    byLine.get(key).attempts.push({ score: item.score, durationSec: Number(item.durationSec) || 0, submittedAt: item.updatedAt, attemptNumber: item.attempts });
  });
  const lines = [...byLine.values()].map((line) => {
    const scores = line.attempts.map((attempt) => attempt.score);
    return { ...line, latestScore: scores.at(-1) || 0, bestScore: scores.length ? Math.max(...scores) : 0, growthPoints: scores.length > 1 ? scores.at(-1) - scores[0] : 0, totalDurationSec: line.attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0), latestAudioUrl: "" };
  });
  const timeline = recent.slice().reverse().slice(-40).map((item) => ({ score: item.score, durationSec: Number(item.durationSec) || 0, lineIndex: item.lineIndex, submittedAt: item.updatedAt }));
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
    return {
      groupName,
      memberCount: members.length,
      averageMastery: members.reduce((sum, member) => sum + Number(member.masteryPercent || 0), 0) / members.length,
      practicedLines,
      totalLines,
      completionRate: totalLines ? Math.round(practicedLines / totalLines * 100) : 0,
      isOwnGroup,
      members: isOwnGroup ? members : [],
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
    const members = group.isOwnGroup ? group.members || [] : [];
    return `<section class="group-progress-block${group.isOwnGroup ? " is-own-group" : ""}" aria-label="${escapePortalHtml(group.groupName)}">
      <header class="group-progress-heading"><strong>${escapePortalHtml(group.groupName)}${group.isOwnGroup ? '<span class="own-group-label">我的組別</span>' : ""}</strong><span>熟練度 ${masteryText(group.averageMastery)}</span></header>
      <div class="group-completion"><span class="mastery-track" aria-label="小組完成度 ${masteryText(group.completionRate)}"><span style="width:${Math.max(0, Math.min(100, Number(group.completionRate) || 0))}%"></span></span><strong>${masteryText(group.completionRate)}</strong></div>
      ${group.isOwnGroup ? `<ul class="group-member-list">${members.map((member) => `<li class="${member.studentId === currentId ? "is-current" : ""}">
        <span class="group-member-name">${escapePortalHtml(member.name)}</span>
        <span class="mastery-track" aria-label="熟練度 ${masteryText(member.masteryPercent)}"><span style="width:${Math.max(0, Math.min(100, Number(member.masteryPercent) || 0))}%"></span></span>
        <span class="mastery-value">${masteryText(member.masteryPercent)}</span>
      </li>`).join("")}</ul>` : `<div class="group-summary-only"><span>${group.memberCount} 人</span><span>${group.practicedLines} / ${group.totalLines} 段</span></div>`}
    </section>`;
  }).join("");
}

function audioBlobFromBase64(base64, mimeType) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType || "audio/webm" });
}

function stopShowcasePlayer(player) {
  if (!player) return;
  cancelAnimationFrame(player.frame);
  player.frame = 0;
  player.audioElements.forEach((audio) => audio.pause());
  player.button.innerHTML = '<span aria-hidden="true">▶</span><span>播放合成</span>';
}

function clearShowcasePlayers() {
  portalState.showcasePlayers.forEach((player) => {
    player.video.pause();
    stopShowcasePlayer(player);
  });
  portalState.showcasePlayers.clear();
}

async function loadShowcaseAudio(resultKey) {
  if (portalState.showcaseAudioCache.has(resultKey)) return portalState.showcaseAudioCache.get(resultKey);
  const request = platformRequest("groupShowcaseClip", {
    token: portalState.session.session.token,
    resultKey,
  }).then((response) => URL.createObjectURL(audioBlobFromBase64(response.audioBase64, response.mimeType)))
    .catch((error) => {
      portalState.showcaseAudioCache.delete(resultKey);
      throw error;
    });
  portalState.showcaseAudioCache.set(resultKey, request);
  return request;
}

async function ensureShowcaseSegmentAudio(player, segment) {
  if (player.audioElements.has(segment.resultKey)) return player.audioElements.get(segment.resultKey);
  if (!player.audioPromises.has(segment.resultKey)) {
    const request = loadShowcaseAudio(segment.resultKey).then((url) => {
      const audio = new Audio(url);
      audio.preload = "auto";
      player.audioElements.set(segment.resultKey, audio);
      audio.load();
      return new Promise((resolve) => {
        if (audio.readyState >= 2) {
          resolve(audio);
          return;
        }
        const finish = () => {
          clearTimeout(timeout);
          audio.removeEventListener("loadeddata", finish);
          resolve(audio);
        };
        const timeout = setTimeout(finish, 3000);
        audio.addEventListener("loadeddata", finish, { once: true });
      });
    }).then((audio) => {
      player.audioPromises.delete(segment.resultKey);
      return audio;
    }).catch((error) => {
      player.audioPromises.delete(segment.resultKey);
      throw error;
    });
    player.audioPromises.set(segment.resultKey, request);
  }
  return player.audioPromises.get(segment.resultKey);
}

async function prepareShowcaseWindow(player, currentTime, lookAhead = 18) {
  const upcoming = player.segments.filter((segment) => segment.end >= currentTime - 0.5 && segment.start <= currentTime + lookAhead);
  await Promise.allSettled(upcoming.map((segment) => ensureShowcaseSegmentAudio(player, segment)));
}

function activeShowcaseSegments(player, time) {
  return player.segments.filter((segment) => time >= segment.start - 0.08 && time < segment.end);
}

function syncShowcasePlayer(player) {
  if (player.video.paused || player.video.ended) return;
  const time = player.video.currentTime;
  const active = activeShowcaseSegments(player, time);
  const activeKeys = new Set(active.map((segment) => segment.resultKey));
  player.audioElements.forEach((audio, resultKey) => {
    if (!activeKeys.has(resultKey) && !audio.paused) audio.pause();
  });
  active.forEach((segment) => {
    ensureShowcaseSegmentAudio(player, segment).then((audio) => {
      if (player.video.paused || !activeShowcaseSegments(player, player.video.currentTime).some((item) => item.resultKey === segment.resultKey)) return;
      const offset = Math.max(0, player.video.currentTime - segment.start);
      if (Number.isFinite(audio.duration) && offset >= audio.duration) return;
      if (Math.abs(audio.currentTime - offset) > 0.22) audio.currentTime = offset;
      if (audio.paused) audio.play().catch(() => {});
    }).catch(() => {});
  });
  if (active.length) {
    const labels = active.map((segment) => segment.studentName
      ? `${segment.role}｜${segment.studentName}`
      : segment.role);
    player.status.textContent = labels.join("＋");
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
    await prepareShowcaseWindow(player, player.video.currentTime);
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
  if (!showcase.canSeeMembers || !showcase.members?.length) return "";
  return `<ul class="showcase-member-list">${showcase.members.map((member) => `<li>
    <span>${escapePortalHtml(member.name)}</span>
    <span class="mastery-track" aria-label="完成度 ${masteryText(member.masteryPercent)}"><span style="width:${Math.max(0, Math.min(100, Number(member.masteryPercent) || 0))}%"></span></span>
    <strong>${masteryText(member.masteryPercent)}</strong>
  </li>`).join("")}</ul>`;
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
    const lineMap = new Map(data.lines.map((line) => [Number(line.index), line]));
    const segments = (showcase.segments || []).map((segment) => {
      const line = lineMap.get(Number(segment.lineIndex));
      return line ? { ...segment, start: line.start, end: line.end } : null;
    }).filter(Boolean).sort((left, right) => left.start - right.start);
    const article = document.createElement("article");
    article.className = `showcase-card${showcase.isOwnGroup ? " is-own-group" : ""}`;
    article.dataset.showcaseId = showcase.showcaseId;
    article.innerHTML = `
      <header class="showcase-heading">
        <div><span>${escapePortalHtml(showcase.groupName)}${showcase.isOwnGroup ? '<b class="own-group-label">我的組別</b>' : ""}</span><h3>${escapePortalHtml(showcase.workTitle)}</h3></div>
        <strong>${masteryText(showcase.completionRate)}</strong>
      </header>
      <div class="showcase-video-shell">
        <video muted playsinline preload="metadata" poster="${escapePortalHtml(posterUrl(showcase.workSlug))}"></video>
        <div class="showcase-now" role="status">${segments.length ? "準備播放" : "尚無錄音片段"}</div>
      </div>
      <div class="showcase-controls">
        <button class="primary-button showcase-play-button" type="button" data-showcase-id="${escapePortalHtml(showcase.showcaseId)}" ${segments.length ? "" : "disabled"}><span aria-hidden="true">▶</span><span>播放合成</span></button>
        <span>${showcase.recordedSegments} / ${showcase.totalSegments} 段</span>
      </div>
      <div class="progress-track" aria-label="小組完成度 ${masteryText(showcase.completionRate)}"><span style="width:${Math.max(0, Math.min(100, Number(showcase.completionRate) || 0))}%"></span></div>
      ${showcaseMemberList(showcase)}`;
    const video = article.querySelector("video");
    const button = article.querySelector(".showcase-play-button");
    const status = article.querySelector(".showcase-now");
    video.src = new URL(data.video, window.QA_CONFIG.productionSiteBase).href;
    video.muted = true;
    video.controls = true;
    const player = {
      showcase,
      segments,
      video,
      button,
      status,
      frame: 0,
      preparing: false,
      prefetchAt: 0,
      audioElements: new Map(),
      audioPromises: new Map(),
    };
    portalState.showcasePlayers.set(showcase.showcaseId, player);
    button.addEventListener("click", () => toggleShowcasePlayback(showcase.showcaseId));
    video.addEventListener("play", () => {
      video.muted = true;
      button.innerHTML = '<span aria-hidden="true">Ⅱ</span><span>暫停</span>';
      cancelAnimationFrame(player.frame);
      player.frame = requestAnimationFrame(() => syncShowcasePlayer(player));
    });
    video.addEventListener("pause", () => stopShowcasePlayer(player));
    video.addEventListener("seeking", () => player.audioElements.forEach((audio) => audio.pause()));
    video.addEventListener("seeked", () => prepareShowcaseWindow(player, video.currentTime).catch(() => {}));
    video.addEventListener("ended", () => { status.textContent = "本次驗收播放完成"; });
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
      const firstIncomplete = task.lineIndices.find((index) => !task.lineResults?.[index]?.achieved) || task.lineIndices[0];
      href = `index.html?work=${encodeURIComponent(task.workSlug)}&assignment=${encodeURIComponent(task.assignmentId)}${demoParam}#line-${firstIncomplete}`;
      const scoreGoal = task.targetScore == null ? "完成指定句" : `每句至少 ${task.targetScore} 分`;
      detail = `${task.workTitle} · ${task.role} · ${scoreGoal} · 截止 ${displayDate(task.dueDate)}`;
      progressLabel = `${task.completed} / ${task.requiredCount} 句達標`;
      actionLabel = complete ? "再次練習" : task.completed ? "繼續練習" : "開始練習";
      actionHint = complete ? "可重錄更新最後版本" : `尚餘 ${task.requiredCount - task.completed} 句`;
    }
    article.innerHTML = `
      <img class="task-poster" src="${escapePortalHtml(posterUrl(task.workSlug || portalState.session.account.profile?.workSlug))}" alt="${escapePortalHtml(task.workTitle || portalState.session.account.profile?.workTitle || "配音作品")}">
      <div class="task-content">
        <div class="task-topline"><strong>${escapePortalHtml(task.title)}</strong><span class="task-role">${masteryGoal ? "整體完成度" : escapePortalHtml(task.role)}</span>${task.overdue && !complete ? '<span class="status-badge is-overdue">已到期</span>' : complete ? '<span class="status-badge">已達標</span>' : ""}</div>
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
    const demoParam = portalState.demo ? "&demo=1" : "";
    const article = document.createElement("article");
    article.className = "self-practice-item";
    article.innerHTML = `<div class="self-practice-copy">
      <h3>${escapePortalHtml(task.role)}</h3>
      <p>${task.completed} / ${task.requiredCount} 句已練 · 熟練度 ${masteryText(task.masteryPercent)}</p>
      <div class="progress-track" aria-label="熟練度 ${masteryText(task.masteryPercent)}"><span style="width:${Math.max(0, Math.min(100, Number(task.masteryPercent) || 0))}%"></span></div>
    </div>
    <div class="self-practice-action"><a href="index.html?work=${encodeURIComponent(task.workSlug)}&practice=1&role=${encodeURIComponent(task.role)}${demoParam}#line-${next}">${task.completed ? "繼續練習" : "開始練習"}</a><span>第 ${next} 句</span></div>`;
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
  const response = await fetch(`data/${encodeURIComponent(slug)}.json`);
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
    <td class="group-members">${escapePortalHtml((group.students || []).map((student) => student.name).join("、"))}</td>
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
    <td><strong>${escapePortalHtml(result.studentName)}</strong><br>${escapePortalHtml(result.studentId)}</td>
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
    <td><strong>${escapePortalHtml(student.name)}</strong></td>
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
    return `<tr>
      <td>${escapePortalHtml(line.workTitle)}<br>${escapePortalHtml(line.role)}</td>
      <td class="history-line-text"><strong>第 ${line.lineIndex} 句</strong><br><span lang="ja">${escapePortalHtml(line.targetText || "—")}</span></td>
      <td><div class="score-trail">${prefix}${visible.map((attempt) => `<span title="${escapePortalHtml(displayDateTime(attempt.submittedAt))}">${attempt.score}</span>`).join("")}</div></td>
      <td>${attempts.length || 0}</td>
      <td>${escapePortalHtml(displayDuration(line.totalDurationSec))}</td>
      <td class="${growthClass}">${line.growthPoints > 0 ? "+" : ""}${line.growthPoints || 0}</td>
      <td>${line.latestAudioUrl ? `<a href="${escapePortalHtml(line.latestAudioUrl)}" target="_blank" rel="noopener">播放</a>` : "—"}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="7">尚無逐句練習紀錄。</td></tr>';
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
  portalElements.preferenceWork.addEventListener("change", () => updatePreferenceRoles());
  portalElements.preferenceForm.addEventListener("submit", handlePreferenceSubmit);
  portalElements.preferenceClose.addEventListener("click", () => {
    if (!portalState.setupRequired) portalElements.preferenceDialog.close();
  });
  portalElements.preferenceDialog.addEventListener("cancel", (event) => {
    if (portalState.setupRequired) event.preventDefault();
  });
  portalElements.historyClose.addEventListener("click", () => portalElements.historyDialog.close());
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
