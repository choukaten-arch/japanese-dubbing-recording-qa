const SHEETS = Object.freeze({
  STUDENTS: "Students",
  ASSIGNMENTS: "Assignments",
  RESULTS: "Results",
  HISTORY: "AttemptHistory",
  LOGIN_LOG: "LoginLog",
  SETTINGS: "Settings",
  WORK_ROLES: "WorkRoles",
});

const LOGIN_LIMIT = 5;
const LOGIN_LOCK_SECONDS = 10 * 60;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = Object.freeze(["audio/webm", "audio/mp4", "audio/ogg"]);
const HISTORY_HEADERS = Object.freeze([
  "attempt_id", "result_key", "assignment_id", "student_id", "student_name", "class",
  "group_name", "work_slug", "work_title", "role", "line_index", "target_text", "transcript",
  "overall_score", "text_accuracy", "accent_score", "intonation_score", "speed_score", "volume_score",
  "timing_score", "audio_quality", "attempt_number",
  "recording_duration_sec", "audio_url", "submitted_at",
]);

const RESULT_SCORE_HEADERS = Object.freeze([
  "total_recording_duration_sec", "accent_score", "intonation_score", "speed_score", "volume_score",
]);

const ASSIGNMENT_GOAL_HEADERS = Object.freeze(["goal_mode", "target_percent", "target_score"]);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("配音練習平台")
    .addItem("初始化平台", "setupPlatform")
    .addItem("重設老師密碼", "resetTeacherPin")
    .addSeparator()
    .addItem("檢查平台設定", "showPlatformStatus")
    .addToUi();
}

function setupPlatform() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("請從後台 Google Sheet 開啟這個 Apps Script 專案。");
  ensureSheetColumns_(spreadsheet, SHEETS.STUDENTS, [
    "group_name",
    "selected_work_slug",
    "selected_work_title",
    "selected_role",
    "selected_roles",
    "preference_updated_at",
  ]);
  ensureSheetColumns_(spreadsheet, SHEETS.ASSIGNMENTS, ASSIGNMENT_GOAL_HEADERS);
  ensureSheetColumns_(spreadsheet, SHEETS.RESULTS, RESULT_SCORE_HEADERS);
  ensureSheetWithHeaders_(spreadsheet, SHEETS.HISTORY, HISTORY_HEADERS);

  const settings = settingsMapFrom_(spreadsheet);
  let recordingFolderId = String(settings.RECORDING_FOLDER_ID || "").trim();
  let recordingFolder;
  try {
    if (recordingFolderId) recordingFolder = DriveApp.getFolderById(recordingFolderId);
    if (recordingFolder) recordingFolder.getName();
  } catch (error) {
    recordingFolder = null;
  }
  if (!recordingFolder) {
    recordingFolder = DriveApp.createFolder("日語配音練習平台_學生最新錄音");
    recordingFolderId = recordingFolder.getId();
    writeSettingValue_(spreadsheet, "RECORDING_FOLDER_ID", recordingFolderId);
  }

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty("SPREADSHEET_ID", spreadsheet.getId());
  properties.setProperty("RECORDING_FOLDER_ID", recordingFolderId);
  if (!properties.getProperty("SESSION_SECRET")) {
    properties.setProperty("SESSION_SECRET", randomHex_(48));
  }

  let teacherPin = "";
  if (!properties.getProperty("TEACHER_PIN_HASH")) {
    teacherPin = generateNumericPin_(8);
    properties.setProperty("TEACHER_PIN_HASH", makePinHash_(teacherPin));
  }

  const message = teacherPin
    ? `平台初始化完成。\n\n老師初始密碼：${teacherPin}\n\n請立刻記下；系統不會保存可讀的原始密碼。`
    : "平台設定已經完成，原有老師密碼沒有變更。";
  SpreadsheetApp.getUi().alert("日語配音練習平台", message, SpreadsheetApp.getUi().ButtonSet.OK);
  return { initialized: true, teacherPin: teacherPin || null };
}

function resetTeacherPin() {
  requireConfigured_();
  const pin = generateNumericPin_(8);
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty("TEACHER_PIN_HASH", makePinHash_(pin));
  properties.deleteProperty(sessionPropertyKey_("teacher", "teacher"));
  SpreadsheetApp.getUi().alert(
    "老師密碼已重設",
    `新的老師密碼：${pin}\n\n請立刻記下；關閉後無法再次查看。`,
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
  return pin;
}

function showPlatformStatus() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  const folderId = properties.getProperty("RECORDING_FOLDER_ID");
  const serviceUrl = ScriptApp.getService().getUrl() || "尚未部署 Web App";
  const ready = Boolean(spreadsheetId && folderId && properties.getProperty("TEACHER_PIN_HASH") && properties.getProperty("SESSION_SECRET"));
  SpreadsheetApp.getUi().alert(
    "平台設定狀態",
    `狀態：${ready ? "已完成" : "尚未完成"}\n資料表：${spreadsheetId ? "已連結" : "未連結"}\n錄音資料夾：${folderId ? "已連結" : "未連結"}\nWeb App：${serviceUrl}`,
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || "health");
  if (action !== "health") return jsonResponse_({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "這個操作必須使用 POST。" } });
  return jsonResponse_({
    ok: true,
    service: "japanese-dubbing-assignment-platform",
    configured: isConfigured_(),
    time: new Date().toISOString(),
  });
}

function doPost(e) {
  try {
    const payload = parseRequest_(e);
    const result = route_(payload, e);
    return jsonResponse_(Object.assign({ ok: true }, result || {}));
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({ ok: false, error: publicError_(error) });
  }
}

function route_(payload, event) {
  const action = String(payload.action || "").trim();
  const userAgent = cleanText_(payload.userAgent, 500);
  switch (action) {
    case "health": return { configured: isConfigured_(), time: new Date().toISOString() };
    case "studentLogin": return studentLogin_(payload.studentId, payload.pin, userAgent);
    case "teacherLogin": return teacherLogin_(payload.pin, userAgent);
    case "studentTasks": return studentTasks_(payload.token);
    case "setStudentPreference": return setStudentPreference_(
      payload.token,
      payload.workSlug,
      payload.roles === undefined ? payload.role : payload.roles,
    );
    case "submitAttempt": return submitAttempt_(payload);
    case "submitPracticeAttempt": return submitPracticeAttempt_(payload);
    case "teacherOverview": return teacherOverview_(payload.token);
    case "studentHistory": return studentHistory_(payload.token, payload.studentId);
    case "upsertStudents": return upsertStudents_(payload.token, payload.students, Boolean(payload.resetExisting));
    case "setStudentPins": return setStudentPins_(payload.token, payload.updates);
    case "resetStudentPin": return resetStudentPin_(payload.token, payload.studentId);
    case "setStudentActive": return setStudentActive_(payload.token, payload.studentId, payload.active);
    case "setStudentGroup": return setStudentGroup_(payload.token, payload.studentId, payload.groupName);
    case "createAssignment": return createAssignment_(payload.token, payload.assignment || {});
    case "updateAssignmentStatus": return updateAssignmentStatus_(payload.token, payload.assignmentId, payload.status);
    default: fail_("UNKNOWN_ACTION", "不支援的操作。");
  }
}

function parseRequest_(e) {
  const content = e && e.postData ? String(e.postData.contents || "") : "";
  if (!content) fail_("EMPTY_REQUEST", "沒有收到資料。");
  if (content.length > 10 * 1024 * 1024) fail_("REQUEST_TOO_LARGE", "錄音資料太大，請縮短後再試。");
  try {
    return JSON.parse(content);
  } catch (error) {
    fail_("INVALID_JSON", "資料格式不正確。");
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function studentLogin_(studentIdInput, pinInput, userAgent) {
  requireConfigured_();
  const studentId = normalizeStudentId_(studentIdInput);
  const pin = String(pinInput || "").trim();
  const rateKey = `login:student:${studentId}`;
  enforceLoginLimit_(rateKey);

  const table = readTable_(SHEETS.STUDENTS);
  const record = table.records.find((row) => normalizeStudentId_(row.student_id) === studentId);
  if (!record || !isTrue_(record.active) || !verifyPin_(pin, record.pin_hash)) {
    registerLoginFailure_(rateKey);
    appendLoginLog_("student", studentId, false, "登入失敗", userAgent, "");
    fail_("INVALID_LOGIN", "學號或 PIN 不正確。");
  }

  clearLoginFailures_(rateKey);
  const session = createSession_({
    type: "student",
    sub: studentId,
    name: String(record.name || ""),
    className: String(record.class || ""),
    seatNo: String(record.seat_no || ""),
    pinTag: credentialTag_(record.pin_hash),
  });
  updateCellByHeader_(table, record.__row, "last_login_at", new Date());
  appendLoginLog_("student", studentId, true, "登入成功", userAgent, new Date(session.expiresAt));
  const profile = studentProfile_(record);
  return {
    session,
    account: {
      type: "student",
      studentId,
      name: String(record.name || ""),
      className: String(record.class || ""),
      seatNo: String(record.seat_no || ""),
      profile,
    },
    needsSetup: !profile,
  };
}

function teacherLogin_(pinInput, userAgent) {
  requireConfigured_();
  const rateKey = "login:teacher";
  enforceLoginLimit_(rateKey);
  const pinHash = PropertiesService.getScriptProperties().getProperty("TEACHER_PIN_HASH");
  if (!verifyPin_(String(pinInput || "").trim(), pinHash)) {
    registerLoginFailure_(rateKey);
    appendLoginLog_("teacher", "", false, "登入失敗", userAgent, "");
    fail_("INVALID_LOGIN", "老師密碼不正確。");
  }

  clearLoginFailures_(rateKey);
  const session = createSession_({ type: "teacher", sub: "teacher", name: "老師", authTag: credentialTag_(pinHash) });
  appendLoginLog_("teacher", "", true, "登入成功", userAgent, new Date(session.expiresAt));
  return { session, account: { type: "teacher", name: "老師" } };
}

function studentTasks_(token) {
  const identity = verifySession_(token, "student");
  const student = activeStudent_(identity.sub, identity.pinTag);
  const profile = studentProfile_(student);
  const assignments = readTable_(SHEETS.ASSIGNMENTS).records;
  const allStudents = readTable_(SHEETS.STUDENTS).records.filter((row) => isTrue_(row.active));
  const allResults = readTable_(SHEETS.RESULTS).records;
  const results = allResults.filter((row) => normalizeStudentId_(row.student_id) === identity.sub);
  const catalogs = readTable_(SHEETS.WORK_ROLES).records;
  const today = formatDate_(new Date(), "yyyy-MM-dd");
  const progress = studentProgress_(student, allResults, catalogs);
  const selfPractice = buildSelfPractice_(student, results, catalogs);

  const tasks = assignments
    .filter((assignment) => String(assignment.status) === "Active")
    .filter((assignment) => !assignment.assigned_date || dateKey_(assignment.assigned_date) <= today)
    .filter((assignment) => assignmentTargetsStudent_(assignment, student))
    .filter((assignment) => assignmentGoalMode_(assignment) === "mastery_target"
      || studentMatchesAssignmentProfile_(student, assignment))
    .map((assignment) => {
      const goalMode = assignmentGoalMode_(assignment);
      const dueDate = dateKey_(assignment.due_date);
      if (goalMode === "mastery_target") {
        const targetPercent = clampGoalValue_(assignment.target_percent, 80);
        const achieved = progress.masteryPercent >= targetPercent;
        return {
          assignmentId: String(assignment.assignment_id),
          title: String(assignment.title),
          goalMode,
          targetPercent,
          currentMastery: progress.masteryPercent,
          assignedDate: dateKey_(assignment.assigned_date),
          dueDate,
          overdue: Boolean(dueDate && dueDate < today),
          workSlug: profile ? profile.workSlug : "",
          workTitle: profile ? profile.workTitle : "",
          role: "",
          requiredCount: 1,
          lineIndices: [],
          completed: achieved ? 1 : 0,
          achieved,
          completionRate: targetPercent ? Math.min(100, Math.round((progress.masteryPercent / targetPercent) * 100)) : 100,
          lineResults: {},
        };
      }

      const lineIndices = parseLineIndices_(assignment.line_indices);
      const targetScore = clampOptionalScore_(assignment.target_score);
      const lineResults = {};
      results
        .filter((row) => String(row.assignment_id) === String(assignment.assignment_id))
        .forEach((row) => {
          const index = Number(row.line_index);
          if (!lineIndices.includes(index)) return;
          lineResults[index] = {
            score: clampScore_(row.overall_score),
            attempts: Math.max(1, Number(row.attempt_count) || 1),
            updatedAt: isoValue_(row.updated_at || row.submitted_at),
            achieved: targetScore === null || clampScore_(row.overall_score) >= targetScore,
            aspects: scoreAspectsFromRow_(row),
          };
        });
      const completed = Object.values(lineResults).filter((result) => result.achieved).length;
      return {
        assignmentId: String(assignment.assignment_id),
        title: String(assignment.title),
        goalMode,
        targetScore,
        assignedDate: dateKey_(assignment.assigned_date),
        dueDate,
        overdue: Boolean(dueDate && dueDate < today),
        workSlug: String(assignment.work_slug),
        workTitle: String(assignment.work_title),
        role: String(assignment.role),
        requiredCount: lineIndices.length,
        lineIndices,
        completed,
        completionRate: lineIndices.length ? Math.round((completed / lineIndices.length) * 100) : 0,
        lineResults,
      };
    })
    .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)) || left.title.localeCompare(right.title));

  return {
    account: {
      type: "student",
      studentId: identity.sub,
      name: String(student.name || ""),
      className: String(student.class || ""),
      seatNo: String(student.seat_no || ""),
      profile,
    },
    profile,
    needsSetup: !profile,
    progress,
    classProgress: buildClassProgress_(allStudents, allResults, catalogs),
    selfPractice,
    tasks,
  };
}

function setStudentPreference_(token, workSlugInput, rolesInput) {
  const identity = verifySession_(token, "student");
  activeStudent_(identity.sub, identity.pinTag);
  const workSlug = cleanText_(workSlugInput, 80);
  const requestedRoles = Array.isArray(rolesInput) ? rolesInput : [rolesInput];
  const roles = [...new Set(requestedRoles.map((role) => cleanText_(role, 80)).filter(Boolean))];
  if (!roles.length) fail_("INVALID_PREFERENCE", "請至少選擇一個角色。");
  if (roles.length > 12) fail_("INVALID_PREFERENCE", "一次最多選擇 12 個角色。");
  const catalogs = readTable_(SHEETS.WORK_ROLES).records.filter(
    (row) => String(row.work_slug) === workSlug && roles.includes(String(row.role)),
  );
  if (catalogs.length !== roles.length) fail_("INVALID_PREFERENCE", "找不到其中一個作品或角色，請重新選擇。");

  const spreadsheet = spreadsheet_();
  ensureSheetColumns_(spreadsheet, SHEETS.STUDENTS, [
    "group_name",
    "selected_work_slug",
    "selected_work_title",
    "selected_role",
    "selected_roles",
    "preference_updated_at",
  ]);
  const table = readTable_(SHEETS.STUDENTS);
  const student = table.records.find((row) => normalizeStudentId_(row.student_id) === identity.sub);
  if (!student || !isTrue_(student.active)) fail_("ACCOUNT_INACTIVE", "帳號不存在或已停用。");
  const profile = {
    groupName: String(student.group_name || ""),
    workSlug,
    workTitle: String(catalogs[0].work_title || workSlug),
    roles,
    role: roles[0],
  };
  writeRecord_(table, student.__row, {
    selected_work_slug: profile.workSlug,
    selected_work_title: profile.workTitle,
    selected_role: profile.role,
    selected_roles: JSON.stringify(profile.roles),
    preference_updated_at: new Date(),
  });
  return { profile };
}

function submitAttempt_(payload) {
  const identity = verifySession_(payload.token, "student");
  const student = activeStudent_(identity.sub, identity.pinTag);
  const assignmentId = cleanText_(payload.assignmentId, 80);
  const lineIndex = Math.floor(Number(payload.lineIndex));
  if (!assignmentId || !Number.isFinite(lineIndex)) fail_("INVALID_ATTEMPT", "缺少作業或台詞編號。");

  const assignmentTable = readTable_(SHEETS.ASSIGNMENTS);
  const assignment = assignmentTable.records.find((row) => String(row.assignment_id) === assignmentId);
  if (!assignment || String(assignment.status) !== "Active") fail_("ASSIGNMENT_CLOSED", "這份作業目前未開放。");
  if (assignmentGoalMode_(assignment) !== "line_score") {
    fail_("PRACTICE_REQUIRED", "完成度目標請從自主練習區選擇台詞。");
  }
  if (!assignmentTargetsStudent_(assignment, student)) fail_("NOT_ASSIGNED", "這份作業沒有指派給此帳號。");
  const profile = studentProfile_(student);
  if (!profile) fail_("PROFILE_REQUIRED", "請先選擇配音作品與角色。");
  if (String(assignment.work_slug) !== profile.workSlug || !profile.roles.includes(String(assignment.role))) {
    fail_("PROFILE_MISMATCH", "這份作業與目前選擇的作品或角色不一致。");
  }

  const allowedLines = parseLineIndices_(assignment.line_indices);
  if (!allowedLines.includes(lineIndex)) fail_("LINE_NOT_ASSIGNED", "這一句不在本次作業範圍內。");
  if (String(payload.workSlug) !== String(assignment.work_slug) || String(payload.role) !== String(assignment.role)) {
    fail_("ASSIGNMENT_MISMATCH", "作品或角色與作業不一致。");
  }

  const saved = saveAttemptRecord_(payload, identity, student, {
    assignmentId,
    workSlug: String(assignment.work_slug),
    workTitle: String(assignment.work_title),
    role: String(assignment.role),
  });
  const refreshed = studentTasks_(payload.token);
  const task = refreshed.tasks.find((item) => item.assignmentId === assignmentId);
  return { saved: true, audioUrl: saved.audioUrl, task };
}

function submitPracticeAttempt_(payload) {
  const identity = verifySession_(payload.token, "student");
  const student = activeStudent_(identity.sub, identity.pinTag);
  const profile = studentProfile_(student);
  if (!profile) fail_("PROFILE_REQUIRED", "請先選擇配音作品與角色。");

  const workSlug = cleanText_(payload.workSlug, 80);
  const role = cleanText_(payload.role, 80);
  const lineIndex = Math.floor(Number(payload.lineIndex));
  if (!Number.isFinite(lineIndex)) fail_("INVALID_ATTEMPT", "缺少台詞編號。");
  if (workSlug !== profile.workSlug || !profile.roles.includes(role)) {
    fail_("PROFILE_MISMATCH", "只能自主練習目前所選作品與角色。");
  }
  const catalog = readTable_(SHEETS.WORK_ROLES).records.find(
    (row) => String(row.work_slug) === workSlug && String(row.role) === role,
  );
  if (!catalog || !parseLineIndices_(catalog.line_indices).includes(lineIndex)) {
    fail_("INVALID_PRACTICE_LINE", "找不到這個角色的指定台詞。");
  }

  const assignmentId = selfPracticeId_(workSlug, role);
  const saved = saveAttemptRecord_(payload, identity, student, {
    assignmentId,
    workSlug,
    workTitle: String(catalog.work_title || profile.workTitle),
    role,
  });
  const refreshed = studentTasks_(payload.token);
  const task = refreshed.selfPractice.find((item) => item.role === role) || null;
  return { saved: true, audioUrl: saved.audioUrl, task };
}

function saveAttemptRecord_(payload, identity, student, context) {
  const assignmentId = context.assignmentId;
  const lineIndex = Math.floor(Number(payload.lineIndex));
  const scores = payload.scores || {};
  const speedScore = clampScore_(scores.speed === undefined ? scores.timing : scores.speed);
  const volumeScore = clampScore_(scores.volume === undefined ? scores.audioQuality : scores.volume);
  const recordingDuration = Math.max(0, Math.min(120, Number(payload.recordingDuration) || 0));
  const now = new Date();
  const savedAudio = saveLatestAudio_({
    assignmentId,
    studentId: identity.sub,
    lineIndex,
    audioBase64: payload.audioBase64,
    mimeType: payload.mimeType,
    description: `${context.workTitle} / ${context.role} / 第 ${lineIndex} 句 / ${student.name}`,
  });

  const spreadsheet = spreadsheet_();
  ensureSheetColumns_(spreadsheet, SHEETS.RESULTS, RESULT_SCORE_HEADERS);
  ensureSheetWithHeaders_(spreadsheet, SHEETS.HISTORY, HISTORY_HEADERS);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const table = readTable_(SHEETS.RESULTS);
    const resultKey = `${assignmentId}|${identity.sub}|${lineIndex}`;
    const existing = table.records.find((row) => String(row.result_key) === resultKey);
    const attemptCount = existing ? Math.max(1, Number(existing.attempt_count) || 1) + 1 : 1;
    const previousDuration = existing
      ? Math.max(0, Number(existing.total_recording_duration_sec) || Number(existing.recording_duration_sec) || 0)
      : 0;
    const values = {
      result_key: resultKey,
      assignment_id: assignmentId,
      student_id: identity.sub,
      student_name: String(student.name || ""),
      class: String(student.class || ""),
      work_slug: context.workSlug,
      work_title: context.workTitle,
      role: context.role,
      line_index: lineIndex,
      target_text: cleanText_(payload.targetText, 1000),
      transcript: cleanText_(payload.transcript, 1000),
      overall_score: clampScore_(payload.overallScore),
      text_accuracy: clampScore_(scores.textAccuracy),
      accent_score: clampScore_(scores.accent),
      intonation_score: clampScore_(scores.intonation),
      speed_score: speedScore,
      volume_score: volumeScore,
      timing_score: speedScore,
      audio_quality: volumeScore,
      attempt_count: attemptCount,
      recording_duration_sec: recordingDuration,
      total_recording_duration_sec: previousDuration + recordingDuration,
      audio_file_id: savedAudio.fileId,
      audio_url: savedAudio.url,
      submitted_at: existing ? existing.submitted_at || now : now,
      updated_at: now,
    };
    writeRecord_(table, existing ? existing.__row : null, values);
    const historyTable = readTable_(SHEETS.HISTORY);
    writeRecord_(historyTable, null, {
      attempt_id: Utilities.getUuid(),
      result_key: resultKey,
      assignment_id: assignmentId,
      student_id: identity.sub,
      student_name: String(student.name || ""),
      class: String(student.class || ""),
      group_name: String(student.group_name || ""),
      work_slug: context.workSlug,
      work_title: context.workTitle,
      role: context.role,
      line_index: lineIndex,
      target_text: values.target_text,
      transcript: values.transcript,
      overall_score: values.overall_score,
      text_accuracy: values.text_accuracy,
      accent_score: values.accent_score,
      intonation_score: values.intonation_score,
      speed_score: values.speed_score,
      volume_score: values.volume_score,
      timing_score: values.timing_score,
      audio_quality: values.audio_quality,
      attempt_number: attemptCount,
      recording_duration_sec: recordingDuration,
      audio_url: savedAudio.url,
      submitted_at: now,
    });
  } finally {
    lock.releaseLock();
  }
  return { audioUrl: savedAudio.url };
}

function teacherOverview_(token) {
  verifySession_(token, "teacher");
  const students = readTable_(SHEETS.STUDENTS).records;
  const activeStudents = students.filter((row) => isTrue_(row.active));
  const assignments = readTable_(SHEETS.ASSIGNMENTS).records;
  const results = readTable_(SHEETS.RESULTS).records;
  const catalogs = readTable_(SHEETS.WORK_ROLES).records;
  const history = readTable_(SHEETS.HISTORY).records;
  const today = formatDate_(new Date(), "yyyy-MM-dd");

  const assignmentSummaries = assignments.map((assignment) => {
    const goalMode = assignmentGoalMode_(assignment);
    const eligible = activeStudents.filter((student) => assignmentTargetsStudent_(assignment, student)
      && (goalMode === "mastery_target" || studentMatchesAssignmentProfile_(student, assignment)));
    if (goalMode === "mastery_target") {
      const targetPercent = clampGoalValue_(assignment.target_percent, 80);
      const progresses = eligible.map((student) => studentProgress_(student, results, catalogs));
      const achievedStudents = progresses.filter((progress) => progress.masteryPercent >= targetPercent).length;
      return {
        assignmentId: String(assignment.assignment_id),
        title: String(assignment.title),
        goalMode,
        targetPercent,
        targetClass: String(assignment.target_class || ""),
        assignedDate: dateKey_(assignment.assigned_date),
        dueDate: dateKey_(assignment.due_date),
        workSlug: "",
        workTitle: "依學生目前選角",
        role: "",
        requiredCount: 0,
        status: String(assignment.status),
        students: eligible.length,
        achievedStudents,
        completedLines: achievedStudents,
        expectedLines: eligible.length,
        completionRate: eligible.length ? Math.round((achievedStudents / eligible.length) * 100) : 0,
        averageScore: progresses.length ? roundOne_(average_(progresses.map((progress) => progress.masteryPercent))) : null,
      };
    }

    const lines = parseLineIndices_(assignment.line_indices);
    const eligibleIds = new Set(eligible.map((student) => normalizeStudentId_(student.student_id)));
    const matching = results.filter((row) => String(row.assignment_id) === String(assignment.assignment_id)
      && eligibleIds.has(normalizeStudentId_(row.student_id)));
    const scores = matching.map((row) => Number(row.overall_score)).filter(Number.isFinite);
    const targetScore = clampOptionalScore_(assignment.target_score);
    const achievedResults = matching.filter((row) => targetScore === null || clampScore_(row.overall_score) >= targetScore);
    const expected = eligible.length * lines.length;
    return {
      assignmentId: String(assignment.assignment_id),
      title: String(assignment.title),
      goalMode,
      targetScore,
      targetClass: String(assignment.target_class || ""),
      assignedDate: dateKey_(assignment.assigned_date),
      dueDate: dateKey_(assignment.due_date),
      workSlug: String(assignment.work_slug),
      workTitle: String(assignment.work_title),
      role: String(assignment.role),
      requiredCount: lines.length,
      status: String(assignment.status),
      students: eligible.length,
      completedLines: achievedResults.length,
      expectedLines: expected,
      completionRate: expected ? Math.round((achievedResults.length / expected) * 100) : 0,
      averageScore: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null,
    };
  }).sort((left, right) => String(right.assignedDate).localeCompare(String(left.assignedDate)));

  const scores = results.map((row) => Number(row.overall_score)).filter(Number.isFinite);
  const todayAttempts = history.filter((row) => dateKey_(row.submitted_at) === today);
  const recentResults = results
    .slice()
    .sort((left, right) => isoValue_(right.updated_at).localeCompare(isoValue_(left.updated_at)))
    .slice(0, 100)
    .map((row) => ({
      assignmentId: String(row.assignment_id),
      studentId: String(row.student_id),
      studentName: String(row.student_name),
      className: String(row.class),
      workTitle: String(row.work_title),
      role: String(row.role),
      lineIndex: Number(row.line_index),
      score: clampScore_(row.overall_score),
      aspects: scoreAspectsFromRow_(row),
      attempts: Number(row.attempt_count) || 1,
      audioUrl: String(row.audio_url || ""),
      updatedAt: isoValue_(row.updated_at || row.submitted_at),
    }));
  const studentProgressRows = buildClassProgress_(activeStudents, results, catalogs).map((progress) => {
    const source = activeStudents.find((row) => normalizeStudentId_(row.student_id) === progress.studentId);
    return Object.assign(progress, { lastLoginAt: isoValue_(source && source.last_login_at) });
  });

  return {
    summary: {
      activeStudents: activeStudents.length,
      activeAssignments: assignments.filter((row) => String(row.status) === "Active").length,
      todaySubmissions: todayAttempts.length,
      averageScore: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null,
      groups: new Set(activeStudents.map((row) => String(row.group_name || "").trim()).filter(Boolean)).size,
    },
    assignments: assignmentSummaries,
    groups: buildGroupSummaries_(studentProgressRows),
    students: studentProgressRows,
    recentResults,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheet_().getId()}/edit`,
    recordingFolderUrl: `https://drive.google.com/drive/folders/${recordingFolderId_()}`,
  };
}

function studentHistory_(token, studentIdInput) {
  verifySession_(token, "teacher");
  const studentId = normalizeStudentId_(studentIdInput);
  const student = readTable_(SHEETS.STUDENTS).records.find(
    (row) => normalizeStudentId_(row.student_id) === studentId,
  );
  if (!student) fail_("STUDENT_NOT_FOUND", "找不到這個學號。");

  const allResults = readTable_(SHEETS.RESULTS).records;
  const results = allResults.filter((row) => normalizeStudentId_(row.student_id) === studentId);
  const catalogs = readTable_(SHEETS.WORK_ROLES).records;
  const profile = studentProfile_(student);
  const history = readTable_(SHEETS.HISTORY).records
    .filter((row) => normalizeStudentId_(row.student_id) === studentId)
    .sort((left, right) => isoValue_(left.submitted_at).localeCompare(isoValue_(right.submitted_at)))
    .slice(-2000);

  const lineGroups = {};
  history.forEach((row) => {
    const key = `${row.work_slug}|${row.role}|${Number(row.line_index)}`;
    if (!lineGroups[key]) {
      lineGroups[key] = {
        workSlug: String(row.work_slug || ""),
        workTitle: String(row.work_title || row.work_slug || ""),
        role: String(row.role || ""),
        lineIndex: Number(row.line_index),
        targetText: String(row.target_text || ""),
        attempts: [],
      };
    }
    if (!lineGroups[key].targetText) lineGroups[key].targetText = String(row.target_text || "");
    lineGroups[key].attempts.push({
      score: clampScore_(row.overall_score),
      aspects: scoreAspectsFromRow_(row),
      durationSec: Math.max(0, Number(row.recording_duration_sec) || 0),
      submittedAt: isoValue_(row.submitted_at),
      attemptNumber: Math.max(1, Number(row.attempt_number) || 1),
    });
  });

  results.forEach((row) => {
    const key = `${row.work_slug}|${row.role}|${Number(row.line_index)}`;
    if (lineGroups[key]) return;
    lineGroups[key] = {
      workSlug: String(row.work_slug || ""),
      workTitle: String(row.work_title || row.work_slug || ""),
      role: String(row.role || ""),
      lineIndex: Number(row.line_index),
      targetText: String(row.target_text || ""),
      attempts: [{
        score: clampScore_(row.overall_score),
        aspects: scoreAspectsFromRow_(row),
        durationSec: Math.max(0, Number(row.total_recording_duration_sec) || Number(row.recording_duration_sec) || 0),
        submittedAt: isoValue_(row.updated_at || row.submitted_at),
        attemptNumber: Math.max(1, Number(row.attempt_count) || 1),
      }],
    };
  });

  const latestResults = {};
  results.forEach((row) => {
    const key = `${row.work_slug}|${row.role}|${Number(row.line_index)}`;
    const current = latestResults[key];
    if (!current || isoValue_(row.updated_at || row.submitted_at) > isoValue_(current.updated_at || current.submitted_at)) {
      latestResults[key] = row;
    }
  });

  const lines = Object.entries(lineGroups).map(([key, line]) => {
    const scores = line.attempts.map((attempt) => attempt.score);
    const latest = latestResults[key];
    return Object.assign(line, {
      latestScore: scores.length ? scores[scores.length - 1] : 0,
      bestScore: scores.length ? Math.max.apply(null, scores) : 0,
      growthPoints: scores.length > 1 ? roundOne_(scores[scores.length - 1] - scores[0]) : 0,
      totalDurationSec: roundOne_(line.attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0)),
      latestAudioUrl: String(latest && latest.audio_url || ""),
    });
  }).sort((left, right) => left.workTitle.localeCompare(right.workTitle)
    || left.role.localeCompare(right.role)
    || left.lineIndex - right.lineIndex);

  const trendAttempts = history.filter((row) => !profile
    || (String(row.work_slug) === profile.workSlug && profile.roles.includes(String(row.role))));
  const trendScores = trendAttempts.map((row) => clampScore_(row.overall_score));
  const sampleSize = Math.min(5, trendScores.length);
  const firstAverage = sampleSize ? average_(trendScores.slice(0, sampleSize)) : null;
  const latestAverage = sampleSize ? average_(trendScores.slice(-sampleSize)) : null;
  const progress = studentProgress_(student, allResults, catalogs);
  return {
    student: {
      studentId,
      seatNo: String(student.seat_no || ""),
      name: String(student.name || ""),
      className: String(student.class || ""),
      groupName: String(student.group_name || ""),
      profile,
    },
    summary: Object.assign(progress, {
      growthPoints: firstAverage === null ? null : roundOne_(latestAverage - firstAverage),
      practiceDays: new Set(history.map((row) => dateKey_(row.submitted_at)).filter(Boolean)).size,
    }),
    lines,
    timeline: trendAttempts.slice(-40).map((row) => ({
      score: clampScore_(row.overall_score),
      aspects: scoreAspectsFromRow_(row),
      durationSec: Math.max(0, Number(row.recording_duration_sec) || 0),
      lineIndex: Number(row.line_index),
      submittedAt: isoValue_(row.submitted_at),
    })),
  };
}

function upsertStudents_(token, studentInputs, resetExisting) {
  verifySession_(token, "teacher");
  if (!Array.isArray(studentInputs) || !studentInputs.length) fail_("EMPTY_STUDENTS", "沒有可匯入的學生資料。");
  if (studentInputs.length > 200) fail_("TOO_MANY_STUDENTS", "一次最多匯入 200 人。");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const credentials = [];
  let created = 0;
  let updated = 0;
  try {
    let table = readTable_(SHEETS.STUDENTS);
    const existing = {};
    table.records.forEach((row) => { existing[normalizeStudentId_(row.student_id)] = row; });
    studentInputs.forEach((input) => {
      const studentId = normalizeStudentId_(input.studentId);
      const name = cleanText_(input.name, 80);
      const className = cleanText_(input.className, 40);
      const seatNo = cleanText_(input.seatNo, 12);
      const requestedPin = normalizeOptionalStudentPin_(input.initialPin);
      if (!studentId || !name || !className) fail_("INVALID_STUDENT", "學生資料需包含學號、姓名與班級。");
      const found = existing[studentId];
      const shouldGenerate = !found || resetExisting || Boolean(requestedPin);
      const pin = shouldGenerate ? requestedPin || generateNumericPin_(6) : "";
      const values = {
        seat_no: seatNo,
        student_id: studentId,
        name,
        class: className,
        active: true,
        note: cleanText_(input.note, 200),
      };
      if (shouldGenerate) values.pin_hash = makePinHash_(pin);
      if (found) {
        writeRecord_(table, found.__row, values);
        updated += 1;
      } else {
        values.created_at = new Date();
        writeRecord_(table, null, values);
        created += 1;
      }
      if (shouldGenerate) {
        PropertiesService.getScriptProperties().deleteProperty(sessionPropertyKey_("student", studentId));
        credentials.push({ seatNo, studentId, name, className, pin });
      }
      table = readTable_(SHEETS.STUDENTS);
      existing[studentId] = table.records.find((row) => normalizeStudentId_(row.student_id) === studentId);
    });
  } finally {
    lock.releaseLock();
  }
  return { created, updated, credentials };
}

function setStudentPins_(token, updateInputs) {
  verifySession_(token, "teacher");
  if (!Array.isArray(updateInputs) || !updateInputs.length) fail_("EMPTY_PIN_UPDATES", "沒有可更新的 PIN 資料。");
  if (updateInputs.length > 200) fail_("TOO_MANY_STUDENTS", "一次最多更新 200 人。");

  const requested = {};
  updateInputs.forEach((input) => {
    const studentId = normalizeStudentId_(input.studentId);
    const pin = normalizeRequiredStudentPin_(input.pin);
    if (!studentId) fail_("INVALID_STUDENT", "PIN 更新資料缺少學號。");
    requested[studentId] = pin;
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let updated = 0;
  const missing = [];
  try {
    const table = readTable_(SHEETS.STUDENTS);
    const existing = {};
    table.records.forEach((row) => { existing[normalizeStudentId_(row.student_id)] = row; });
    Object.keys(requested).forEach((studentId) => {
      const student = existing[studentId];
      if (!student) {
        missing.push(studentId);
        return;
      }
      writeRecord_(table, student.__row, { pin_hash: makePinHash_(requested[studentId]) });
      PropertiesService.getScriptProperties().deleteProperty(sessionPropertyKey_("student", studentId));
      updated += 1;
    });

    SpreadsheetApp.flush();
    const verificationTable = readTable_(SHEETS.STUDENTS);
    const verified = verificationTable.records.reduce((count, row) => {
      const studentId = normalizeStudentId_(row.student_id);
      return requested[studentId] && verifyPin_(requested[studentId], row.pin_hash) ? count + 1 : count;
    }, 0);
    if (verified !== updated) fail_("PIN_UPDATE_VERIFICATION_FAILED", "部分 PIN 未能通過更新驗證，請重新操作。");
    return { updated, verified, missing };
  } finally {
    lock.releaseLock();
  }
}

function resetStudentPin_(token, studentIdInput) {
  verifySession_(token, "teacher");
  const studentId = normalizeStudentId_(studentIdInput);
  const table = readTable_(SHEETS.STUDENTS);
  const student = table.records.find((row) => normalizeStudentId_(row.student_id) === studentId);
  if (!student) fail_("STUDENT_NOT_FOUND", "找不到這個學號。");
  const pin = generateNumericPin_(6);
  writeRecord_(table, student.__row, { pin_hash: makePinHash_(pin) });
  PropertiesService.getScriptProperties().deleteProperty(sessionPropertyKey_("student", studentId));
  return { credential: { studentId, name: String(student.name), pin } };
}

function setStudentActive_(token, studentIdInput, active) {
  verifySession_(token, "teacher");
  const studentId = normalizeStudentId_(studentIdInput);
  const table = readTable_(SHEETS.STUDENTS);
  const student = table.records.find((row) => normalizeStudentId_(row.student_id) === studentId);
  if (!student) fail_("STUDENT_NOT_FOUND", "找不到這個學號。");
  writeRecord_(table, student.__row, { active: Boolean(active) });
  if (!active) PropertiesService.getScriptProperties().deleteProperty(sessionPropertyKey_("student", studentId));
  return { studentId, active: Boolean(active) };
}

function setStudentGroup_(token, studentIdInput, groupNameInput) {
  verifySession_(token, "teacher");
  const studentId = normalizeStudentId_(studentIdInput);
  const groupName = cleanText_(groupNameInput, 40);
  const spreadsheet = spreadsheet_();
  ensureSheetColumns_(spreadsheet, SHEETS.STUDENTS, ["group_name"]);
  const table = readTable_(SHEETS.STUDENTS);
  const student = table.records.find((row) => normalizeStudentId_(row.student_id) === studentId);
  if (!student) fail_("STUDENT_NOT_FOUND", "找不到這個學號。");
  writeRecord_(table, student.__row, { group_name: groupName });
  return { studentId, groupName };
}

function createAssignment_(token, input) {
  verifySession_(token, "teacher");
  const targetClass = cleanText_(input.targetClass, 40);
  const targetStudents = Array.isArray(input.targetStudents)
    ? input.targetStudents.map(normalizeStudentId_).filter(Boolean)
    : String(input.targetStudents || "").split(",").map(normalizeStudentId_).filter(Boolean);
  if (!targetClass && !targetStudents.length) fail_("MISSING_TARGET", "請指定班級或學生。");

  const assignedDate = validateDate_(input.assignedDate || formatDate_(new Date(), "yyyy-MM-dd"));
  const dueDate = validateDate_(input.dueDate || assignedDate);
  if (dueDate < assignedDate) fail_("INVALID_DUE_DATE", "截止日不可早於發派日。");

  const goalMode = String(input.goalMode || "line_score") === "mastery_target" ? "mastery_target" : "line_score";
  let workSlug = "";
  let workTitle = "";
  let role = "";
  let lineIndices = [];
  let targetPercent = "";
  let targetScore = "";
  if (goalMode === "mastery_target") {
    targetPercent = clampGoalValue_(input.targetPercent, 80);
  } else {
    workSlug = cleanText_(input.workSlug, 80);
    role = cleanText_(input.role, 80);
    const catalog = readTable_(SHEETS.WORK_ROLES).records.find(
      (row) => String(row.work_slug) === workSlug && String(row.role) === role,
    );
    if (!catalog) fail_("INVALID_ROLE", "找不到指定的作品與角色。");
    workTitle = String(catalog.work_title || workSlug);
    const allowed = parseLineIndices_(catalog.line_indices);
    lineIndices = Array.isArray(input.lineIndices)
      ? [...new Set(input.lineIndices.map(Number).filter((value) => Number.isInteger(value) && allowed.includes(value)))]
      : [];
    if (!lineIndices.length) fail_("NO_LINES", "請至少指定一句台詞。");
    if (lineIndices.length > 30) fail_("TOO_MANY_LINES", "單次作業最多指定 30 句。");
    targetScore = clampGoalValue_(input.targetScore, 80);
  }

  const assignmentId = `A${formatDate_(new Date(), "yyyyMMdd-HHmmss")}-${randomHex_(3)}`;
  const defaultTitle = goalMode === "mastery_target"
    ? `${assignedDate.slice(5).replace("-", "/")} 熟練度達 ${targetPercent}%`
    : `${workTitle}｜${role}｜每句 ${targetScore} 分`;
  const title = cleanText_(input.title, 120) || defaultTitle;
  const spreadsheet = spreadsheet_();
  ensureSheetColumns_(spreadsheet, SHEETS.ASSIGNMENTS, ASSIGNMENT_GOAL_HEADERS);
  const table = readTable_(SHEETS.ASSIGNMENTS);
  writeRecord_(table, null, {
    assignment_id: assignmentId,
    title,
    target_class: targetClass,
    target_students: targetStudents.join(","),
    assigned_date: assignedDate,
    due_date: dueDate,
    goal_mode: goalMode,
    target_percent: targetPercent,
    target_score: targetScore,
    work_slug: workSlug,
    work_title: workTitle,
    role,
    required_count: lineIndices.length,
    line_indices: lineIndices.sort((a, b) => a - b).join(","),
    status: "Active",
    created_at: new Date(),
    created_by: "teacher",
  });
  return { assignmentId, title, goalMode, targetPercent, targetScore, lineIndices };
}

function updateAssignmentStatus_(token, assignmentIdInput, statusInput) {
  verifySession_(token, "teacher");
  const assignmentId = cleanText_(assignmentIdInput, 80);
  const status = cleanText_(statusInput, 20);
  if (!["Draft", "Active", "Closed"].includes(status)) fail_("INVALID_STATUS", "作業狀態不正確。");
  const table = readTable_(SHEETS.ASSIGNMENTS);
  const assignment = table.records.find((row) => String(row.assignment_id) === assignmentId);
  if (!assignment) fail_("ASSIGNMENT_NOT_FOUND", "找不到這份作業。");
  writeRecord_(table, assignment.__row, { status });
  return { assignmentId, status };
}

function saveLatestAudio_(input) {
  const mimeType = String(input.mimeType || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.includes(mimeType)) fail_("INVALID_AUDIO_TYPE", "錄音格式不支援，請改用 Chrome 或 Safari 再試。");
  const base64 = String(input.audioBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!base64) fail_("MISSING_AUDIO", "沒有收到錄音檔。");
  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (error) {
    fail_("INVALID_AUDIO", "錄音資料無法讀取。");
  }
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) fail_("AUDIO_TOO_LARGE", "單句錄音不可超過 6 MB。");

  const root = DriveApp.getFolderById(recordingFolderId_());
  const assignmentFolder = childFolder_(root, safeFilePart_(input.assignmentId));
  const studentFolder = childFolder_(assignmentFolder, safeFilePart_(input.studentId));
  const extension = mimeType === "audio/mp4" ? "m4a" : mimeType === "audio/ogg" ? "ogg" : "webm";
  const fileName = `line-${String(input.lineIndex).padStart(3, "0")}.${extension}`;
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = studentFolder.createFile(blob);
  file.setDescription(cleanText_(input.description, 500));
  const prefix = `line-${String(input.lineIndex).padStart(3, "0")}.`;
  const existing = studentFolder.getFiles();
  while (existing.hasNext()) {
    const candidate = existing.next();
    if (candidate.getId() !== file.getId() && candidate.getName().indexOf(prefix) === 0) candidate.setTrashed(true);
  }
  return { fileId: file.getId(), url: file.getUrl(), name: fileName };
}

function childFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) fail_("NOT_CONFIGURED", "平台尚未初始化。");
  return SpreadsheetApp.openById(id);
}

function recordingFolderId_() {
  const id = PropertiesService.getScriptProperties().getProperty("RECORDING_FOLDER_ID");
  if (!id) fail_("NOT_CONFIGURED", "錄音資料夾尚未設定。");
  return id;
}

function readTable_(sheetName) {
  const sheet = spreadsheet_().getSheetByName(sheetName);
  if (!sheet) fail_("MISSING_SHEET", `缺少 ${sheetName} 工作表。`);
  const lastColumn = sheet.getLastColumn();
  const lastRow = Math.max(1, sheet.getLastRow());
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map((value) => String(value).trim());
  const indexes = {};
  headers.forEach((header, index) => { indexes[header] = index; });
  const records = values.slice(1).map((row, index) => {
    const record = { __row: index + 2 };
    headers.forEach((header, column) => { record[header] = row[column]; });
    return record;
  }).filter((record) => headers.some((header) => record[header] !== ""));
  return { sheet, headers, indexes, records };
}

function writeRecord_(table, rowNumber, values) {
  const row = rowNumber || table.sheet.getLastRow() + 1;
  if (row > table.sheet.getMaxRows()) {
    table.sheet.insertRowsAfter(table.sheet.getMaxRows(), Math.max(500, row - table.sheet.getMaxRows()));
  }
  const range = table.sheet.getRange(row, 1, 1, table.headers.length);
  const rowValues = rowNumber ? range.getValues()[0] : new Array(table.headers.length).fill("");
  Object.keys(values).forEach((header) => {
    const column = table.indexes[header];
    if (column === undefined) fail_("MISSING_COLUMN", `資料表缺少欄位：${header}`);
    rowValues[column] = values[header];
  });
  range.setValues([rowValues]);
  return row;
}

function ensureSheetColumns_(spreadsheet, sheetName, headers) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`缺少 ${sheetName} 工作表。`);
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((value) => String(value).trim());
  headers.forEach((header) => {
    if (existing.includes(header)) return;
    const nextColumn = existing.length + 1;
    sheet.getRange(1, nextColumn).setValue(header);
    existing.push(header);
  });
}

function ensureSheetWithHeaders_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getLastColumn() === 0 || !String(sheet.getRange(1, 1).getValue()).trim()) {
    sheet.getRange(1, 1, 1, headers.length).setValues([Array.from(headers)]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  ensureSheetColumns_(spreadsheet, sheetName, headers);
  sheet.setFrozenRows(1);
  return sheet;
}

function updateCellByHeader_(table, row, header, value) {
  const column = table.indexes[header];
  if (column !== undefined) table.sheet.getRange(row, column + 1).setValue(value);
}

function settingsMapFrom_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHEETS.SETTINGS);
  if (!sheet) throw new Error("缺少 Settings 工作表。");
  const values = sheet.getDataRange().getValues();
  const settings = {};
  values.slice(1).forEach((row) => { if (row[0]) settings[String(row[0]).trim()] = row[1]; });
  return settings;
}

function writeSettingValue_(spreadsheet, key, value) {
  const sheet = spreadsheet.getSheetByName(SHEETS.SETTINGS);
  const values = sheet.getDataRange().getValues();
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0]).trim() === key) {
      sheet.getRange(index + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, "由 Apps Script 初始化建立"]);
}

function setting_(key, fallback) {
  const settings = settingsMapFrom_(spreadsheet_());
  return settings[key] === undefined || settings[key] === "" ? fallback : settings[key];
}

function activeStudent_(studentId, expectedPinTag) {
  const student = readTable_(SHEETS.STUDENTS).records.find((row) => normalizeStudentId_(row.student_id) === studentId);
  if (!student || !isTrue_(student.active)) fail_("ACCOUNT_INACTIVE", "帳號不存在或已停用。");
  if (expectedPinTag && !constantTimeEqual_(credentialTag_(student.pin_hash), expectedPinTag)) {
    fail_("SESSION_EXPIRED", "PIN 已由老師重設，請使用新 PIN 重新登入。");
  }
  return student;
}

function studentProfile_(student) {
  const workSlug = String(student && student.selected_work_slug || "").trim();
  const roles = parseSelectedRoles_(student && student.selected_roles, student && student.selected_role);
  if (!workSlug || !roles.length) return null;
  return {
    groupName: String(student.group_name || "").trim(),
    workSlug,
    workTitle: String(student.selected_work_title || workSlug),
    roles,
    role: roles[0],
    updatedAt: isoValue_(student.preference_updated_at),
  };
}

function parseSelectedRoles_(value, fallbackRole) {
  let values = [];
  if (Array.isArray(value)) {
    values = value;
  } else {
    const text = String(value || "").trim();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        values = Array.isArray(parsed) ? parsed : [text];
      } catch (error) {
        values = text.split(/[,、]/);
      }
    }
  }
  const fallback = String(fallbackRole || "").trim();
  if (!values.length && fallback) values = [fallback];
  return [...new Set(values.map((role) => cleanText_(role, 80)).filter(Boolean))];
}

function studentMatchesAssignmentProfile_(student, assignment) {
  if (assignmentGoalMode_(assignment) === "mastery_target") return Boolean(studentProfile_(student));
  const profile = studentProfile_(student);
  return Boolean(profile
    && String(assignment.work_slug) === profile.workSlug
    && profile.roles.includes(String(assignment.role)));
}

function assignmentGoalMode_(assignment) {
  return String(assignment && assignment.goal_mode || "line_score") === "mastery_target"
    ? "mastery_target"
    : "line_score";
}

function clampGoalValue_(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(100, Math.round(number))) : fallback;
}

function clampOptionalScore_(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

function selfPracticeId_(workSlug, role) {
  return `SELF-${cleanText_(workSlug, 80)}-${cleanText_(role, 80)}`;
}

function scoreValueFromRow_(row, primary, fallback) {
  let value = row && row[primary];
  if ((value === "" || value === null || value === undefined) && fallback) value = row && row[fallback];
  if (value === "" || value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return clampScore_(value);
}

function scoreAspectsFromRow_(row) {
  return {
    accent: scoreValueFromRow_(row, "accent_score", null) || 0,
    intonation: scoreValueFromRow_(row, "intonation_score", null) || 0,
    speed: scoreValueFromRow_(row, "speed_score", "timing_score") || 0,
    volume: scoreValueFromRow_(row, "volume_score", "audio_quality") || 0,
  };
}

function aspectAveragesFromRows_(rows) {
  const fields = {
    accent: ["accent_score", null],
    intonation: ["intonation_score", null],
    speed: ["speed_score", "timing_score"],
    volume: ["volume_score", "audio_quality"],
  };
  const output = {};
  Object.keys(fields).forEach((key) => {
    const values = rows.map((row) => scoreValueFromRow_(row, fields[key][0], fields[key][1]))
      .filter((value) => value !== null);
    output[key] = values.length ? roundOne_(average_(values)) : 0;
  });
  return output;
}

function buildSelfPractice_(student, studentResults, catalogs) {
  const profile = studentProfile_(student);
  if (!profile) return [];
  return profile.roles.map((role) => {
    const catalog = catalogs.find((row) => String(row.work_slug) === profile.workSlug && String(row.role) === role);
    if (!catalog) return null;
    const lineIndices = parseLineIndices_(catalog.line_indices);
    const matching = studentResults.filter((row) => String(row.work_slug) === profile.workSlug
      && String(row.role) === role && lineIndices.includes(Number(row.line_index)));
    const latestByLine = {};
    matching.forEach((row) => {
      const lineIndex = Number(row.line_index);
      const current = latestByLine[lineIndex];
      if (!current || isoValue_(row.updated_at || row.submitted_at) > isoValue_(current.updated_at || current.submitted_at)) {
        latestByLine[lineIndex] = row;
      }
    });
    const lineResults = {};
    Object.keys(latestByLine).forEach((lineIndex) => {
      const row = latestByLine[lineIndex];
      lineResults[lineIndex] = {
        score: clampScore_(row.overall_score),
        attempts: matching.filter((item) => Number(item.line_index) === Number(lineIndex))
          .reduce((sum, item) => sum + Math.max(1, Number(item.attempt_count) || 1), 0),
        updatedAt: isoValue_(row.updated_at || row.submitted_at),
        achieved: true,
        aspects: scoreAspectsFromRow_(row),
      };
    });
    const latestRows = Object.values(latestByLine);
    const scoreTotal = latestRows.reduce((sum, row) => sum + clampScore_(row.overall_score), 0);
    return {
      assignmentId: selfPracticeId_(profile.workSlug, role),
      title: `${role}自主練習`,
      goalMode: "self_practice",
      selfPractice: true,
      workSlug: profile.workSlug,
      workTitle: profile.workTitle,
      role,
      lineIndices,
      requiredCount: lineIndices.length,
      completed: latestRows.length,
      completionRate: lineIndices.length ? Math.round((latestRows.length / lineIndices.length) * 100) : 0,
      masteryPercent: lineIndices.length ? roundOne_(scoreTotal / lineIndices.length) : 0,
      aspectAverages: aspectAveragesFromRows_(latestRows),
      lineResults,
    };
  }).filter(Boolean);
}

function studentProgress_(student, allResults, catalogs) {
  const profile = studentProfile_(student);
  if (!profile) {
    return {
      masteryPercent: 0,
      practicedLines: 0,
      totalLines: 0,
      totalAttempts: 0,
      totalDurationSec: 0,
      aspectAverages: { accent: 0, intonation: 0, speed: 0, volume: 0 },
    };
  }
  const selectedRoles = new Set(profile.roles);
  const selectedCatalogs = catalogs.filter((row) => String(row.work_slug) === profile.workSlug
    && selectedRoles.has(String(row.role)));
  const totalLines = selectedCatalogs.reduce((sum, catalog) => sum
    + Math.max(0, Number(catalog.total_lines) || parseLineIndices_(catalog.line_indices).length), 0);
  const matching = allResults.filter((row) => normalizeStudentId_(row.student_id) === normalizeStudentId_(student.student_id)
    && String(row.work_slug) === profile.workSlug
    && selectedRoles.has(String(row.role)));
  const latestByLine = {};
  matching.forEach((row) => {
    const lineIndex = Number(row.line_index);
    const key = `${row.role}|${lineIndex}`;
    const current = latestByLine[key];
    if (!current || isoValue_(row.updated_at || row.submitted_at) > isoValue_(current.updated_at || current.submitted_at)) {
      latestByLine[key] = row;
    }
  });
  const latestRows = Object.values(latestByLine);
  const scoreTotal = latestRows.reduce((sum, row) => sum + clampScore_(row.overall_score), 0);
  return {
    masteryPercent: totalLines ? roundOne_(scoreTotal / totalLines) : 0,
    practicedLines: latestRows.length,
    totalLines,
    totalAttempts: matching.reduce((sum, row) => sum + Math.max(1, Number(row.attempt_count) || 1), 0),
    totalDurationSec: roundOne_(matching.reduce((sum, row) => sum
      + Math.max(0, Number(row.total_recording_duration_sec) || Number(row.recording_duration_sec) || 0), 0)),
    aspectAverages: aspectAveragesFromRows_(latestRows),
  };
}

function buildClassProgress_(students, results, catalogs) {
  return students.map((student) => {
    const profile = studentProfile_(student);
    return Object.assign({
      seatNo: String(student.seat_no || ""),
      studentId: String(student.student_id || ""),
      name: String(student.name || ""),
      className: String(student.class || ""),
      groupName: String(student.group_name || "").trim(),
      profile,
    }, studentProgress_(student, results, catalogs));
  }).sort((left, right) => String(left.groupName || "未分組").localeCompare(String(right.groupName || "未分組"))
    || Number(left.seatNo) - Number(right.seatNo));
}

function buildGroupSummaries_(studentRows) {
  const groups = {};
  studentRows.forEach((student) => {
    const name = student.groupName || "未分組";
    if (!groups[name]) groups[name] = { groupName: name, students: [], masteryTotal: 0, practicedLines: 0, totalLines: 0, totalAttempts: 0, totalDurationSec: 0 };
    const group = groups[name];
    group.students.push({ studentId: student.studentId, name: student.name, masteryPercent: student.masteryPercent });
    group.masteryTotal += student.masteryPercent;
    group.practicedLines += student.practicedLines;
    group.totalLines += student.totalLines;
    group.totalAttempts += student.totalAttempts;
    group.totalDurationSec += student.totalDurationSec;
  });
  return Object.values(groups).map((group) => ({
    groupName: group.groupName,
    memberCount: group.students.length,
    averageMastery: group.students.length ? roundOne_(group.masteryTotal / group.students.length) : 0,
    practicedLines: group.practicedLines,
    totalLines: group.totalLines,
    totalAttempts: group.totalAttempts,
    totalDurationSec: roundOne_(group.totalDurationSec),
    students: group.students,
  })).sort((left, right) => left.groupName.localeCompare(right.groupName));
}

function average_(values) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

function roundOne_(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function assignmentTargetsStudent_(assignment, student) {
  const studentId = normalizeStudentId_(student.student_id);
  const targetStudents = String(assignment.target_students || "").split(",").map(normalizeStudentId_).filter(Boolean);
  if (targetStudents.length && targetStudents.includes(studentId)) return true;
  const targetClass = String(assignment.target_class || "").trim();
  return Boolean(targetClass && targetClass === String(student.class || "").trim());
}

function appendLoginLog_(accountType, studentId, success, message, userAgent, sessionExpiresAt) {
  try {
    const table = readTable_(SHEETS.LOGIN_LOG);
    writeRecord_(table, null, {
      timestamp: new Date(),
      account_type: accountType,
      student_id: studentId,
      success: Boolean(success),
      message,
      user_agent: userAgent,
      session_expires_at: sessionExpiresAt || "",
    });
  } catch (error) {
    console.error(`Login log failed: ${error}`);
  }
}

function createSession_(identity) {
  const hours = Math.max(1, Math.min(48, Number(setting_("SESSION_HOURS", 12)) || 12));
  const expiresAt = Date.now() + hours * 60 * 60 * 1000;
  const payload = Object.assign({}, identity, {
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt / 1000),
  });
  const token = `${identity.type}.${base64UrlEncode_(String(identity.sub))}.${randomHex_(32)}`;
  PropertiesService.getScriptProperties().setProperty(
    sessionPropertyKey_(identity.type, identity.sub),
    JSON.stringify({ tokenDigest: tokenDigest_(token), payload }),
  );
  return { token, expiresAt };
}

function verifySession_(tokenInput, expectedType) {
  const token = String(tokenInput || "");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== expectedType) fail_("SESSION_INVALID", "登入已失效，請重新登入。");
  let subject;
  try {
    subject = base64UrlDecode_(parts[1]);
  } catch (error) {
    fail_("SESSION_INVALID", "登入已失效，請重新登入。");
  }
  const properties = PropertiesService.getScriptProperties();
  const propertyKey = sessionPropertyKey_(expectedType, subject);
  let session;
  try {
    session = JSON.parse(properties.getProperty(propertyKey) || "null");
  } catch (error) {
    fail_("SESSION_INVALID", "登入已失效，請重新登入。");
  }
  const payload = session && session.payload;
  if (!payload || payload.type !== expectedType || String(payload.sub) !== String(subject)
      || !constantTimeEqual_(tokenDigest_(token), session.tokenDigest)) {
    fail_("SESSION_INVALID", "登入已失效，請重新登入。");
  }
  if (payload.type !== expectedType || Number(payload.exp) <= Math.floor(Date.now() / 1000)) {
    properties.deleteProperty(propertyKey);
    fail_("SESSION_EXPIRED", "登入已過期，請重新登入。");
  }
  if (expectedType === "teacher") {
    const currentTag = credentialTag_(PropertiesService.getScriptProperties().getProperty("TEACHER_PIN_HASH"));
    if (!payload.authTag || !constantTimeEqual_(payload.authTag, currentTag)) {
      fail_("SESSION_EXPIRED", "老師密碼已重設，請重新登入。");
    }
  }
  return payload;
}

function sessionPropertyKey_(type, subject) {
  return `SESSION_${String(type).toUpperCase()}_${tokenDigest_(String(subject)).slice(0, 32)}`;
}

function tokenDigest_(value) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8,
  ));
}

function sign_(value) {
  const secret = PropertiesService.getScriptProperties().getProperty("SESSION_SECRET");
  if (!secret) fail_("NOT_CONFIGURED", "平台尚未初始化。");
  return bytesToHex_(Utilities.computeHmacSha256Signature(String(value), secret, Utilities.Charset.UTF_8));
}

function makePinHash_(pin) {
  const salt = randomHex_(16);
  return `${salt}$${pinDigest_(pin, salt)}`;
}

function verifyPin_(pin, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 2 || !pin) return false;
  return constantTimeEqual_(pinDigest_(pin, parts[0]), parts[1]);
}

function pinDigest_(pin, salt) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    `${salt}:${String(pin)}`,
    Utilities.Charset.UTF_8,
  ));
}

function credentialTag_(storedHash) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(storedHash || ""),
    Utilities.Charset.UTF_8,
  )).slice(0, 24);
}

function enforceLoginLimit_(key) {
  const attempts = Number(CacheService.getScriptCache().get(key) || 0);
  if (attempts >= LOGIN_LIMIT) fail_("LOGIN_LOCKED", "輸入錯誤次數過多，請 10 分鐘後再試，或請老師重設 PIN。");
}

function registerLoginFailure_(key) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const cache = CacheService.getScriptCache();
    const attempts = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(attempts), LOGIN_LOCK_SECONDS);
  } finally {
    lock.releaseLock();
  }
}

function clearLoginFailures_(key) {
  CacheService.getScriptCache().remove(key);
}

function isConfigured_() {
  const properties = PropertiesService.getScriptProperties();
  return Boolean(
    properties.getProperty("SPREADSHEET_ID")
    && properties.getProperty("RECORDING_FOLDER_ID")
    && properties.getProperty("SESSION_SECRET")
    && properties.getProperty("TEACHER_PIN_HASH"),
  );
}

function requireConfigured_() {
  if (!isConfigured_()) fail_("NOT_CONFIGURED", "平台尚未初始化。");
}

function generateNumericPin_(length) {
  const bytes = Utilities.getUuid().replace(/-/g, "");
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += String(parseInt(bytes[index], 16) % 10);
  }
  if (output[0] === "0") output = String((Number(output[0]) + 1) % 10) + output.slice(1);
  return output;
}

function randomHex_(bytes) {
  let output = "";
  while (output.length < bytes * 2) output += Utilities.getUuid().replace(/-/g, "");
  return output.slice(0, bytes * 2);
}

function bytesToHex_(bytes) {
  return bytes.map((value) => ((value < 0 ? value + 256 : value).toString(16).padStart(2, "0"))).join("");
}

function constantTimeEqual_(leftInput, rightInput) {
  const left = String(leftInput || "");
  const right = String(rightInput || "");
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function base64UrlEncode_(value) {
  return Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8).replace(/=+$/g, "");
}

function base64UrlDecode_(value) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(value)).getDataAsString("UTF-8");
}

function normalizeStudentId_(value) {
  return String(value || "").trim().replace(/\s+/g, "").slice(0, 30);
}

function normalizeOptionalStudentPin_(value) {
  const pin = String(value === undefined || value === null ? "" : value).trim();
  if (!pin) return "";
  if (!/^\d{5,8}$/.test(pin)) fail_("INVALID_PIN", "學生 PIN 必須是 5 至 8 位數字。");
  return pin;
}

function normalizeRequiredStudentPin_(value) {
  const pin = normalizeOptionalStudentPin_(value);
  if (!pin) fail_("INVALID_PIN", "學生 PIN 必須是 5 至 8 位數字。");
  return pin;
}

function cleanText_(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength || 500);
}

function safeFilePart_(value) {
  const safe = cleanText_(value, 100).replace(/[^0-9A-Za-z._-]/g, "-").replace(/-+/g, "-");
  return safe || "unknown";
}

function clampScore_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 10) / 10)) : 0;
}

function parseLineIndices_(value) {
  return [...new Set(String(value || "").split(",").map(Number).filter((index) => Number.isInteger(index) && index > 0))];
}

function isTrue_(value) {
  return value === true || String(value).toLowerCase() === "true" || String(value) === "1";
}

function validateDate_(value) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00+08:00`).getTime())) {
    fail_("INVALID_DATE", "日期格式不正確。");
  }
  return date;
}

function dateKey_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) return formatDate_(value, "yyyy-MM-dd");
  const string = String(value);
  const match = string.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : formatDate_(date, "yyyy-MM-dd");
}

function isoValue_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function formatDate_(date, pattern) {
  return Utilities.formatDate(date, "Asia/Taipei", pattern);
}

function fail_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  error.publicMessage = message;
  throw error;
}

function publicError_(error) {
  return {
    code: error && error.publicCode ? error.publicCode : "SERVER_ERROR",
    message: error && error.publicMessage ? error.publicMessage : "系統暫時無法處理，請稍後再試。",
  };
}
