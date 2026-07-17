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
};

const elements = {};

function cacheElements() {
  [
    "workMeta", "evaluationMode", "linePosition", "referenceVideo", "videoLoading",
    "previousLine", "playReference", "nextLine", "selectedRole", "selectedTime",
    "selectedJapanese", "selectedTranslation", "recordState", "recordTimer", "waveform",
    "startRecording", "stopRecording", "recordingPlayback", "recognizedText",
    "recognitionStatus", "evaluateRecording", "resetRecording", "resultPanel", "overallScore",
    "resultMode", "scoreRows", "textDiff", "issueList", "searchLines", "roleFilter",
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
  elements.evaluationMode.textContent = window.QA_CONFIG.evaluationApiUrl ? "API 評分" : "瀏覽器測試評分";
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
      <span class="script-line__number">${String(line.index).padStart(2, "0")}</span>
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
  if (!state.data.lines[index] || state.mediaRecorder?.state === "recording") return;
  const previous = elements.lineList.querySelector(".script-line.is-selected");
  previous?.classList.remove("is-selected");
  previous?.removeAttribute("aria-current");

  state.selectedIndex = index;
  const line = currentLine();
  const selected = elements.lineList.querySelector(`[data-index="${index}"]`);
  selected?.classList.add("is-selected");
  selected?.setAttribute("aria-current", "true");
  elements.linePosition.textContent = `第 ${line.index} / ${state.data.lineCount} 句`;
  elements.selectedRole.textContent = line.role;
  elements.selectedTime.textContent = `${formatTime(line.start)} – ${formatTime(line.end)}`;
  elements.selectedJapanese.innerHTML = line.japaneseHtml;
  elements.selectedTranslation.textContent = line.translation;
  elements.referenceVideo.pause();
  state.referenceStopAt = null;
  resetRecording();
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
  const line = currentLine();
  elements.referenceVideo.pause();
  await seekVideo(line.start);
  state.referenceStopAt = line.end;
  await elements.referenceVideo.play().catch(() => {});
}

function handleReferenceTime() {
  if (state.referenceStopAt === null) return;
  if (elements.referenceVideo.currentTime >= state.referenceStopAt - 0.04) {
    elements.referenceVideo.pause();
    elements.referenceVideo.currentTime = state.referenceStopAt;
    state.referenceStopAt = null;
  }
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
  };
  recognition.onerror = () => {
    elements.recognitionStatus.textContent = "自動辨識未完成，可手動輸入";
  };
  return recognition;
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    elements.recordState.textContent = "此瀏覽器不支援錄音";
    return;
  }
  resetRecording();
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
    state.mediaRecorder.start(200);

    state.recognition = createRecognition();
    try { state.recognition?.start(); } catch {}

    state.recordingStartedAt = performance.now();
    state.timerId = setInterval(updateRecordingTimer, 100);
    elements.recordState.textContent = "錄音中";
    elements.startRecording.disabled = true;
    elements.stopRecording.disabled = false;
    elements.evaluateRecording.disabled = true;
    elements.resetRecording.disabled = true;
    document.body.classList.add("is-recording");
    drawWaveform();
  } catch (error) {
    elements.recordState.textContent = error.name === "NotAllowedError" ? "未取得麥克風權限" : "無法啟動麥克風";
    elements.recognitionStatus.textContent = "請檢查瀏覽器麥克風設定";
  }
}

function updateRecordingTimer() {
  state.recordingDuration = (performance.now() - state.recordingStartedAt) / 1000;
  elements.recordTimer.textContent = `${formatTime(state.recordingDuration, false)}.${Math.floor((state.recordingDuration % 1) * 10)}`;
}

function stopRecording() {
  if (state.mediaRecorder?.state !== "recording") return;
  state.recordingDuration = (performance.now() - state.recordingStartedAt) / 1000;
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
  elements.recordState.textContent = "錄音完成";
  elements.recordTimer.textContent = `${state.recordingDuration.toFixed(1)} 秒`;
  elements.startRecording.disabled = false;
  elements.evaluateRecording.disabled = false;
  elements.resetRecording.disabled = false;
  if (!elements.recognizedText.value.trim()) elements.recognitionStatus.textContent = "可手動輸入辨識結果";
}

function resetRecording() {
  if (state.mediaRecorder?.state === "recording") return;
  clearInterval(state.timerId);
  cancelAnimationFrame(state.waveformFrame);
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingBlob = null;
  state.recordingUrl = "";
  state.recordingDuration = 0;
  state.waveformSamples = 0;
  state.waveformSquares = 0;
  state.clippingSamples = 0;
  state.finalTranscript = "";
  state.interimTranscript = "";
  elements.recordingPlayback.removeAttribute("src");
  elements.recordingPlayback.hidden = true;
  elements.recognizedText.value = "";
  elements.recognitionStatus.textContent = "尚未錄音";
  elements.recordState.textContent = "準備錄音";
  elements.recordTimer.textContent = "00:00.0";
  elements.startRecording.disabled = false;
  elements.stopRecording.disabled = true;
  elements.evaluateRecording.disabled = true;
  elements.resetRecording.disabled = true;
  elements.resultPanel.hidden = true;
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

function localEvaluation() {
  const line = currentLine();
  const target = normalizeJapanese(line.japanese);
  const actual = normalizeJapanese(elements.recognizedText.value);
  const distance = actual ? levenshtein(target, actual) : target.length;
  const accuracy = Math.round(Math.max(0, 1 - distance / Math.max(target.length, actual.length, 1)) * 100);
  const targetDuration = line.end - line.start;
  const ratio = state.recordingDuration / Math.max(targetDuration, 0.1);
  const timing = Math.round(Math.max(0, 100 - Math.abs(Math.log(Math.max(ratio, 0.05))) * 105));
  const rms = state.waveformSamples ? Math.sqrt(state.waveformSquares / state.waveformSamples) : 0;
  const clipping = state.waveformSamples ? state.clippingSamples / state.waveformSamples : 0;
  let audio = rms < 0.008 ? 30 : rms < 0.025 ? 65 : rms <= 0.22 ? 95 : 78;
  if (clipping > 0.01) audio = Math.max(35, audio - 30);
  const overall = Math.round(accuracy * 0.6 + timing * 0.25 + audio * 0.15);
  const issues = [];
  if (!actual) issues.push("沒有取得辨識文字，台詞正確度暫以 0 分計算。可手動輸入後重新評分。");
  else if (accuracy >= 96) issues.push("辨識台詞與標準台詞高度一致。");
  else if (accuracy >= 80) issues.push("有少量漏字、增字或辨識差異，請查看台詞比對標色。");
  else issues.push("台詞差異較多，建議逐段重聽示範後再錄一次。");
  if (ratio < 0.78) issues.push(`錄音比示範短 ${Math.abs(state.recordingDuration - targetDuration).toFixed(1)} 秒，可能太快或句尾提前停止。`);
  else if (ratio > 1.3) issues.push(`錄音比示範長 ${(state.recordingDuration - targetDuration).toFixed(1)} 秒，請檢查停頓與拖音。`);
  else issues.push("錄音長度落在示範台詞的合理範圍。");
  if (rms < 0.008) issues.push("麥克風音量很小或接近靜音，請靠近麥克風再試一次。");
  else if (clipping > 0.01) issues.push("錄音有爆音跡象，請稍微遠離麥克風。");
  else issues.push("錄音音量可供分析。");
  return {
    overall,
    scores: { "台詞正確度": accuracy, "節奏長度": timing, "錄音品質": audio },
    issues,
    diffHtml: lcsDiff(target, actual),
    mode: "QA 測試分數",
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
  const response = await fetch(window.QA_CONFIG.evaluationApiUrl, { method: "POST", body: form });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

function renderResult(result) {
  elements.overallScore.textContent = result.overall;
  elements.resultMode.textContent = result.mode || "API 評分";
  elements.scoreRows.innerHTML = Object.entries(result.scores)
    .map(([label, score]) => `<div class="score-row"><span>${escapeHtml(label)}</span><div><span style="width:${Math.max(0, Math.min(100, score))}%"></span></div><strong>${Math.round(score)}</strong></div>`)
    .join("");
  elements.textDiff.innerHTML = result.diffHtml
    ? safeDiffHtml(result.diffHtml)
    : escapeHtml(elements.recognizedText.value);
  elements.issueList.innerHTML = result.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("");
  elements.resultPanel.hidden = false;
  elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function evaluateRecording() {
  if (!state.recordingBlob) return;
  elements.evaluateRecording.disabled = true;
  elements.evaluateRecording.textContent = "評分中";
  let result;
  if (window.QA_CONFIG.evaluationApiUrl) {
    try {
      result = await apiEvaluation();
    } catch {
      result = localEvaluation();
      result.issues.unshift("API 暫時無法使用，本次改用瀏覽器測試評分。");
    }
  } else {
    result = localEvaluation();
  }
  renderResult(result);
  elements.evaluateRecording.disabled = false;
  elements.evaluateRecording.textContent = "重新評分";
}

function restoreHash() {
  const match = location.hash.match(/^#line-(\d+)$/);
  const index = match ? Number(match[1]) - 1 : 0;
  selectLine(state.data.lines[index] ? index : 0);
}

function bindEvents() {
  elements.previousLine.addEventListener("click", () => adjacentLine(-1));
  elements.nextLine.addEventListener("click", () => adjacentLine(1));
  elements.playReference.addEventListener("click", playReference);
  elements.referenceVideo.addEventListener("timeupdate", handleReferenceTime);
  elements.referenceVideo.addEventListener("loadedmetadata", () => { elements.videoLoading.hidden = true; });
  elements.startRecording.addEventListener("click", startRecording);
  elements.stopRecording.addEventListener("click", stopRecording);
  elements.resetRecording.addEventListener("click", resetRecording);
  elements.evaluateRecording.addEventListener("click", evaluateRecording);
  elements.searchLines.addEventListener("input", applyFilters);
  elements.roleFilter.addEventListener("change", applyFilters);
}

async function initialize() {
  cacheElements();
  drawIdleWaveform();
  try {
    const response = await fetch("data/kiki.json");
    if (!response.ok) throw new Error(`Data ${response.status}`);
    state.data = await response.json();
    renderHeader();
    renderLineList();
    bindEvents();
    restoreHash();
  } catch (error) {
    console.error(error);
    elements.fatalState.hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", initialize);
