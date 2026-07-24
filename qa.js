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
  recordingFinalizeTimer: null,
  isStopping: false,
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
  soundBeatElements: [],
  soundBeatRowElement: null,
  soundActiveBeatElement: null,
  soundEffectWordElement: null,
  soundEffectWords: [],
  soundDemoToken: 0,
  isSoundDemo: false,
  soundDemoStart: null,
  soundDemoEnd: null,
  referenceAudioContext: null,
  referenceAudioSource: null,
  referenceAudioGain: null,
  referenceAudioCompressor: null,
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
  if (state.isPreparing || state.isStopping || state.mediaRecorder?.state === "recording") return;
  const line = currentLine();
  stopSyncedReview();
  stopSoundDemo(false);
  await state.referenceAudioContext?.resume().catch(() => {});
  if (line.isSoundEffect) renderKaraokeOverlay();
  else hideKaraokeOverlay();
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
  if (elements.referenceVideo.currentTime >= state.referenceStopAt) {
    const shouldStopRecording = state.mediaRecorder?.state === "recording";
    const shouldStopReview = state.isReviewing;
    const shouldStopSoundDemo = state.isSoundDemo;
    elements.referenceVideo.pause();
    elements.referenceVideo.currentTime = state.referenceStopAt;
    state.referenceStopAt = null;
    if (shouldStopRecording) stopRecording();
    if (shouldStopReview) stopSyncedReview(false);
    if (shouldStopSoundDemo) stopSoundDemo(true);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function recordingStopTime(line) {
  const postRoll = Number(window.QA_RECORDING_TIMING?.postRollSeconds) || 0;
  const duration = Number(state.data?.duration) || line.end + postRoll;
  return Math.min(duration, line.end + postRoll);
}

function previousRecordingCue(line) {
  if (line.isSoundEffect) {
    const start = Math.max(0, line.start - 3);
    return line.start - start >= 0.75 ? { start, end: line.start, label: "有聲前奏：聽時間軸" } : null;
  }
  const previous = state.data.lines
    .filter((candidate) => !candidate.isSoundEffect && candidate.index !== line.index && candidate.start < line.start - 0.02)
    .sort((left, right) => right.start - left.start)[0];
  if (!previous) return null;
  const end = Math.min(previous.end, line.start);
  const maxSeconds = Number(window.QA_RECORDING_TIMING?.previousCueMaxSeconds) || 4;
  const start = Math.max(previous.start, end - maxSeconds);
  return end - start >= 0.35 ? { start, end, label: `有聲前奏：先聽 ${previous.role}` } : null;
}

function waitForVideoTime(endTime) {
  return new Promise((resolve) => {
    const video = elements.referenceVideo;
    let settled = false;
    let timeout;
    let onEnded;
    const finish = (reached = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.removeEventListener("timeupdate", check);
      video.removeEventListener("ended", onEnded);
      resolve(reached);
    };
    const check = () => {
      if (video.currentTime >= endTime - 0.05) finish(true);
    };
    onEnded = () => finish(true);
    const remaining = Math.max(0, endTime - video.currentTime);
    timeout = setTimeout(() => finish(false), Math.max(1400, Math.min(6500, (remaining + 0.8) * 1400)));
    video.addEventListener("timeupdate", check);
    video.addEventListener("ended", onEnded, { once: true });
    check();
  });
}

function beginRecordingPreRoll(line) {
  const video = elements.referenceVideo;
  const cue = previousRecordingCue(line);
  if (!cue) return null;
  elements.recordState.textContent = cue.label;
  elements.recordTimer.textContent = "有聲前奏";
  setKaraokeGuide("waiting", cue.label, 0, 0);
  video.pause();
  state.referenceAudioContext?.resume().catch(() => {});
  video.muted = false;
  video.volume = 1;
  try {
    video.currentTime = cue.start;
    const finished = Promise.resolve(video.play())
      .then(() => waitForVideoTime(cue.end))
      .then((reached) => {
        video.pause();
        return reached;
      })
      .catch(() => {
        video.pause();
        return false;
      });
    return { cue, finished };
  } catch {
    return { cue, finished: Promise.resolve(false) };
  }
}

async function finishRecordingPreRoll(line, preRoll) {
  const video = elements.referenceVideo;
  const cuePlayed = preRoll ? await preRoll.finished : false;
  if (preRoll && !cuePlayed) {
    const error = new Error("前奏聲音被瀏覽器阻擋，請再按一次開始配音。");
    error.code = "PRE_ROLL_AUDIO_BLOCKED";
    throw error;
  }
  video.muted = true;
  await seekVideo(line.start);
  if (cuePlayed) {
    elements.recordState.textContent = "準備接下一句";
    elements.recordTimer.textContent = "GO";
    setKaraokeGuide("waiting", line.isSoundEffect ? "準備音效" : "下一句換你", 0, 0);
    await wait(450);
    return;
  }

  const total = Number(window.QA_RECORDING_TIMING?.fallbackPreRollSeconds) || 2.1;
  const step = total * 1000 / 3;
  for (let count = 3; count >= 1; count -= 1) {
    elements.recordState.textContent = `倒數 ${count}`;
    elements.recordTimer.textContent = String(count);
    setKaraokeGuide("waiting", `倒數 ${count}`, 0, 0);
    await wait(step);
  }
}

function soundCueWindow(line) {
  const cueStart = Number.isFinite(Number(line.cueStart)) ? Number(line.cueStart) : Number(line.start) || 0;
  const defaultEnd = line.cueIsRange ? Number(line.end) : cueStart + 0.65;
  const cueEnd = Math.max(cueStart + 0.1, Number.isFinite(Number(line.cueEnd)) ? Number(line.cueEnd) : defaultEnd);
  return { cueStart, cueEnd, isRange: Boolean(line.cueIsRange) };
}

function soundWordsForLine(line) {
  const words = (Array.isArray(line.onomatopoeia) ? line.onomatopoeia : [line.onomatopoeia])
    .map((word) => String(word || "").trim())
    .filter(Boolean);
  return words.length ? words : ["ドン"];
}

function soundEventsForLine(line) {
  return (Array.isArray(line.soundEvents) ? line.soundEvents : [])
    .map((event) => ({
      word: String(event.word || "").trim(),
      sound: String(event.sound || line.soundName || "音效").trim(),
      start: Number(event.start),
      end: Number(event.end),
      demoStart: Number(event.demoStart),
      demoEnd: Number(event.demoEnd),
    }))
    .filter((event) => event.word && Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function setSoundDemoButtonLabel(element, word, start, end, sound = "") {
  if (!element) return;
  element.dataset.demoStart = String(start);
  element.dataset.demoEnd = String(end);
  element.dataset.soundLabel = String(sound || "");
  const detail = sound ? `：${sound}` : "";
  element.title = `播放原片「${word}」${detail}（${formatTime(start)}–${formatTime(end)}）`;
  element.setAttribute("aria-label", `播放原影片中日文擬聲語 ${word}${detail} 對應的音效`);
}

function clearSoundDemoHighlights() {
  state.soundEffectWordElement?.classList.remove("is-playing");
  state.soundEffectWordElement?.setAttribute("aria-pressed", "false");
  state.soundBeatElements.forEach((beat) => {
    beat.element.classList.remove("is-playing");
    if (beat.target) beat.element.setAttribute("aria-pressed", "false");
  });
}

function stopSoundDemo(restoreTimeline = true) {
  state.soundDemoToken += 1;
  if (state.isSoundDemo) {
    elements.referenceVideo.pause();
    state.referenceStopAt = null;
  }
  state.isSoundDemo = false;
  state.soundDemoStart = null;
  state.soundDemoEnd = null;
  document.body.classList.remove("is-sound-demo");
  if (state.referenceAudioGain) state.referenceAudioGain.gain.value = 1;
  if (elements.referenceVideo) elements.referenceVideo.controls = true;
  clearSoundDemoHighlights();
  const line = state.data?.lines?.[state.selectedIndex];
  if (restoreTimeline && line?.isSoundEffect && !elements.karaokeOverlay?.hidden) {
    elements.referenceVideo.currentTime = line.start;
    updateSoundEffectBeatProgress(line.start, line);
  }
}

async function enableReferenceAudioBoost() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  if (!state.referenceAudioContext || state.referenceAudioContext.state === "closed") {
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(elements.referenceVideo);
    const gain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    source.connect(gain).connect(compressor).connect(context.destination);
    state.referenceAudioContext = context;
    state.referenceAudioSource = source;
    state.referenceAudioGain = gain;
    state.referenceAudioCompressor = compressor;
  }
  await state.referenceAudioContext.resume();
  state.referenceAudioGain.gain.value = 2.35;
  return true;
}

async function playSoundDemo(word, start, end, trigger) {
  if (state.isPreparing || state.mediaRecorder?.state === "recording") return;
  stopSoundDemo(false);
  const token = state.soundDemoToken;
  elements.referenceVideo.pause();
  state.referenceStopAt = null;
  try {
    const boostPromise = enableReferenceAudioBoost();
    state.isSoundDemo = true;
    state.soundDemoStart = start;
    state.soundDemoEnd = end;
    state.referenceStopAt = end;
    document.body.classList.add("is-sound-demo");
    elements.referenceVideo.muted = false;
    elements.referenceVideo.volume = 1;
    elements.referenceVideo.controls = false;
    clearSoundDemoHighlights();
    state.soundEffectWordElement.textContent = word;
    state.soundEffectWordElement.classList.add("is-playing");
    state.soundEffectWordElement.setAttribute("aria-pressed", "true");
    setSoundDemoButtonLabel(state.soundEffectWordElement, word, start, end, trigger?.dataset.soundLabel);
    state.soundBeatElements
      .filter((beat) => beat.target && beat.demoStart === start && beat.demoEnd === end)
      .forEach((beat) => {
        beat.element.classList.add("is-playing");
        beat.element.setAttribute("aria-pressed", "true");
      });
    trigger?.focus({ preventScroll: true });
    setKaraokeGuide("review", "原片音效播放中", 0, 0);
    const seekPromise = seekVideo(start);
    const playPromise = elements.referenceVideo.play();
    await Promise.all([boostPromise, seekPromise, playPromise]);
    if (token !== state.soundDemoToken) return;
  } catch {
    if (token !== state.soundDemoToken) return;
    stopSoundDemo(false);
    elements.referenceVideo.controls = true;
    setKaraokeGuide("waiting", "無法播放原片音效", 0, 0);
  }
}

function buildSoundEffectBeats(line) {
  const { cueStart, cueEnd, isRange } = soundCueWindow(line);
  const words = soundWordsForLine(line);
  const explicitEvents = soundEventsForLine(line);
  const beats = [];
  if (explicitEvents.length) {
    let cursor = Number(line.start) || cueStart;
    explicitEvents.forEach((event) => {
      if (event.start > cursor + 0.05) {
        beats.push({ start: cursor, end: event.start, target: false, word: "・" });
      }
      beats.push({
        ...event,
        demoStart: Number.isFinite(event.demoStart) ? event.demoStart : event.start,
        demoEnd: Number.isFinite(event.demoEnd) ? event.demoEnd : event.end,
        target: true,
      });
      cursor = Math.max(cursor, event.end);
    });
    const lineEnd = Number(line.end) || cueEnd;
    if (lineEnd > cursor + 0.05) beats.push({ start: cursor, end: lineEnd, target: false, word: "・" });
    return beats;
  }
  if (isRange) {
    const count = Math.max(4, Math.min(12, Math.ceil((cueEnd - cueStart) / 3)));
    const step = (cueEnd - cueStart) / count;
    for (let index = 0; index < count; index += 1) {
      const start = cueStart + step * index;
      const end = cueStart + step * (index + 1);
      const wordIndex = Math.min(words.length - 1, Math.floor(index * words.length / count));
      beats.push({ start, end, target: true, word: words[wordIndex] });
    }
  } else {
    const leadStart = Math.min(cueStart, Number(line.start) || cueStart);
    const leadStep = Math.max(0.1, (cueStart - leadStart) / 3);
    for (let index = 0; index < 3; index += 1) {
      beats.push({ start: leadStart + leadStep * index, end: leadStart + leadStep * (index + 1), target: false, word: "・" });
    }
    beats.push({
      start: cueStart,
      end: cueEnd,
      demoStart: Math.max(Number(line.start) || 0, cueStart - 0.45),
      demoEnd: Math.min(Number(line.end) || cueStart + 1.35, cueStart + 1.35),
      target: true,
      word: words[0],
    });
  }
  return beats.map((beat) => ({
    ...beat,
    demoStart: Number.isFinite(beat.demoStart) ? beat.demoStart : beat.start,
    demoEnd: Number.isFinite(beat.demoEnd) ? beat.demoEnd : beat.end,
  }));
}

function renderSoundEffectBeats(line) {
  const { cueStart, cueEnd, isRange } = soundCueWindow(line);
  const words = soundWordsForLine(line);
  const beats = buildSoundEffectBeats(line);
  const firstTarget = beats.find((beat) => beat.target);
  const wordDisplay = document.createElement("button");
  wordDisplay.type = "button";
  wordDisplay.className = "sound-effect-word sound-demo-button is-waiting";
  wordDisplay.lang = "ja";
  wordDisplay.textContent = words[0];
  wordDisplay.setAttribute("aria-pressed", "false");
  setSoundDemoButtonLabel(wordDisplay, words[0], firstTarget.demoStart, firstTarget.demoEnd, firstTarget.sound);
  wordDisplay.addEventListener("click", () => playSoundDemo(
    wordDisplay.textContent,
    Number(wordDisplay.dataset.demoStart),
    Number(wordDisplay.dataset.demoEnd),
    wordDisplay,
  ));
  const timing = document.createElement("span");
  timing.className = "sound-cue-time";
  timing.textContent = isRange
    ? `効果音 ${formatTime(cueStart)}–${formatTime(cueEnd)}`
    : `効果音 ${formatTime(cueStart)}`;
  const row = document.createElement("span");
  row.className = "sound-beat-row";
  row.dataset.mode = isRange ? "range" : "point";

  row.style.setProperty("--sound-beat-count", String(beats.length));
  row.style.setProperty("--sound-beat-columns", String(Math.min(6, beats.length)));
  state.soundEffectWords = words;
  state.soundEffectWordElement = wordDisplay;
  state.soundBeatRowElement = row;
  state.soundActiveBeatElement = null;
  state.soundBeatElements = beats.map((beat) => {
    const element = document.createElement(beat.target ? "button" : "span");
    if (beat.target) element.type = "button";
    element.className = `sound-beat${beat.target ? " sound-demo-button is-target" : " is-prep"}`;
    element.lang = beat.target ? "ja" : "";
    element.textContent = beat.word;
    if (beat.target) {
      element.setAttribute("aria-pressed", "false");
      setSoundDemoButtonLabel(element, beat.word, beat.demoStart, beat.demoEnd, beat.sound);
      element.addEventListener("click", () => playSoundDemo(beat.word, beat.demoStart, beat.demoEnd, element));
    } else {
      element.setAttribute("aria-hidden", "true");
    }
    row.append(element);
    return { ...beat, element };
  });
  elements.karaokeJapanese.replaceChildren(wordDisplay, timing, row);
  elements.karaokeJapanese.setAttribute("aria-label", `${words.join("、")}，${timing.textContent}，${line.soundName}`);
}

function renderKaraokeOverlay() {
  const line = currentLine();
  if (line.isSoundEffect) {
    state.karaokeCharacters = [];
    renderSoundEffectBeats(line);
  } else {
    const fragment = document.createDocumentFragment();
    state.soundBeatElements = [];
    state.soundBeatRowElement = null;
    state.soundActiveBeatElement = null;
    state.soundEffectWordElement = null;
    state.soundEffectWords = [];
    state.karaokeCharacters = [...line.japanese].map((character) => {
      const span = document.createElement("span");
      span.className = "karaoke-character";
      span.textContent = character;
      span.setAttribute("aria-hidden", "true");
      fragment.append(span);
      return span;
    });
    elements.karaokeJapanese.replaceChildren(fragment);
    elements.karaokeJapanese.setAttribute("aria-label", line.japanese);
  }
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
  state.soundBeatElements = [];
  state.soundBeatRowElement = null;
  state.soundActiveBeatElement = null;
  state.soundEffectWordElement = null;
  state.soundEffectWords = [];
}

function setKaraokeGuide(status, label, spokenProgress, expectedProgress) {
  elements.karaokeGuide.dataset.state = status;
  elements.karaokeGuideLabel.textContent = label;
  elements.karaokeGuideBar.style.width = `${Math.round(Math.max(0, Math.min(1, spokenProgress)) * 100)}%`;
  elements.karaokeGuide.style.setProperty("--expected-progress", `${Math.round(Math.max(0, Math.min(1, expectedProgress)) * 100)}%`);
}

function updateSoundEffectBeatProgress(videoTime, line) {
  const time = Number(videoTime) || 0;
  const { cueStart, cueEnd, isRange } = soundCueWindow(line);
  const currentTargets = [];
  const targetBeats = state.soundBeatElements.filter((beat) => beat.target);
  const nextTarget = targetBeats.find((beat) => beat.start > time);
  state.soundBeatElements.forEach((beat) => {
    beat.element.classList.toggle("is-passed", time >= beat.end);
    const isCurrent = time >= beat.start && time < beat.end;
    beat.element.classList.toggle("is-current", isCurrent);
    beat.element.classList.toggle("is-next", beat === nextTarget);
    if (isCurrent && beat.target) currentTargets.push(beat);
  });
  const focusedBeat = currentTargets.at(-1) || nextTarget || targetBeats.at(-1);
  if (focusedBeat?.element && focusedBeat.element !== state.soundActiveBeatElement) {
    state.soundActiveBeatElement = focusedBeat.element;
    const row = state.soundBeatRowElement;
    if (row) {
      const centeredLeft = focusedBeat.element.offsetLeft - (row.clientWidth - focusedBeat.element.offsetWidth) / 2;
      row.scrollLeft = Math.max(0, centeredLeft);
    }
  }
  if (state.soundEffectWordElement) {
    const activeTarget = currentTargets.at(-1)
      || nextTarget
      || targetBeats.at(-1);
    const activeWord = activeTarget?.word || state.soundEffectWords[0];
    state.soundEffectWordElement.textContent = activeWord || "ドン";
    setSoundDemoButtonLabel(
      state.soundEffectWordElement,
      activeWord || "ドン",
      activeTarget?.demoStart ?? cueStart,
      activeTarget?.demoEnd ?? cueEnd,
      activeTarget?.sound,
    );
    state.soundEffectWordElement.classList.toggle("is-active", currentTargets.length > 0);
    state.soundEffectWordElement.classList.toggle("is-waiting", currentTargets.length === 0 && time < cueEnd);
    state.soundEffectWordElement.classList.toggle("is-finished", time >= cueEnd);
  }

  if (state.isSoundDemo) {
    const progress = Math.max(0, Math.min(1, (time - state.soundDemoStart) / Math.max(0.1, state.soundDemoEnd - state.soundDemoStart)));
    setKaraokeGuide("review", "原片音效播放中", progress, progress);
    return;
  }

  const explicitEvents = soundEventsForLine(line);
  if (explicitEvents.length) {
    const activeEvent = explicitEvents.filter((event) => time >= event.start && time < event.end).at(-1);
    if (activeEvent) {
      const progress = Math.max(0, Math.min(1, (time - activeEvent.start) / Math.max(0.1, activeEvent.end - activeEvent.start)));
      setKaraokeGuide("on-time", `現在 · ${activeEvent.word}`, progress, progress);
      return;
    }
    const nextEvent = explicitEvents.find((event) => event.start > time);
    if (nextEvent) {
      const remaining = Math.max(0, nextEvent.start - time);
      const timelineProgress = Math.max(0, Math.min(1, (time - Number(line.start)) / Math.max(0.1, Number(line.end) - Number(line.start))));
      setKaraokeGuide("waiting", `準備 ${nextEvent.word} · ${remaining.toFixed(1)} 秒`, 0, timelineProgress);
      return;
    }
    if (state.isReviewing) setKaraokeGuide("review", "音效結束 · 收尾回看", 1, 1);
    else if (state.mediaRecorder?.state === "recording") setKaraokeGuide("complete", "停止音效 · 收尾緩衝", 1, 1);
    else setKaraokeGuide("complete", "音效拍點結束", 1, 1);
    return;
  }

  if (time < cueStart) {
    const remaining = Math.max(0, cueStart - time);
    const leadDuration = Math.max(0.1, cueStart - Math.min(Number(line.start) || cueStart, cueStart));
    const progress = Math.max(0, Math.min(1, 1 - remaining / Math.max(leadDuration, 3)));
    setKaraokeGuide("waiting", `準備 · ${remaining.toFixed(1)} 秒`, 0, progress);
    return;
  }
  if (time < cueEnd) {
    const progress = Math.max(0, Math.min(1, (time - cueStart) / Math.max(0.1, cueEnd - cueStart)));
    setKaraokeGuide("on-time", isRange ? "現在持續出聲" : "現在出聲", progress, progress);
    return;
  }
  if (state.isReviewing) setKaraokeGuide("review", "音效結束 · 收尾回看", 1, 1);
  else if (state.mediaRecorder?.state === "recording") setKaraokeGuide("complete", "停止音效 · 收尾緩衝", 1, 1);
  else setKaraokeGuide("complete", "音效拍點結束", 1, 1);
}

function updateKaraokeProgress(videoTime) {
  const line = currentLine();
  if (line.isSoundEffect) {
    updateSoundEffectBeatProgress(videoTime, line);
    return;
  }
  const duration = Math.max(0.1, line.end - line.start);
  const expectedProgress = Math.max(0, Math.min(1, (Number(videoTime) - line.start) / duration));
  const coloredCount = Math.floor(expectedProgress * state.karaokeCharacters.length);
  state.karaokeCharacters.forEach((character, index) => character.classList.toggle("is-sung", index < coloredCount));

  if (Number(videoTime) >= line.end) {
    if (state.isReviewing) setKaraokeGuide("review", "收尾回看", 1, 1);
    else if (state.mediaRecorder?.state === "recording") setKaraokeGuide("complete", "收尾緩衝", 1, 1);
    return;
  }

  if (state.isReviewing) {
    setKaraokeGuide("review", "同步回看中", expectedProgress, expectedProgress);
    return;
  }
  if (state.mediaRecorder?.state !== "recording") return;
  const transcript = `${state.finalTranscript}${state.interimTranscript}`;
  const recognized = normalizeJapanesePronunciation(transcript);
  if (!state.recognition) {
    setKaraokeGuide("waiting", "字幕同步中", expectedProgress, expectedProgress);
    return;
  }
  const spokenProgress = japaneseTranscriptProgress(line, transcript);
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
  const transcript = `${state.finalTranscript}${state.interimTranscript}`;
  if (!normalizeJapanesePronunciation(transcript)) return;
  const expectedProgress = Math.max(0, Math.min(1, (elements.referenceVideo.currentTime - line.start) / Math.max(0.1, line.end - line.start)));
  const spokenProgress = japaneseTranscriptProgress(line, transcript);
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
  stopSoundDemo(false);
  elements.referenceVideo.pause();
  elements.recordingPlayback.pause();
  await seekVideo(line.start);
  elements.referenceVideo.muted = true;
  elements.referenceVideo.controls = false;
  elements.recordingPlayback.currentTime = 0;
  renderKaraokeOverlay();
  state.isReviewing = true;
  state.referenceStopAt = recordingStopTime(line);
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
  if (elements.referenceVideo.currentTime <= currentLine().end + 0.04) {
    state.waveformSquares += sum;
    state.waveformSamples += samples.length;
    state.clippingSamples += clipped;
  }
  state.waveformFrame = requestAnimationFrame(drawWaveform);
}

function createRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternatives = Array.from(
        { length: result.length },
        (_, alternativeIndex) => result[alternativeIndex]?.transcript || "",
      ).filter(Boolean);
      const value = closestRecognitionText(alternatives, `${state.finalTranscript}${interim}`, currentLine());
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
  if (state.isPreparing || state.isStopping || state.mediaRecorder?.state === "recording") return;
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
  const line = currentLine();
  renderKaraokeOverlay();
  elements.referenceVideo.pause();
  elements.referenceVideo.controls = false;
  const preRoll = beginRecordingPreRoll(line);
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

    await finishRecordingPreRoll(line, preRoll);

    state.mediaRecorder.start(200);

    state.recognition = line.isSoundEffect ? null : createRecognition();
    try { state.recognition?.start(); } catch {}

    state.isPreparing = false;
    document.body.classList.remove("is-preparing");
    state.recordingStartedAt = performance.now();
    state.timerId = setInterval(updateRecordingTimer, 100);
    state.referenceStopAt = recordingStopTime(line);
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
    const message = error.code === "PRE_ROLL_AUDIO_BLOCKED"
      ? error.message
      : error.name === "NotAllowedError" ? "未取得麥克風權限" : "無法啟動麥克風";
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
    elements.recognitionStatus.textContent = error.code === "PRE_ROLL_AUDIO_BLOCKED"
      ? "請確認手機未設為靜音，再重新按一次"
      : "請檢查瀏覽器麥克風設定";
  }
}

function updateRecordingTimer() {
  state.recordingDuration = (performance.now() - state.recordingStartedAt) / 1000;
  elements.recordTimer.textContent = `${formatTime(state.recordingDuration, false)}.${Math.floor((state.recordingDuration % 1) * 10)}`;
  updateKaraokeProgress(elements.referenceVideo.currentTime);
}

function stopRecording() {
  if (state.mediaRecorder?.state !== "recording" || state.isStopping) return;
  state.isStopping = true;
  state.recordingDuration = (performance.now() - state.recordingStartedAt) / 1000;
  state.recordingEndProgress = Math.max(0, Math.min(1, (elements.referenceVideo.currentTime - currentLine().start) / Math.max(0.1, currentLine().end - currentLine().start)));
  elements.referenceVideo.pause();
  elements.referenceVideo.controls = true;
  state.referenceStopAt = null;
  try { state.recognition?.stop(); } catch {}
  clearInterval(state.timerId);
  cancelAnimationFrame(state.waveformFrame);
  try { state.mediaRecorder.requestData(); } catch {}
  const flushMilliseconds = Math.max(200, Number(window.QA_RECORDING_TIMING?.encoderFlushMilliseconds) || 400);
  clearTimeout(state.recordingFinalizeTimer);
  state.recordingFinalizeTimer = setTimeout(() => {
    state.recordingFinalizeTimer = null;
    if (state.mediaRecorder?.state === "recording") state.mediaRecorder.stop();
  }, flushMilliseconds);
  elements.recordState.textContent = "正在保存句尾";
  elements.stopRecording.disabled = true;
  document.body.classList.remove("is-recording");
  document.body.classList.add("is-finalizing");
}

function finishRecording() {
  clearTimeout(state.recordingFinalizeTimer);
  state.recordingFinalizeTimer = null;
  state.recordingDuration = (performance.now() - state.recordingStartedAt) / 1000;
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.audioContext?.close();
  state.isStopping = false;
  document.body.classList.remove("is-finalizing");
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
  if (state.isStopping || state.mediaRecorder?.state === "recording") return;
  stopSoundDemo(false);
  stopSyncedReview();
  state.isPreparing = false;
  document.body.classList.remove("is-preparing", "is-reviewing", "is-finalizing");
  clearTimeout(state.recordingFinalizeTimer);
  state.recordingFinalizeTimer = null;
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
  const line = state.data?.lines?.[state.selectedIndex];
  if (line?.isSoundEffect) {
    renderKaraokeOverlay();
    updateSoundEffectBeatProgress(line.start, line);
    setKaraokeGuide("waiting", "點選日文音效可試聽", 0, 0);
  } else {
    hideKaraokeOverlay();
  }
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

const japaneseTargetFormsCache = new WeakMap();

function kanaVowel(character) {
  if (!character) return "";
  if ("ぁあかがさざただなはばぱまゃやらゎわ".includes(character)) return "あ";
  if ("ぃいきぎしじちぢにひびぴみりゐ".includes(character)) return "い";
  if ("ぅうくぐすずつづぬふぶぷむゅゆるゔ".includes(character)) return "う";
  if ("ぇえけげせぜてでねへべぺめれゑ".includes(character)) return "え";
  if ("ぉおこごそぞとどのほぼぽもょよろを".includes(character)) return "お";
  return "";
}

function normalizeJapanesePronunciation(value) {
  let normalized = String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[っッ](?=[\s\p{P}\p{S}]|$)/gu, "")
    .replace(/[\u30A1-\u30F6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/[ゕゖ]/g, "か")
    .replace(/ゎ/g, "わ")
    .replace(/ゐ/g, "い")
    .replace(/ゑ/g, "え")
    .replace(/ゔ/g, "ぶ")
    .replace(/ぢ/g, "じ")
    .replace(/づ/g, "ず")
    .replace(/を/g, "お");

  let expanded = "";
  for (const character of normalized) {
    if (character === "ー") {
      expanded += kanaVowel([...expanded].at(-1)) || "";
    } else {
      expanded += character;
    }
  }

  normalized = "";
  for (const character of expanded) {
    const previousVowel = kanaVowel([...normalized].at(-1));
    const isLongVowel = character === previousVowel
      || (previousVowel === "お" && character === "う")
      || (previousVowel === "え" && character === "い");
    if (!isLongVowel) normalized += character;
  }
  return normalized;
}

function japaneseNumberToKanji(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 9999) return String(value);
  if (number === 0) return "零";
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const places = [
    [1000, "千"],
    [100, "百"],
    [10, "十"],
  ];
  let remaining = number;
  let output = "";
  places.forEach(([amount, unit]) => {
    const digit = Math.floor(remaining / amount);
    if (!digit) return;
    output += `${digit === 1 ? "" : digits[digit]}${unit}`;
    remaining %= amount;
  });
  return `${output}${digits[remaining]}`;
}

function withKanjiNumbers(value) {
  return String(value || "").replace(/\d+/g, japaneseNumberToKanji);
}

function rubyTextForm(line, readingIndexes) {
  const template = document.createElement("template");
  template.innerHTML = String(line?.japaneseHtml || line?.japanese || "");
  [...template.content.querySelectorAll("ruby")].forEach((ruby, index) => {
    const reading = ruby.querySelector("rt")?.textContent || "";
    const base = [...ruby.childNodes]
      .filter((node) => !["RT", "RP"].includes(node.nodeName))
      .map((node) => node.textContent || "")
      .join("");
    ruby.replaceWith(document.createTextNode(readingIndexes.has(index) && reading ? reading : base));
  });
  template.content.querySelectorAll("rt, rp").forEach((node) => node.remove());
  return template.content.textContent || String(line?.japanese || "");
}

function japaneseTargetDetails(line) {
  if (line && typeof line === "object" && japaneseTargetFormsCache.has(line)) {
    return japaneseTargetFormsCache.get(line);
  }

  const html = String(line?.japaneseHtml || "");
  const rubyCount = (html.match(/<ruby(?:\s|>)/gi) || []).length;
  const forms = new Set([String(line?.japanese || "")]);
  let reading = String(line?.japanese || "");
  if (rubyCount) {
    const allReadings = new Set(Array.from({ length: rubyCount }, (_, index) => index));
    reading = rubyTextForm(line, allReadings);
    forms.add(rubyTextForm(line, new Set()));
    forms.add(reading);
    for (let index = 0; index < rubyCount; index += 1) {
      forms.add(rubyTextForm(line, new Set([index])));
    }
    for (let split = 1; split < rubyCount; split += 1) {
      forms.add(rubyTextForm(line, new Set(Array.from({ length: split }, (_, index) => index))));
      forms.add(rubyTextForm(line, new Set(Array.from({ length: rubyCount - split }, (_, index) => split + index))));
    }
  }

  [...forms].forEach((form) => {
    forms.add(withKanjiNumbers(form));
  });
  forms.add(reading.replace(/は/g, "わ").replace(/へ/g, "え").replace(/を/g, "お"));

  const details = {
    reading,
    forms: [...forms].filter(Boolean),
  };
  if (line && typeof line === "object") japaneseTargetFormsCache.set(line, details);
  return details;
}

function japaneseReadingForLine(line) {
  return japaneseTargetDetails(line).reading;
}

function japaneseComparisonTargets(line) {
  return [...new Set(japaneseTargetDetails(line).forms.map(normalizeJapanesePronunciation).filter(Boolean))];
}

function compareJapaneseTranscript(line, transcript) {
  const actual = normalizeJapanesePronunciation(transcript);
  const targets = japaneseComparisonTargets(line);
  let best = {
    target: targets[0] || "",
    actual,
    distance: actual ? Number.POSITIVE_INFINITY : (targets[0] || "").length,
    accuracy: actual ? 0 : 0,
  };
  targets.forEach((target) => {
    const distance = actual ? levenshtein(target, actual) : target.length;
    const accuracy = Math.round(Math.max(0, 1 - distance / Math.max(target.length, actual.length, 1)) * 100);
    if (distance < best.distance || (distance === best.distance && accuracy > best.accuracy)) {
      best = { target, actual, distance, accuracy };
    }
  });
  return best;
}

function japaneseTranscriptMatchScore(line, transcript) {
  const actual = normalizeJapanesePronunciation(transcript);
  if (!actual) return 0;
  return japaneseComparisonTargets(line).reduce((best, target) => {
    const prefix = target.slice(0, Math.min(target.length, actual.length));
    const distance = levenshtein(prefix, actual);
    const similarity = Math.max(0, 1 - distance / Math.max(prefix.length, actual.length, 1));
    const progress = Math.min(1, actual.length / Math.max(1, target.length));
    return Math.max(best, similarity * 0.9 + progress * 0.1);
  }, 0);
}

function japaneseTranscriptProgress(line, transcript) {
  const actual = normalizeJapanesePronunciation(transcript);
  if (!actual) return 0;
  let bestScore = -1;
  let bestProgress = 0;
  japaneseComparisonTargets(line).forEach((target) => {
    const prefix = target.slice(0, Math.min(target.length, actual.length));
    const distance = levenshtein(prefix, actual);
    const score = Math.max(0, 1 - distance / Math.max(prefix.length, actual.length, 1));
    const progress = Math.min(1, actual.length / Math.max(1, target.length));
    if (score > bestScore || (score === bestScore && progress < bestProgress)) {
      bestScore = score;
      bestProgress = progress;
    }
  });
  return bestProgress;
}

function closestRecognitionText(alternatives, prefix, line) {
  const candidates = (Array.isArray(alternatives) ? alternatives : []).filter(Boolean);
  if (!candidates.length) return "";
  let best = candidates[0];
  let bestScore = japaneseTranscriptMatchScore(line, `${prefix}${best}`);
  candidates.slice(1).forEach((candidate) => {
    const score = japaneseTranscriptMatchScore(line, `${prefix}${candidate}`);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
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
  const fallback = {
    rms: fallbackRms,
    voicedRatio: 0,
    voiceSpanRatio: 0,
    pitchRange: 0,
    pitchMovement: 0,
    activeStartSec: null,
    activeEndSec: null,
    activeRatio: 0,
    activity: [],
  };
  if (!state.recordingBlob || !window.AudioContext) return fallback;
  let context;
  try {
    context = new AudioContext();
    const bytes = await state.recordingBlob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const channel = buffer.getChannelData(0);
    const line = currentLine();
    const targetSamples = Math.max(512, Math.ceil(Math.max(0.1, line.end - line.start) * buffer.sampleRate));
    const samples = channel.subarray(0, Math.min(channel.length, targetSamples));
    if (samples.length < 512) return fallback;
    const frameSize = Math.min(2048, 2 ** Math.max(9, Math.floor(Math.log2(samples.length / 24))));
    const frameLimit = line.isSoundEffect ? 240 : 48;
    const frameCount = Math.max(12, Math.min(frameLimit, Math.floor(samples.length / frameSize)));
    const step = Math.max(1, Math.floor((samples.length - frameSize) / Math.max(1, frameCount - 1)));
    const frames = [];
    for (let offset = 0; offset + frameSize <= samples.length && frames.length < frameCount; offset += step) {
      const frame = samples.subarray(offset, offset + frameSize);
      let squares = 0;
      for (let index = 0; index < frame.length; index += 1) squares += frame[index] * frame[index];
      frames.push({ frame, offset, rms: Math.sqrt(squares / frame.length) });
    }
    const rmsValues = frames.map((item) => item.rms);
    const peakRms = Math.max(...rmsValues, fallbackRms);
    const threshold = Math.max(0.006, peakRms * 0.16);
    const activeFrameIndexes = frames.map((item, index) => item.rms >= threshold ? index : -1).filter((index) => index >= 0);
    const activity = frames.map((item) => ({
      start: item.offset / buffer.sampleRate,
      end: (item.offset + frameSize) / buffer.sampleRate,
      active: item.rms >= threshold,
      rms: item.rms,
    }));
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
      activeStartSec: activeFrameIndexes.length ? activity[activeFrameIndexes[0]].start : null,
      activeEndSec: activeFrameIndexes.length ? activity[activeFrameIndexes.at(-1)].end : null,
      activeRatio: frames.length ? activeFrameIndexes.length / frames.length : 0,
      activity,
      pitchRange: semitones.length > 2 ? percentile(semitones, 0.9) - percentile(semitones, 0.1) : 0,
      pitchMovement: movements.length ? movements.reduce((sum, value) => sum + value, 0) / movements.length : 0,
    };
  } catch {
    return fallback;
  } finally {
    await context?.close().catch(() => {});
  }
}

function soundTimingHitScore(errorSeconds) {
  const error = Math.abs(Number(errorSeconds));
  if (!Number.isFinite(error)) return 0;
  const bands = [
    { end: 0.18, score: 100 },
    { end: 0.35, score: 88 },
    { end: 0.6, score: 65 },
    { end: 1, score: 30 },
    { end: 1.4, score: 5 },
  ];
  let previousEnd = 0;
  let previousScore = 100;
  for (const band of bands) {
    if (error <= band.end) {
      const progress = (error - previousEnd) / Math.max(0.01, band.end - previousEnd);
      return Math.round(previousScore + (band.score - previousScore) * Math.max(0, progress));
    }
    previousEnd = band.end;
    previousScore = band.score;
  }
  return Math.max(0, Math.round(5 - (error - 1.4) * 10));
}

function soundTimingMetrics(line, audioFeatures) {
  const { cueStart, cueEnd, isRange } = soundCueWindow(line);
  const lineStart = Number(line.start) || 0;
  const activity = Array.isArray(audioFeatures?.activity) ? audioFeatures.activity : [];
  const activeFrames = activity.filter((frame) => frame.active);
  const explicitEvents = soundEventsForLine(line);
  if (explicitEvents.length) {
    const eventResults = explicitEvents.map((event) => {
      const expectedStart = Math.max(0, event.start - lineStart);
      const expectedEnd = Math.max(expectedStart + 0.1, event.end - lineStart);
      const duration = expectedEnd - expectedStart;
      const beatCount = Math.max(1, Math.ceil(duration / 2.5));
      let hitBeats = 0;
      for (let index = 0; index < beatCount; index += 1) {
        const beatStart = expectedStart + duration * index / beatCount;
        const beatEnd = expectedStart + duration * (index + 1) / beatCount;
        if (activeFrames.some((frame) => Number(frame.end) >= beatStart && Number(frame.start) <= beatEnd)) hitBeats += 1;
      }
      return { ...event, expectedStart, expectedEnd, beatCount, hitBeats, hit: hitBeats > 0 };
    });
    const expectedStart = eventResults[0].expectedStart;
    const expectedEnd = Math.max(...eventResults.map((event) => event.expectedEnd));
    const actualStart = activeFrames.length ? Number(activeFrames[0].start) : null;
    const onsetError = actualStart === null ? null : actualStart - expectedStart;
    const onsetScore = onsetError === null ? 0 : soundTimingHitScore(onsetError);
    const beatCount = eventResults.reduce((sum, event) => sum + event.beatCount, 0);
    const hitBeats = eventResults.reduce((sum, event) => sum + event.hitBeats, 0);
    const coverageScore = Math.round(hitBeats / Math.max(1, beatCount) * 100);
    return {
      cueStart,
      cueEnd,
      isRange: true,
      explicitEvents: true,
      expectedStart,
      expectedEnd,
      actualStart,
      onsetError,
      onsetScore,
      beatCount,
      hitBeats,
      coverageScore,
      timeline: Math.round(onsetScore * 0.35 + coverageScore * 0.65),
      eventResults,
    };
  }
  const expectedStart = Math.max(0, cueStart - lineStart);
  const expectedEnd = Math.max(expectedStart + 0.1, cueEnd - lineStart);
  const rawFeatureStart = audioFeatures?.activeStartSec;
  const featureStart = rawFeatureStart === null || rawFeatureStart === undefined
    ? Number.NaN
    : Number(rawFeatureStart);
  const actualStart = Number.isFinite(featureStart)
    ? featureStart
    : (activeFrames.length ? Number(activeFrames[0].start) : null);
  const onsetError = actualStart === null ? null : actualStart - expectedStart;
  const onsetScore = onsetError === null ? 0 : soundTimingHitScore(onsetError);
  const beatCount = isRange
    ? Math.max(4, Math.min(12, Math.ceil((cueEnd - cueStart) / 3)))
    : 1;
  const beatDuration = (expectedEnd - expectedStart) / beatCount;
  let hitBeats = 0;
  for (let index = 0; index < beatCount; index += 1) {
    const beatStart = expectedStart + beatDuration * index;
    const beatEnd = expectedStart + beatDuration * (index + 1);
    if (activeFrames.some((frame) => Number(frame.end) >= beatStart && Number(frame.start) <= beatEnd)) hitBeats += 1;
  }
  const coverageScore = Math.round(hitBeats / beatCount * 100);
  const timeline = isRange
    ? Math.round(onsetScore * 0.45 + coverageScore * 0.55)
    : onsetScore;
  return {
    cueStart,
    cueEnd,
    isRange,
    expectedStart,
    expectedEnd,
    actualStart,
    onsetError,
    onsetScore,
    beatCount,
    hitBeats,
    coverageScore,
    timeline,
  };
}

async function localSoundEffectEvaluation() {
  const line = currentLine();
  const audioFeatures = await analyzeRecordingAudio();
  const timing = soundTimingMetrics(line, audioFeatures);
  const rms = Math.max(audioFeatures.rms, state.waveformSamples ? Math.sqrt(state.waveformSquares / state.waveformSamples) : 0);
  const clipping = state.waveformSamples ? state.clippingSamples / state.waveformSamples : 0;
  const expectedActiveRatio = timing.isRange ? 0.1 : 0.035;
  const presence = rms < 0.008 || timing.actualStart === null
    ? 15
    : Math.round(Math.min(100, 40 + Math.min(1, audioFeatures.activeRatio / expectedActiveRatio) * 60));
  let volume = rms < 0.008 ? 20 : rms < 0.025 ? 65 : rms <= 0.28 ? 96 : 75;
  if (clipping > 0.01) volume = Math.max(35, volume - 28);
  const weightedOverall = Math.round(timing.timeline * 0.78 + presence * 0.1 + volume * 0.12);
  const coverageCap = Math.round(40 + timing.coverageScore * 0.6);
  const overall = timing.isRange ? Math.min(weightedOverall, coverageCap) : weightedOverall;
  const issues = [];
  const targetLabel = timing.isRange
    ? `${formatTime(timing.cueStart)}–${formatTime(timing.cueEnd)}`
    : formatTime(timing.cueStart);
  if (timing.actualStart === null) {
    issues.push(`沒有偵測到明確起音；目標提示節拍是 ${formatTime(timing.cueStart)}。`);
  } else {
    const actualCueTime = Number(line.start) + timing.actualStart;
    const difference = Math.abs(timing.onsetError);
    if (difference <= 0.18) issues.push(`起音命中提示節拍，誤差 ${difference.toFixed(2)} 秒。`);
    else if (timing.onsetError < 0) issues.push(`偵測起音 ${formatTime(actualCueTime)}，比提示節拍早 ${difference.toFixed(2)} 秒。`);
    else issues.push(`偵測起音 ${formatTime(actualCueTime)}，比提示節拍晚 ${difference.toFixed(2)} 秒。`);
  }
  if (timing.isRange) {
    const missedEvents = timing.eventResults?.filter((event) => !event.hit) || [];
    issues.push(`${timing.explicitEvents ? "逐事件" : "指定區間"} ${timing.hitBeats} / ${timing.beatCount} 個節拍偵測到音效。`);
    if (missedEvents.length) {
      issues.push(`未命中：${missedEvents.map((event) => `${event.word}（${formatTime(event.start)}）`).join("、")}。`);
    }
  }
  if (rms < 0.008 || timing.actualStart === null) issues.push("幾乎沒有偵測到音效，請靠近麥克風或提高音效強度。");
  else if (clipping > 0.01) issues.push("音效有爆音跡象，請降低音量或離麥克風遠一點。");
  else issues.push("音效音量可供小組合成預覽使用。");
  issues.push("本次依實際起音與畫面節拍評分，不再只用錄音長度判定。");
  const scores = {
    "出聲時機": timing.onsetScore,
    ...(timing.isRange ? { [timing.explicitEvents ? "逐事件節拍" : "區間節拍"]: timing.coverageScore } : {}),
    "音效存在": presence,
    "音量": volume,
  };
  return {
    overall,
    aspects: {
      accent: presence,
      intonation: timing.isRange ? timing.coverageScore : timing.onsetScore,
      speed: timing.timeline,
      volume,
    },
    scores,
    issues,
    diffHtml: escapeHtml(`${line.soundName}｜目標 ${targetLabel}｜${line.soundMethod}`),
    mode: "音效節拍評分",
  };
}

async function localEvaluation() {
  const line = currentLine();
  if (line.isSoundEffect) return localSoundEffectEvaluation();
  const comparison = compareJapaneseTranscript(line, elements.recognizedText.value);
  const { target, actual, accuracy } = comparison;
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
  issues.push("語速計分只計正式台詞區間，不包含前奏、收尾緩衝與按鍵延遲。");
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
