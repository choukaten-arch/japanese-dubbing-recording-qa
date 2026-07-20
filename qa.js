const state = {
  data: null,
  selectedIndex: 0,
  visibleIndexes: [],
  mediaRecorder: null,
  mediaStream: null,
  chunks: [],
  recordingBlob: null,
  recordingUrl: "",
  recordingStartedAt: 0,
  recordingDuration: 0,
  recordingEndProgress: 0,
  timerId: null,
  audioContext: null,
  analyser: null,
  waveformFrame: null,
  waveformSamples: 0,
  waveformSquares: 0,
  clippingSamples: 0,
  recognition: null,
  finalTranscript: "",
  interimTranscript: "",
  referenceStopAt: null,
  isPreparing: false,
  isReviewing: false,
  karaokeCharacters: [],
  karaokeSyncSamples: [],
};

const elements = {};

function cacheElements() {
  [
    "workMeta", "evaluationMode", "linePosition", "referenceVideo", "videoLoading",
    "previousLine", "playReference", "nextLine", "selectedRole", "selectedTime",
    "selectedJapanese", "selectedTranslation", "recordState", "recordTimer", "waveform",
    "karaokeOverlay", "karaokeJapanese", "karaokeTranslation", "karaokeGuide", "karaokeGuideLabel", "karaokeGuideBar",
    "startRecording", "stopRecording", "recordingReview", "recordingPlayback", "playSyncedReview", "recognizedText",
    "recognitionStatus", "evaluateRecording", "resetRecording", "resultPanel", "overallScore",
    "resultMode", "performanceRadar", "scoreRows", "textDiff", "issueList", "searchLines", "roleFilter",
    "visibleCount", "lineList", "fatalState",
  ].forEach((id) => { elements[id] = document.getElementById(id); });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(seconds, millis = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const base = `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  if (!millis) return base;
  return `${base}.${String(Math.round((safe % 1) * 1000)).padStart(3, "0")}`;
}

function currentLine() {
  return state.data.lines[state.selectedIndex];
}

function renderHeader() {
  elements.workMeta.textContent = `${state.data.durationLabel} · ${state.data.lineCount} 句 · ${state.data.roleCount} 角`;
  elements.evaluationMode.textContent = window.QA_CONFIG.evaluationApiUrl ? "API 評分" : "瀏覽器練習指標";
  elements.referenceVideo.src = new URL(state.data.video, window.QA_CONFIG.productionSiteBase).href;
  elements.referenceVideo.poster = new URL(state.data.poster, window.QA_CONFIG.productionSiteBase).href;

  state.data.roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role.role;
    option.textContent = role.role;
    elements.roleFilter.append(option);
  });
}

function renderLineList() {
  const fragment = document.createDocumentFragment();
  state.data.lines.forEach((line, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "script-line";
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="script-line__number">${escapeHtml(line.displayIndex || String(line.index).padStart(2, "0"))}</span>
      <span class="script-line__time">${formatTime(line.start)}</span>
      <span class="script-line__content"><strong>${escapeHtml(line.role)}</strong><span lang="ja">${line.japaneseHtml}</span></span>
      <span class="script-line__select" aria-hidden="true">›</span>`;
    button.addEventListener("click", () => selectLine(index, true));
    fragment.append(button);
  });
  elements.lineList.replaceChildren(fragment);
  applyFilters();
}

function applyFilters() {
  const query = elements.searchLines.value.trim().toLocaleLowerCase();
  const role = elements.roleFilter.value;
  state.visibleIndexes = [];
  state.data.lines.forEach((line, index) => {
    const button = elements.lineList.querySelector(`[data-index="${index}"]`);
    const searchable = `${line.role} ${line.japanese} ${line.translation}`.toLocaleLowerCase();
    const visible = (!role || line.role === role) && (!query || searchable.includes(query));
    button.hidden = !visible;
    if (visible) state.visibleIndexes.push(index);
  });
  elements.visibleCount.textContent = `${state.visibleIndexes.length} / ${state.data.lineCount}`;
}

function selectLine(index, scroll = false) {
  if (!state.data.lines[index] || state.isPreparing || state.mediaRecorder?.state === "recording") return;
  const previous = elements.lineList.querySelector(".script-line.is-selected");
  previous?.classList.remove("is-selected");
  previous?.removeAttribute("aria-current");

  state.selectedIndex = index;
  const line = currentLine();
  const selected = elements.lineList.querySelector(`[data-index="${index}"]`);
  selected?.classList.add("is-selected");
  selected?.setAttribute("aria-current", "true");
  document.body.classList.toggle("sound-effect-mode", Boolean(line.isSoundEffect));
  elements.linePosition.textContent = line.isSoundEffect
    ? `${line.displayIndex} · ${line.cueTime}`
    : `第 ${line.index} / ${state.data.lineCount} 句`;
  elements.selectedRole.textContent = line.role;
  elements.selectedTime.textContent = `${formatTime(line.start)} – ${formatTime(line.end)}`;
  elements.selectedJapanese.innerHTML = line.japaneseHtml;
  elements.selectedTranslation.textContent = line.translation;
  elements.referenceVideo.pause();
  state.referenceStopAt = null;
  resetRecording();
  elements.recognitionStatus.textContent = line.isSoundEffect ? "音效模式不需要逐字辨識" : "尚未錄音";
  elements.recognizedText.placeholder = line.isSoundEffect ? "音效模式不需輸入台詞" : "錄音後顯示辨識結果，也可以手動修正";
  history.replaceState(null, "", `#line-${line.index}`);
  if (scroll && selected) selected.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function adjacentLine(direction) {
  const position = state.visibleIndexes.indexOf(state.selectedIndex);
  if (position < 0) return;
  const nextPosition = Math.max(0, Math.min(state.visibleIndexes.length - 1, position + direction));
  selectLine(state.visibleIndexes[nextPosition], true);
}

function seekVideo(time) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      elements.referenceVideo.removeEventListener("seeked", finish);
      resolve();
    };
    const timeout = setTimeout(finish, 1200);
    elements.referenceVideo.addEventListener("seeked", finish, { once: true });
    elements.referenceVideo.currentTime = time;
  });
}

async function playReference() {
  if (state.isPreparing || state.mediaRecorder?.state === "recording") return;
  const line = currentLine();
  stopSyncedReview();
  hideKaraokeOverlay();
  elements.referenceVideo.pause();
  elements.referenceVideo.muted = false;
  elements.referenceVideo.controls = true;
  await seekVideo(line.start);
  state.referenceStopAt = line.end;
  await elements.referenceVideo.play().catch(() => {});
}

function handleReferenceTime() {
  if (!elements.karaokeOverlay.hidden) updateKaraokeProgress(elements.referenceVideo.currentTime);
  if (state.referenceStopAt === null) return;
  if (elements.referenceVideo.currentTime >= state.referenceStopAt - 0.04) {
    const shouldStopRecording = state.mediaRecorder?.state === "recording";
    const shouldStopReview = state.isReviewing;
    elements.referenceVideo.pause();
    elements.referenceVideo.currentTime = state.referenceStopAt;
    state.referenceStopAt = null;
    if (shouldStopRecording) stopRecording();
    if (shouldStopReview) stopSyncedReview(false);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function renderKaraokeOverlay() {
  const line = currentLine();
  const fragment = document.createDocumentFragment();
  const displayText = line.isSoundEffect ? `${line.soundName}｜${line.cueTime}` : line.japanese;
  state.karaokeCharacters = [...displayText].map((character) => {
    const span = document.createElement("span");
    span.className = "karaoke-character";
    span.textContent = character;
    span.setAttribute("aria-hidden", "true");
    fragment.append(span);
    return span;
  });
  elements.karaokeJapanese.replaceChildren(fragment);
  elements.karaokeJapanese.setAttribute("aria-label", displayText);
  elements.karaokeTranslation.textContent = line.translation;
  elements.karaokeGuide.dataset.state = "waiting";
  elements.karaokeGuideLabel.textContent = "準備開始";
  elements.karaokeGuideBar.style.width = "0%";
  elements.karaokeGuide.style.setProperty("--expected-progress", "0%");
  elements.karaokeOverlay.hidden = false;
}

function hideKaraokeOverlay() {
  elements.karaokeOverlay.hidden = true;
  elements.karaokeJapanese.replaceChildren();
  elements.karaokeTranslation.textContent = "";
  state.karaokeCharacters = [];
}

function setKaraokeGuide(status, label, spokenProgress, expectedProgress) {
  elements.karaokeGuide.dataset.state = status;
  elements.karaokeGuideLabel.textContent = label;
  elements.karaokeGuideBar.style.width = `${Math.round(Math.max(0, Math.min(1, spokenProgress)) * 100)}%`;
  elements.karaokeGuide.style.setProperty("--expected-progress", `${Math.round(Math.max(0, Math.min(1, expectedProgress)) * 100)}%`);
}

function updateKaraokeProgress(videoTime) {
  const line = currentLine();
  const duration = Math.max(0.1, line.end - line.start);
  const expectedProgress = Math.max(0, Math.min(1, (Number(videoTime) - line.start) / duration));
  const coloredCount = Math.floor(expectedProgress * state.karaokeCharacters.length);
  state.karaokeCharacters.forEach((character, index) => character.classList.toggle("is-sung", index < coloredCount));

  if (state.isReviewing) {
    setKaraokeGuide("review", "同步回看中", expectedProgress, expectedProgress);
    return;
  }
  if (state.mediaRecorder?.state !== "recording") return;
  if (line.isSoundEffect) {
    setKaraokeGuide("on-time", "依時間軸製作音效", expectedProgress, expectedProgress);
    return;
  }
  const target = normalizeJapanese(line.japanese);
  const recognized = normalizeJapanese(`${state.finalTranscript}${state.interimTranscript}`);
  if (!state.recognition) {
    setKaraokeGuide("waiting", "字幕同步中", expectedProgress, expectedProgress);
    return;
  }
  const spokenProgress = Math.min(1, recognized.length / Math.max(1, target.length));
  if (!recognized) {
    setKaraokeGuide("waiting", expectedProgress < 0.18 ? "準備開口" : "等待辨識", 0, expectedProgress);
    return;
  }
  const difference = spokenProgress - expectedProgress;
  if (Math.abs(difference) <= 0.14) setKaraokeGuide("on-time", "跟上節奏", spokenProgress, expectedProgress);
  else if (difference < 0) setKaraokeGuide("behind", "稍慢一點", spokenProgress, expectedProgress);
  else setKaraokeGuide("ahead", "稍快一點", spokenProgress, expectedProgress);
}

function captureKaraokeSyncSample() {
  if (state.mediaRecorder?.state !== "recording") return;
  const line = currentLine();
  const target = normalizeJapanese(line.japanese);
  const recognized = normalizeJapanese(`${state.finalTranscript}${state.interimTranscript}`);
  if (!target || !recognized) return;
  const expectedProgress = Math.max(0, Math.min(1, (elements.referenceVideo.currentTime - line.start) / Math.max(0.1, line.end - line.start)));
  const spokenProgress = Math.min(1, recognized.length / target.length);
  const previous = state.karaokeSyncSamples.at(-1);
  if (previous && Math.abs(previous.expectedProgress - expectedProgress) < 0.035) return;
  state.karaokeSyncSamples.push({ expectedProgress, spokenProgress });
}

function karaokeFollowScore() {
  const samples = state.karaokeSyncSamples.filter((sample) => sample.expectedProgress >= 0.08);
  if (!samples.length) return null;
  const scores = samples.map((sample) => {
    const difference = Math.abs(sample.spokenProgress - sample.expectedProgress);
    return difference <= 0.22 ? 100 : Math.max(55, 100 - (difference - 0.22) * 115);
  });
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function stopSyncedReview(pauseVideo = true) {
  if (!state.isReviewing) return;
  state.isReviewing = false;
  document.body.classList.remove("is-reviewing");
  elements.recordingPlayback.pause();
  if (pauseVideo) elements.referenceVideo.pause();
  elements.referenceVideo.controls = true;
  state.referenceStopAt = null;
  elements.playSyncedReview.innerHTML = '<span aria-hidden="true">▶</span>搭配影片回看';
  setKaraokeGuide("complete", "回看完成", 1, 1);
}

async function toggleSyncedReview() {
  if (!state.recordingBlob || state.isPreparing || state.mediaRecorder?.state === "recording") return;
  if (state.isReviewing) {
    stopSyncedReview();
    return;
  }
  const line = currentLine();
  elements.referenceVideo.pause();
  elements.recordingPlayback.pause();
  await seekVideo(line.start);
  elements.referenceVideo.muted = true;
  elements.referenceVideo.controls = false;
  elements.recordingPlayback.currentTime = 0;
  renderKaraokeOverlay();
  state.isReviewing = true;
  state.referenceStopAt = line.end;
  document.body.classList.add("is-reviewing");
  elements.playSyncedReview.innerHTML = '<span aria-hidden="true">■</span>停止同步回看';
  setKaraokeGuide("review", "同步回看中", 0, 0);
  await Promise.allSettled([
    elements.referenceVideo.play(),
    elements.recordingPlayback.play(),
  ]);
}

function chooseMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
}

function drawIdleWaveform() {
  const canvas = elements.waveform;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#9fb0a8";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, canvas.height / 2);
  context.lineTo(canvas.width, canvas.height / 2);
  context.stroke();
}

function drawWaveform() {
  if (!state.analyser) return;
  const canvas = elements.waveform;
  const context = canvas.getContext("2d");
  const samples = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(samples);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#196b56";
  context.lineWidth = 3;
  context.beginPath();
  let sum = 0;
  let clipped = 0;
  samples.forEach((sample, index) => {
    sum += sample * sample;
    if (Math.abs(sample) >= 0.98) clipped += 1;
    const x = (index / (samples.length - 1)) * canvas.width;
    const y = (0.5 - sample * 0.42) * canvas.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  state.waveformSquares += sum;
  state.waveformSamples += samples.length;
  state.clippingSamples += clipped;
  state.waveformFrame = requestAnimationFrame(drawWaveform);
}

function createRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const value = event.results[index][0].transcript;
      if (event.results[index].isFinal) state.finalTranscript += value;
      else interim += value;
    }
    state.interimTranscript = interim;
    elements.recognizedText.value = `${state.finalTranscript}${state.interimTranscript}`.trim();
    elements.recognitionStatus.textContent = interim ? "辨識中" : "已取得辨識結果";
    captureKaraokeSyncSample();
    updateKaraokeProgress(elements.referenceVideo.currentTime);
  };
  recognition.onerror = () => {
    elements.recognitionStatus.textContent = "自動辨識未完成，可手動輸入";
  };
  return recognition;
}

async function startRecording() {
  if (state.isPreparing || state.mediaRecorder?.state === "recording") return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    elements.recordState.textContent = "此瀏覽器不支援錄音";
    return;
  }
  resetRecording();
  state.isPreparing = true;
  elements.startRecording.disabled = true;
  elements.evaluateRecording.disabled = true;
  elements.resetRecording.disabled = true;
  document.body.classList.add("is-preparing");
  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 1024;
    source.connect(state.analyser);

    const mimeType = chooseMimeType();
    state.mediaRecorder = mimeType
      ? new MediaRecorder(state.mediaStream, { mimeType })
      : new MediaRecorder(state.mediaStream);
    state.chunks = [];
    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) state.chunks.push(event.data);
    };
    state.mediaRecorder.onstop = finishRecording;

    const line = currentLine();
    renderKaraokeOverlay();
    elements.referenceVideo.pause();
    elements.referenceVideo.muted = true;
    elements.referenceVideo.controls = false;
    await seekVideo(line.start);
    for (let count = 3; count >= 1; count -= 1) {
      elements.recordState.textContent = `倒數 ${count}`;
      elements.recordTimer.textContent = String(count);
      setKaraokeGuide("waiting", `倒數 ${count}`, 0, 0);
      await wait(700);
    }

    state.mediaRecorder.start(200);

    state.recognition = line.isSoundEffect ? null : createRecognition();
    try { state.recognition?.start(); } catch {}

    state.isPreparing = false;
    document.body.classList.remove("is-preparing");
    state.recordingStartedAt = performance.now();
    state.timerId = setInterval(updateRecordingTimer, 100);
    state.referenceStopAt = line.end;
    elements.recordState.textContent = "錄音中";
    elements.recordTimer.textContent = "00:00.0";
    elements.startRecording.disabled = true;
    elements.stopRecording.disabled = false;
    elements.evaluateRecording.disabled = true;
    elements.resetRecording.disabled = true;
    document.body.classList.add("is-recording");
    drawWaveform();
    setKaraokeGuide("waiting", line.isSoundEffect ? "準備音效" : (state.recognition ? "準備開口" : "字幕同步中"), 0, 0);
    await elements.referenceVideo.play().catch(() => {});
  } catch (error) {
    const message = error.name === "NotAllowedError" ? "未取得麥克風權限" : "無法啟動麥克風";
    state.isPreparing = false;
    document.body.classList.remove("is-preparing");
    state.mediaStream?.getTracks().forEach((track) => track.stop());
    state.audioContext?.close();
    elements.referenceVideo.pause();
    elements.referenceVideo.muted = false;
    elements.referenceVideo.controls = true;
    hideKaraokeOverlay();
    elements.startRecording.disabled = false;
    elements.stopRecording.disabled = true;
    elements.recordState.textContent = message;
    elements.recordTimer.textContent = "00:00.0";
    elements.recognitionStatus.textContent = "請檢查瀏覽器麥克風設定";
  }
}

function updateRecordingTimer() {
  state.recordingDuration = (performance.now() - state.recordingStartedAt) / 1000;
  elements.recordTimer.textContent = `${formatTime(state.recordingDuration, false)}.${Math.floor((state.recordingDuration % 1) * 10)}`;
  updateKaraokeProgress(elements.referenceVideo.currentTime);
}

function stopRecording() {
  if (state.mediaRecorder?.state !== "recording") return;
  state.recordingDuration = (performance.now() - state.recordingStartedAt) / 1000;
  state.recordingEndProgress = Math.max(0, Math.min(1, (elements.referenceVideo.currentTime - currentLine().start) / Math.max(0.1, currentLine().end - currentLine().start)));
  elements.referenceVideo.pause();
  elements.referenceVideo.controls = true;
  state.referenceStopAt = null;
  state.mediaRecorder.stop();
  try { state.recognition?.stop(); } catch {}
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  clearInterval(state.timerId);
  cancelAnimationFrame(state.waveformFrame);
  state.audioContext?.close();
  elements.recordState.textContent = "處理錄音";
  elements.stopRecording.disabled = true;
  document.body.classList.remove("is-recording");
}

function finishRecording() {
  const type = state.mediaRecorder.mimeType || "audio/webm";
  state.recordingBlob = new Blob(state.chunks, { type });
  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingUrl = URL.createObjectURL(state.recordingBlob);
  elements.recordingPlayback.src = state.recordingUrl;
  elements.recordingPlayback.hidden = false;
  elements.recordingReview.hidden = false;
  elements.playSyncedReview.disabled = false;
  elements.recordState.textContent = "錄音完成";
  elements.recordTimer.textContent = `${state.recordingDuration.toFixed(1)} 秒`;
  elements.startRecording.disabled = false;
  elements.evaluateRecording.disabled = false;
  elements.resetRecording.disabled = false;
  const finalProgress = Math.max(0, Math.min(1, (elements.referenceVideo.currentTime - currentLine().start) / Math.max(0.1, currentLine().end - currentLine().start)));
  setKaraokeGuide("complete", "錄音完成", finalProgress, finalProgress);
  if (currentLine().isSoundEffect) elements.recognitionStatus.textContent = "音效錄製完成";
  else if (!elements.recognizedText.value.trim()) elements.recognitionStatus.textContent = "可手動輸入辨識結果";
}

function resetRecording() {
  if (state.mediaRecorder?.state === "recording") return;
  stopSyncedReview();
  state.isPreparing = false;
  document.body.classList.remove("is-preparing", "is-reviewing");
  clearInterval(state.timerId);
  cancelAnimationFrame(state.waveformFrame);
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  elements.referenceVideo.pause();
  elements.referenceVideo.muted = false;
  elements.referenceVideo.controls = true;
  state.referenceStopAt = null;
  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingBlob = null;
  state.recordingUrl = "";
  state.recordingDuration = 0;
  state.recordingEndProgress = 0;
  state.waveformSamples = 0;
  state.waveformSquares = 0;
  state.clippingSamples = 0;
  state.finalTranscript = "";
  state.interimTranscript = "";
  state.karaokeSyncSamples = [];
  elements.recordingPlayback.pause();
  elements.recordingPlayback.removeAttribute("src");
  elements.recordingPlayback.hidden = true;
  elements.recordingReview.hidden = true;
  elements.playSyncedReview.disabled = true;
  elements.playSyncedReview.innerHTML = '<span aria-hidden="true">▶</span>搭配影片回看';
  elements.recognizedText.value = "";
  elements.recognitionStatus.textContent = "尚未錄音";
  elements.recordState.textContent = "準備錄音";
  elements.recordTimer.textContent = "00:00.0";
  elements.startRecording.disabled = false;
  elements.stopRecording.disabled = true;
  elements.evaluateRecording.disabled = true;
  elements.resetRecording.disabled = true;
  elements.resultPanel.hidden = true;
  hideKaraokeOverlay();
  drawIdleWaveform();
}

function normalizeJapanese(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s。、，．！？!?「」『』（）()・…]/g, "");
}

function safeDiffHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  const allowedClasses = new Set(["diff-match", "diff-extra", "diff-missing"]);
  template.content.querySelectorAll("*").forEach((node) => {
    if (node.tagName !== "SPAN" || !allowedClasses.has(node.className)) {
      node.replaceWith(document.createTextNode(node.textContent || ""));
      return;
    }
    [...node.attributes].forEach((attribute) => {
      if (attribute.name !== "class" && attribute.name !== "title") node.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function lcsDiff(target, actual) {
  const a = [...target];
  const b = [...actual];
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  const output = [];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      output.push(`<span class="diff-match">${escapeHtml(a[i])}</span>`);
      i += 1; j += 1;
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) {
      output.push(`<span class="diff-extra" title="多出的內容">＋${escapeHtml(b[j])}</span>`);
      j += 1;
    } else {
      output.push(`<span class="diff-missing" title="未辨識到">${escapeHtml(a[i])}</span>`);
      i += 1;
    }
  }
  return output.join("");
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)))];
}

function estimatePitch(samples, sampleRate) {
  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) mean += samples[index];
  mean /= samples.length;
  const minLag = Math.max(2, Math.floor(sampleRate / 450));
  const maxLag = Math.min(samples.length - 4, Math.ceil(sampleRate / 75));
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let product = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < samples.length - lag; index += 2) {
      const left = samples[index] - mean;
      const right = samples[index + lag] - mean;
      product += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const correlation = product / Math.sqrt(Math.max(leftEnergy * rightEnergy, 1e-12));
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  return bestCorrelation >= 0.28 && bestLag ? sampleRate / bestLag : 0;
}

async function analyzeRecordingAudio() {
  const fallbackRms = state.waveformSamples ? Math.sqrt(state.waveformSquares / state.waveformSamples) : 0;
  const fallback = { rms: fallbackRms, voicedRatio: 0, voiceSpanRatio: 0, pitchRange: 0, pitchMovement: 0 };
  if (!state.recordingBlob || !window.AudioContext) return fallback;
  let context;
  try {
    context = new AudioContext();
    const bytes = await state.recordingBlob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const samples = buffer.getChannelData(0);
    if (samples.length < 512) return fallback;
    const frameSize = Math.min(2048, 2 ** Math.max(9, Math.floor(Math.log2(samples.length / 24))));
    const frameCount = Math.max(12, Math.min(48, Math.floor(samples.length / frameSize)));
    const step = Math.max(1, Math.floor((samples.length - frameSize) / Math.max(1, frameCount - 1)));
    const frames = [];
    for (let offset = 0; offset + frameSize <= samples.length && frames.length < frameCount; offset += step) {
      const frame = samples.subarray(offset, offset + frameSize);
      let squares = 0;
      for (let index = 0; index < frame.length; index += 1) squares += frame[index] * frame[index];
      frames.push({ frame, rms: Math.sqrt(squares / frame.length) });
    }
    const rmsValues = frames.map((item) => item.rms);
    const peakRms = Math.max(...rmsValues, fallbackRms);
    const threshold = Math.max(0.006, peakRms * 0.16);
    const activeFrameIndexes = frames.map((item, index) => item.rms >= threshold ? index : -1).filter((index) => index >= 0);
    const voiceSpanRatio = activeFrameIndexes.length
      ? (activeFrameIndexes.at(-1) - activeFrameIndexes[0] + 1) / frames.length
      : 0;
    const pitches = frames
      .filter((item) => item.rms >= threshold)
      .map((item) => estimatePitch(item.frame, buffer.sampleRate))
      .filter((pitch) => pitch >= 75 && pitch <= 450);
    const semitones = pitches.map((pitch) => 12 * Math.log2(pitch / 220));
    const movements = semitones.slice(1).map((value, index) => Math.abs(value - semitones[index]));
    return {
      rms: rmsValues.length ? Math.sqrt(rmsValues.reduce((sum, value) => sum + value * value, 0) / rmsValues.length) : fallbackRms,
      voicedRatio: frames.length ? pitches.length / frames.length : 0,
      voiceSpanRatio,
      pitchRange: semitones.length > 2 ? percentile(semitones, 0.9) - percentile(semitones, 0.1) : 0,
      pitchMovement: movements.length ? movements.reduce((sum, value) => sum + value, 0) / movements.length : 0,
    };
  } catch {
    return fallback;
  } finally {
    await context?.close().catch(() => {});
  }
}

async function localSoundEffectEvaluation() {
  const line = currentLine();
  const audioFeatures = await analyzeRecordingAudio();
  const rms = Math.max(audioFeatures.rms, state.waveformSamples ? Math.sqrt(state.waveformSquares / state.waveformSamples) : 0);
  const clipping = state.waveformSamples ? state.clippingSamples / state.waveformSamples : 0;
  const timeline = Math.round(Math.min(100, 50 + Math.min(1, state.recordingEndProgress / 0.85) * 50));
  const presence = rms < 0.008
    ? 25
    : Math.round(Math.min(100, 55 + Math.min(1, audioFeatures.voiceSpanRatio / 0.48) * 45));
  let volume = rms < 0.008 ? 25 : rms < 0.025 ? 68 : rms <= 0.28 ? 96 : 78;
  if (clipping > 0.01) volume = Math.max(35, volume - 28);
  const clarity = Math.round(Math.max(30, Math.min(100, presence * 0.55 + volume * 0.45)));
  const overall = Math.round(timeline * 0.45 + presence * 0.25 + volume * 0.3);
  const issues = [];
  if (timeline >= 92) issues.push("音效錄製已覆蓋指定時間軸。");
  else issues.push("音效片段提早結束，可搭配影片回看並補足指定區段。");
  if (rms < 0.008) issues.push("幾乎沒有偵測到音效，請靠近麥克風或提高音效強度。");
  else if (clipping > 0.01) issues.push("音效有爆音跡象，請降低音量或離麥克風遠一點。");
  else issues.push("音效音量可供小組合成預覽使用。");
  issues.push("音效完成度依時間軸與實際聲音區段計算，不使用台詞辨識。");
  return {
    overall,
    aspects: { accent: presence, intonation: clarity, speed: timeline, volume },
    scores: { "時間軸配合": timeline, "音效存在": presence, "音量": volume },
    issues,
    diffHtml: escapeHtml(`${line.soundName}｜${line.soundMethod}`),
    mode: "音效時間軸檢查",
  };
}

async function localEvaluation() {
  const line = currentLine();
  if (line.isSoundEffect) return localSoundEffectEvaluation();
  const target = normalizeJapanese(line.japanese);
  const actual = normalizeJapanese(elements.recognizedText.value);
  const distance = actual ? levenshtein(target, actual) : target.length;
  const accuracy = Math.round(Math.max(0, 1 - distance / Math.max(target.length, actual.length, 1)) * 100);
  const audioFeatures = await analyzeRecordingAudio();
  const rms = Math.max(audioFeatures.rms, state.waveformSamples ? Math.sqrt(state.waveformSquares / state.waveformSamples) : 0);
  const followScore = karaokeFollowScore();
  const voiceSpanScore = rms < 0.008
    ? 55
    : Math.round(Math.min(100, 58 + Math.min(1, audioFeatures.voiceSpanRatio / 0.62) * 42));
  const timelineCoverageScore = Math.round(Math.min(100, 55 + Math.min(1, state.recordingEndProgress / 0.85) * 45));
  const timing = followScore === null
    ? Math.round(voiceSpanScore * 0.55 + timelineCoverageScore * 0.45)
    : Math.round(followScore * 0.8 + voiceSpanScore * 0.2);
  const clipping = state.waveformSamples ? state.clippingSamples / state.waveformSamples : 0;
  let audio = rms < 0.008 ? 30 : rms < 0.025 ? 65 : rms <= 0.22 ? 95 : 78;
  if (clipping > 0.01) audio = Math.max(35, audio - 30);
  const pitchPresence = Math.min(1, audioFeatures.voicedRatio / 0.55);
  const rangeStrength = Math.min(1, audioFeatures.pitchRange / 6);
  const accent = Math.round(Math.max(30, Math.min(100, 34 + pitchPresence * 30 + rangeStrength * 36)));
  const movementStrength = Math.min(1, audioFeatures.pitchMovement / 2.4);
  const excessiveMovementPenalty = Math.max(0, audioFeatures.pitchMovement - 5) * 5;
  const intonation = Math.round(Math.max(30, Math.min(100, 36 + pitchPresence * 26 + movementStrength * 34 - excessiveMovementPenalty)));
  const aspects = { accent, intonation, speed: timing, volume: audio };
  const overall = Math.round(accuracy * 0.45 + accent * 0.12 + intonation * 0.13 + timing * 0.15 + audio * 0.15);
  const issues = [];
  if (!actual) issues.push("沒有取得辨識文字，台詞正確度暫以 0 分計算。可手動輸入後重新評分。");
  else if (accuracy >= 96) issues.push("辨識台詞與標準台詞高度一致。");
  else if (accuracy >= 80) issues.push("有少量漏字、增字或辨識差異，請查看台詞比對標色。");
  else issues.push("台詞差異較多，建議逐段重聽示範後再錄一次。");
  if (followScore !== null && timing >= 88) issues.push("配音進度大致跟上變色字幕，語速穩定。");
  else if (followScore !== null && timing >= 72) issues.push("大部分台詞能跟上字幕，少數位置略有提前或落後。");
  else if (followScore !== null) issues.push("部分台詞沒有跟上變色字幕，可用同步回看確認停頓位置。");
  else if (audioFeatures.voiceSpanRatio >= 0.55) issues.push("未取得即時辨識進度，已依實際發聲區段估算語速。");
  else issues.push("可分析的發聲區段較短，語速分數暫以較寬鬆標準估算。");
  issues.push("語速計分不包含倒數時間與開始、停止按鍵延遲。");
  if (rms < 0.008) issues.push("麥克風音量很小或接近靜音，請靠近麥克風再試一次。");
  else if (clipping > 0.01) issues.push("錄音有爆音跡象，請稍微遠離麥克風。");
  else issues.push("錄音音量可供分析。");
  if (audioFeatures.voicedRatio < 0.18) issues.push("可分析的有聲區段較少，重音與語調分數僅供本次練習參考。");
  else if (audioFeatures.pitchRange < 1.5) issues.push("音高變化較平，重聽示範中的重音位置與句尾語調後再試一次。");
  else issues.push("已取得可比較的音高輪廓，請搭配示範音逐句確認重音與語調。");
  return {
    overall,
    aspects,
    scores: { "台詞正確度": accuracy, "重音": accent, "語調": intonation, "語速": timing, "音量": audio },
    issues,
    diffHtml: lcsDiff(target, actual),
    mode: "瀏覽器練習指標",
  };
}

async function apiEvaluation() {
  const line = currentLine();
  const form = new FormData();
  form.append("audio", state.recordingBlob, `line-${line.index}.webm`);
  form.append("work", state.data.title);
  form.append("role", line.role);
  form.append("target", line.japanese);
  form.append("start", String(line.start));
  form.append("end", String(line.end));
  form.append("recordingDuration", String(state.recordingDuration));
  form.append("karaokeFollowScore", String(karaokeFollowScore() ?? ""));
  const response = await fetch(window.QA_CONFIG.evaluationApiUrl, { method: "POST", body: form });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

function renderResult(result) {
  const aspects = {
    accent: result.aspects?.accent ?? result.scores?.["重音"] ?? 0,
    intonation: result.aspects?.intonation ?? result.scores?.["語調"] ?? 0,
    speed: result.aspects?.speed ?? result.scores?.["語速"] ?? result.scores?.["節奏長度"] ?? 0,
    volume: result.aspects?.volume ?? result.scores?.["音量"] ?? result.scores?.["錄音品質"] ?? 0,
  };
  result.aspects = aspects;
  elements.overallScore.textContent = result.overall;
  elements.resultMode.textContent = result.mode || "API 評分";
  elements.scoreRows.innerHTML = Object.entries(result.scores || {})
    .map(([label, score]) => `<div class="score-row"><span>${escapeHtml(label)}</span><div><span style="width:${Math.max(0, Math.min(100, score))}%"></span></div><strong>${Math.round(score)}</strong></div>`)
    .join("");
  elements.textDiff.innerHTML = result.diffHtml
    ? safeDiffHtml(result.diffHtml)
    : escapeHtml(elements.recognizedText.value);
  elements.issueList.innerHTML = (result.issues || []).map((issue) => `<li>${escapeHtml(issue)}</li>`).join("");
  elements.resultPanel.hidden = false;
  window.drawPracticeRadar?.(elements.performanceRadar, aspects);
  elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  document.dispatchEvent(new CustomEvent("qa:evaluated", {
    detail: {
      result,
      line: currentLine(),
      recordingBlob: state.recordingBlob,
      recordingDuration: state.recordingDuration,
      transcript: elements.recognizedText.value,
    },
  }));
}

async function evaluateRecording() {
  if (!state.recordingBlob) return;
  stopSyncedReview();
  elements.evaluateRecording.disabled = true;
  elements.evaluateRecording.textContent = "評分中";
  let result;
  if (window.QA_CONFIG.evaluationApiUrl) {
    try {
      result = await apiEvaluation();
    } catch {
      result = await localEvaluation();
      result.issues.unshift("API 暫時無法使用，本次改用瀏覽器測試評分。");
    }
  } else {
    result = await localEvaluation();
  }
  renderResult(result);
  elements.evaluateRecording.disabled = false;
  elements.evaluateRecording.textContent = "重新評分";
}

function restoreHash() {
  const match = location.hash.match(/^#line-(\d+)$/);
  const requested = match ? Number(match[1]) : null;
  const index = requested === null ? 0 : state.data.lines.findIndex((line) => Number(line.index) === requested);
  selectLine(index >= 0 ? index : 0);
}

function handleHashChange() {
  if (!state.data || state.isPreparing || state.mediaRecorder?.state === "recording") return;
  const match = location.hash.match(/^#line-(\d+)$/);
  if (!match) return;
  const index = state.data.lines.findIndex((line) => Number(line.index) === Number(match[1]));
  if (index >= 0 && index !== state.selectedIndex) selectLine(index, true);
}

function bindEvents() {
  elements.previousLine.addEventListener("click", () => adjacentLine(-1));
  elements.nextLine.addEventListener("click", () => adjacentLine(1));
  elements.playReference.addEventListener("click", playReference);
  elements.referenceVideo.addEventListener("timeupdate", handleReferenceTime);
  elements.referenceVideo.addEventListener("loadedmetadata", () => { elements.videoLoading.hidden = true; });
  elements.startRecording.addEventListener("click", startRecording);
  elements.stopRecording.addEventListener("click", stopRecording);
  elements.playSyncedReview.addEventListener("click", toggleSyncedReview);
  elements.recordingPlayback.addEventListener("ended", () => {
    if (state.isReviewing) elements.karaokeGuideLabel.textContent = "錄音已播完";
  });
  elements.resetRecording.addEventListener("click", resetRecording);
  elements.evaluateRecording.addEventListener("click", evaluateRecording);
  elements.searchLines.addEventListener("input", applyFilters);
  elements.roleFilter.addEventListener("change", applyFilters);
  window.addEventListener("hashchange", handleHashChange);
}

async function initialize() {
  cacheElements();
  drawIdleWaveform();
  try {
    const dataUrl = window.QA_CONFIG.dataFile || "data/kiki.json";
    let raw;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const retryUrl = new URL(dataUrl, location.href);
        if (attempt) retryUrl.searchParams.set("retry", String(Date.now()));
        const response = await fetch(retryUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Data ${response.status}`);
        raw = await response.json();
        break;
      } catch (error) {
        lastError = error;
        if (!attempt) await wait(300);
      }
    }
    if (!raw) throw lastError || new Error("QA data unavailable");
    state.data = window.extendWorkDataWithSoundEffects?.(raw) || raw;
    renderHeader();
    renderLineList();
    bindEvents();
    restoreHash();
    document.dispatchEvent(new CustomEvent("qa:ready", { detail: { data: state.data } }));
  } catch (error) {
    console.error(error);
    elements.fatalState.hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", initialize);
