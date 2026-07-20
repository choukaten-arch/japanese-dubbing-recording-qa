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
  credentials: [],
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
    "preferenceDialog", "preferenceForm", "preferenceClose", "preferenceWork", "preferenceRole",
    "preferencePoster", "preferenceMessage", "classProgressSection", "classProgressUpdated", "classProgressGroups",
    "taskList", "studentEmpty", "teacherView", "sheetLink", "driveLink", "metricStudents",
    "metricAssignments", "metricSubmissions", "metricAverage", "assignPanel", "progressPanel",
    "groupsPanel", "groupRows", "studentsPanel", "assignmentForm", "assignmentTitle", "targetClass", "assignedDate", "dueDate",
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
        requiredCount: 5,
        lineIndices: [1, 3, 6, 9, 10],
        status: "Active",
      }],
      lineResults: {},
      recentResults: [],
      profile: null,
      groupName: "第 1 組",
    };
    localStorage.setItem(key, JSON.stringify(value));
  }
  return {
    value,
    save() { localStorage.setItem(key, JSON.stringify(value)); },
  };
}

function demoTasks() {
  const store = demoStore();
  return store.value.assignments
    .filter((assignment) => assignment.status === "Active")
    .filter((assignment) => store.value.profile
      && assignment.workSlug === store.value.profile.workSlug
      && assignment.role === store.value.profile.role)
    .map((assignment) => {
      const lineResults = store.value.lineResults[assignment.assignmentId] || {};
      const completed = Object.keys(lineResults).length;
      return {
        ...assignment,
        completed,
        completionRate: Math.round((completed / assignment.lineIndices.length) * 100),
        lineResults,
        overdue: assignment.dueDate < taipeiDate(),
      };
    });
}

function demoClassProgress() {
  const store = demoStore();
  const scores = Object.values(store.value.lineResults).flatMap((resultMap) => Object.values(resultMap).map((result) => Number(result.score) || 0));
  const mastery = store.value.profile && scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / 22) * 10) / 10 : 0;
  const attempts = store.value.recentResults.length;
  const duration = store.value.recentResults.reduce((sum, result) => sum + Math.max(0, Number(result.durationSec) || 0), 0);
  return [
    { seatNo: "0", studentId: "demo", name: "測試學生", className: "416", groupName: store.value.groupName, profile: store.value.profile, masteryPercent: mastery, practicedLines: scores.length, totalLines: store.value.profile ? 22 : 0, totalAttempts: attempts, totalDurationSec: duration },
    { seatNo: "2", studentId: "demo-02", name: "示範組員甲", className: "416", groupName: "第 1 組", profile: { workSlug: "kiki", workTitle: "魔女宅急便", role: "琪琪" }, masteryPercent: 46.2, practicedLines: 12, totalLines: 22, totalAttempts: 27, totalDurationSec: 218 },
    { seatNo: "3", studentId: "demo-03", name: "示範組員乙", className: "416", groupName: "第 1 組", profile: { workSlug: "kiki", workTitle: "魔女宅急便", role: "老夫人" }, masteryPercent: 51.8, practicedLines: 13, totalLines: 18, totalAttempts: 31, totalDurationSec: 246 },
    { seatNo: "4", studentId: "demo-04", name: "示範組員丙", className: "416", groupName: "第 2 組", profile: { workSlug: "ponyo", workTitle: "崖上的波妞", role: "波妞" }, masteryPercent: 37.5, practicedLines: 10, totalLines: 24, totalAttempts: 19, totalDurationSec: 164 },
  ];
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
    return {
      ok: true,
      account: { type: "student", studentId: "demo", name: "測試學生", className: "416", seatNo: "0", profile },
      profile,
      needsSetup: !profile,
      classProgress: demoClassProgress(),
      tasks: demoTasks(),
    };
  }
  if (action === "setStudentPreference") {
    const store = demoStore();
    const work = (window.QA_WORKS || []).find((item) => item.slug === payload.workSlug);
    store.value.profile = { groupName: store.value.groupName, workSlug: payload.workSlug, workTitle: work?.title || payload.workSlug, role: payload.role };
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
  if (action === "studentHistory") return mockStudentHistory(payload.studentId);
  if (action === "createAssignment") {
    const store = demoStore();
    const work = (window.QA_WORKS || []).find((item) => item.slug === payload.assignment.workSlug);
    const assignment = {
      assignmentId: `DEMO-${Date.now()}`,
      title: payload.assignment.title || `${work?.title || "作品"}練習`,
      targetClass: payload.assignment.targetClass,
      assignedDate: payload.assignment.assignedDate,
      dueDate: payload.assignment.dueDate,
      workSlug: payload.assignment.workSlug,
      workTitle: work?.title || payload.assignment.workSlug,
      role: payload.assignment.role,
      requiredCount: payload.assignment.lineIndices.length,
      lineIndices: payload.assignment.lineIndices,
      status: "Active",
    };
    store.value.assignments.unshift(assignment);
    store.save();
    return { ok: true, assignmentId: assignment.assignmentId, title: assignment.title, lineIndices: assignment.lineIndices };
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
    return { ok: true, created: payload.students.length, updated: 0, credentials: payload.students.map((student, index) => ({ ...student, pin: String(731200 + index) })) };
  }
  throw new Error("示範模式不支援此操作。");
}

function mockTeacherOverview() {
  const store = demoStore();
  const assignments = store.value.assignments.map((assignment) => {
    const results = store.value.lineResults[assignment.assignmentId] || {};
    const values = Object.values(results);
    return {
      ...assignment,
      students: 1,
      completedLines: values.length,
      expectedLines: assignment.lineIndices.length,
      completionRate: Math.round((values.length / assignment.lineIndices.length) * 100),
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
    renderStudentProfile(profile);
    renderClassProgress(response.classProgress || []);
    renderStudentTasks(response.tasks || []);
    if (response.needsSetup) await openPreferenceDialog(true);
  } catch (error) {
    handleSessionError(error);
    portalElements.taskList.innerHTML = `<div class="empty-state"><strong>無法載入作業</strong><span>${escapePortalHtml(error.message)}</span></div>`;
  }
}

function renderStudentProfile(profile) {
  portalElements.studentPreferenceBar.hidden = !profile;
  if (!profile) return;
  portalElements.studentPreferencePoster.src = posterUrl(profile.workSlug);
  portalElements.studentPreferencePoster.alt = profile.workTitle;
  const group = profile.groupName ? `${profile.groupName}｜` : "";
  portalElements.studentPreferenceLabel.textContent = `${group}${profile.workTitle} · ${profile.role}`;
}

function renderClassProgress(students) {
  portalElements.classProgressSection.hidden = students.length === 0;
  portalElements.classProgressUpdated.textContent = students.length ? `${students.length} 人` : "";
  if (!students.length) {
    portalElements.classProgressGroups.replaceChildren();
    return;
  }
  const groups = new Map();
  students.forEach((student) => {
    const groupName = student.groupName || "未分組";
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(student);
  });
  const currentId = portalState.session?.account?.studentId;
  portalElements.classProgressGroups.innerHTML = [...groups].map(([groupName, members]) => {
    const average = members.reduce((sum, member) => sum + Number(member.masteryPercent || 0), 0) / members.length;
    return `<section class="group-progress-block" aria-label="${escapePortalHtml(groupName)}">
      <header class="group-progress-heading"><strong>${escapePortalHtml(groupName)}</strong><span>平均 ${masteryText(average)}</span></header>
      <ul class="group-member-list">${members.map((member) => `<li class="${member.studentId === currentId ? "is-current" : ""}">
        <span class="group-member-name">${escapePortalHtml(member.name)}</span>
        <span class="mastery-track" aria-label="熟練度 ${masteryText(member.masteryPercent)}"><span style="width:${Math.max(0, Math.min(100, Number(member.masteryPercent) || 0))}%"></span></span>
        <span class="mastery-value">${masteryText(member.masteryPercent)}</span>
      </li>`).join("")}</ul>
    </section>`;
  }).join("");
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

async function updatePreferenceRoles(preferredRole = "") {
  const work = (window.QA_WORKS || []).find((item) => item.slug === portalElements.preferenceWork.value);
  portalElements.preferencePoster.src = posterUrl(portalElements.preferenceWork.value);
  portalElements.preferencePoster.alt = work?.title || "配音作品";
  portalElements.preferenceRole.innerHTML = '<option value="">選擇角色</option>';
  const data = await fetchWorkData(portalElements.preferenceWork.value);
  data.roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role.role;
    option.textContent = `${role.role}（${role.lineCount} 句）`;
    portalElements.preferenceRole.append(option);
  });
  if (preferredRole && [...portalElements.preferenceRole.options].some((option) => option.value === preferredRole)) {
    portalElements.preferenceRole.value = preferredRole;
  }
}

async function openPreferenceDialog(required = false) {
  portalState.setupRequired = required;
  portalElements.preferenceClose.hidden = required;
  portalElements.preferenceMessage.textContent = "";
  populatePreferenceWorks();
  const profile = portalState.session?.account?.profile;
  if (profile?.workSlug) portalElements.preferenceWork.value = profile.workSlug;
  await updatePreferenceRoles(profile?.role || "");
  if (!portalElements.preferenceDialog.open) portalElements.preferenceDialog.showModal();
}

async function handlePreferenceSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "儲存中");
  portalElements.preferenceMessage.textContent = "";
  try {
    const response = await platformRequest("setStudentPreference", {
      token: portalState.session.session.token,
      workSlug: portalElements.preferenceWork.value,
      role: portalElements.preferenceRole.value,
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
  const completedTotal = tasks.reduce((sum, task) => sum + Number(task.completed || 0), 0);
  portalElements.studentCompleted.textContent = String(completedTotal);
  const overdue = tasks.filter((task) => task.overdue && task.completed < task.requiredCount).length;
  portalElements.studentNotice.hidden = overdue === 0;
  portalElements.studentNotice.textContent = overdue ? `有 ${overdue} 份作業已到截止日，仍可繼續完成。` : "";

  tasks.forEach((task) => {
    const firstIncomplete = task.lineIndices.find((index) => !task.lineResults?.[index]) || task.lineIndices[0];
    const complete = task.completed >= task.requiredCount;
    const article = document.createElement("article");
    article.className = "task-item";
    const demoParam = portalState.demo ? "&demo=1" : "";
    article.innerHTML = `
      <img class="task-poster" src="${escapePortalHtml(posterUrl(task.workSlug))}" alt="${escapePortalHtml(task.workTitle)}">
      <div class="task-content">
        <div class="task-topline"><strong>${escapePortalHtml(task.title)}</strong><span class="task-role">${escapePortalHtml(task.role)}</span>${task.overdue && !complete ? '<span class="status-badge is-overdue">已到期</span>' : complete ? '<span class="status-badge">已完成</span>' : ""}</div>
        <p>${escapePortalHtml(task.workTitle)} · 第 ${task.lineIndices.join("、")} 句 · 截止 ${escapePortalHtml(displayDate(task.dueDate))}</p>
        <div class="progress-track" aria-label="完成率 ${task.completionRate}%"><span style="width:${Math.max(0, Math.min(100, task.completionRate))}%"></span></div>
        <div class="task-progress-label">${task.completed} / ${task.requiredCount} 句完成</div>
      </div>
      <div class="task-action"><a href="index.html?work=${encodeURIComponent(task.workSlug)}&assignment=${encodeURIComponent(task.assignmentId)}${demoParam}#line-${firstIncomplete}">${complete ? "再次練習" : task.completed ? "繼續練習" : "開始練習"}</a><span>${complete ? "可重錄更新最後版本" : `尚餘 ${task.requiredCount - task.completed} 句`}</span></div>`;
    article.querySelector("a").addEventListener("click", () => {
      localStorage.setItem(platformConfig.taskKey, JSON.stringify(task));
    });
    portalElements.taskList.append(article);
  });
}

async function showTeacherDashboard() {
  const { account } = portalState.session;
  showAuthenticatedShell(account.name || "老師");
  portalElements.studentView.hidden = true;
  portalElements.teacherView.hidden = false;
  setTeacherDates();
  populateWorkSelect();
  await refreshTeacherData();
}

function setTeacherDates() {
  const today = taipeiDate();
  portalElements.assignedDate.value ||= today;
  portalElements.dueDate.value ||= today;
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
  const data = await response.json();
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
      option.textContent = `${role.role}（${role.lineCount} 句）`;
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
    option.textContent = `角色第 ${position + 1} 句（原片第 ${line.index} 句）`;
    portalElements.assignmentStart.append(option);
  });
  portalElements.assignmentCount.max = String(Math.min(30, portalState.selectedRoleLines.length));
  if (Number(portalElements.assignmentCount.value) > portalState.selectedRoleLines.length) {
    portalElements.assignmentCount.value = String(Math.min(5, portalState.selectedRoleLines.length));
  }
  if (!portalElements.assignmentTitle.value && portalElements.assignmentRole.value) {
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
  const lines = selectedAssignmentLines();
  portalElements.assignmentLineCount.textContent = lines.length ? `將指定 ${lines.length} 句` : "尚未選擇";
  if (!lines.length) {
    portalElements.linePreview.innerHTML = "選擇角色後顯示台詞範圍。";
    return;
  }
  portalElements.linePreview.innerHTML = `<ul>${lines.map((line) => `<li><span>第 ${line.index} 句</span><span lang="ja">${escapePortalHtml(line.japanese)}</span></li>`).join("")}</ul>`;
}

async function handleAssignmentSubmit(event) {
  event.preventDefault();
  const lines = selectedAssignmentLines();
  if (!lines.length) {
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
        workSlug: portalElements.assignmentWork.value,
        role: portalElements.assignmentRole.value,
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
    return `<tr>
      <td><strong>${escapePortalHtml(assignment.title)}</strong><br>${escapePortalHtml(assignment.workTitle)}</td>
      <td>${escapePortalHtml(assignment.role)} · ${assignment.requiredCount} 句</td>
      <td>${escapePortalHtml(displayDate(assignment.dueDate))}</td>
      <td>${assignment.completedLines} / ${assignment.expectedLines}</td>
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
    <td>${escapePortalHtml(student.profile?.role || "—")}</td>
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
    const parts = line.split(/\t|,/).map((part) => part.trim()).filter((part) => part !== "");
    if (parts.length < 3) return null;
    return { seatNo: parts[0], studentId: parts[1], name: parts[2], className: parts[3] || portalElements.targetClass.value || "416" };
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
  portalElements.assignedDate.addEventListener("change", () => {
    if (portalElements.dueDate.value < portalElements.assignedDate.value) portalElements.dueDate.value = portalElements.assignedDate.value;
  });
  portalElements.assignmentForm.addEventListener("submit", handleAssignmentSubmit);
  portalElements.assignmentRows.addEventListener("click", handleAssignmentRowClick);
  portalElements.studentRows.addEventListener("click", handleStudentRowClick);
  portalElements.studentImportForm.addEventListener("submit", handleStudentImport);
  portalElements.refreshTeacher.addEventListener("click", refreshTeacherData);
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
