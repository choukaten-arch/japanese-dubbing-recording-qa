const QA_WORKS = Object.freeze([
  { slug: "kiki", title: "魔女宅急便", navTitle: "魔女宅急便", lineCount: 59 },
  { slug: "ponyo", title: "崖上的波妞", navTitle: "崖上的波妞", lineCount: 77 },
  { slug: "maruko", title: "櫻桃小丸子：來自義大利的少年", navTitle: "櫻桃小丸子", lineCount: 88 },
  { slug: "spirited-away", title: "神隱少女", navTitle: "神隱少女", lineCount: 70 },
  { slug: "totoro", title: "龍貓", navTitle: "龍貓", lineCount: 54 },
]);

const QA_RELEASE = "20260721.7";
const QA_RECORDING_TIMING = Object.freeze({
  previousCueMaxSeconds: 4,
  fallbackPreRollSeconds: 2.1,
  postRollSeconds: 1.25,
});
const SOUND_EFFECT_LINE_BASE = 9001;

function parseCueClock(value) {
  const parts = String(value || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function soundCueBounds(timeLabel, duration) {
  const points = String(timeLabel || "").split(/\s*[–—-]\s*/).map(parseCueClock).filter(Number.isFinite);
  const limit = Math.max(0, Number(duration) || 0);
  if (points.length > 1) {
    const cueStart = Math.max(0, points[0]);
    const cueEnd = Math.max(cueStart + 0.5, limit ? Math.min(limit, points[1]) : points[1]);
    return {
      start: cueStart,
      end: cueEnd,
      cueStart,
      cueEnd,
      cueIsRange: true,
    };
  }
  const cueStart = Math.max(0, points[0] || 0);
  const cueEnd = limit ? Math.min(limit, cueStart + 0.65) : cueStart + 0.65;
  return {
    start: Math.max(0, cueStart - 1.2),
    end: limit ? Math.min(limit, cueStart + 2.2) : cueStart + 2.2,
    cueStart,
    cueEnd,
    cueIsRange: false,
  };
}

function soundEffectRoleName(cue) {
  return `音效＿${String(cue?.sound || "未命名音效").trim()}＿${String(cue?.time || "00:00").trim()}`;
}

function extendWorkDataWithSoundEffects(source) {
  if (!source || source.soundEffectsReady) return source;
  const cues = Array.isArray(source.soundCues) ? source.soundCues : [];
  const effectLines = cues.map((cue, cueIndex) => {
    const bounds = soundCueBounds(cue.time, source.duration);
    return {
      index: SOUND_EFFECT_LINE_BASE + cueIndex,
      displayIndex: `S${cueIndex + 1}`,
      start: bounds.start,
      end: bounds.end,
      cueStart: bounds.cueStart,
      cueEnd: bounds.cueEnd,
      cueIsRange: bounds.cueIsRange,
      role: soundEffectRoleName(cue),
      japanese: String(cue.sound || "音效"),
      japaneseHtml: String(cue.sound || "音效"),
      translation: String(cue.method || "依時間軸完成音效"),
      performance: String(cue.method || "依時間軸完成音效"),
      cueTime: String(cue.time || ""),
      soundName: String(cue.sound || "音效"),
      soundMethod: String(cue.method || ""),
      onomatopoeia: (Array.isArray(cue.onomatopoeia) ? cue.onomatopoeia : [cue.onomatopoeia])
        .map((word) => String(word || "").trim())
        .filter(Boolean),
      isSoundEffect: true,
    };
  });
  const effectRoles = effectLines.map((line) => ({
    role: line.role,
    lineCount: 1,
    characterCount: 0,
    cueTime: line.cueTime,
    soundName: line.soundName,
    isSoundEffect: true,
  }));
  const roles = [...(source.roles || []), ...effectRoles];
  const lines = [...(source.lines || []), ...effectLines];
  return {
    ...source,
    roles,
    lines,
    lineCount: lines.length,
    roleCount: roles.length,
    soundEffectCount: effectLines.length,
    soundEffectsReady: true,
  };
}

window.QA_WORKS = QA_WORKS;
window.QA_RELEASE = QA_RELEASE;
window.QA_RECORDING_TIMING = QA_RECORDING_TIMING;
window.QA_SOUND_EFFECT_LINE_BASE = SOUND_EFFECT_LINE_BASE;
window.soundEffectRoleName = soundEffectRoleName;
window.extendWorkDataWithSoundEffects = extendWorkDataWithSoundEffects;
window.PLATFORM_CONFIG = Object.freeze({
  apiUrl: "https://script.google.com/macros/s/AKfycbwS2kKeZ7iVnlPTVE-dl6mVGTIAxkNpUPZnMOljsphbXsBbSLUdHulV1JDQ8_uS9plQ/exec",
  sessionKey: "dubbingPlatformSessionV1",
  taskKey: "dubbingPlatformActiveTaskV1",
});

function hasValidPlatformSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(window.PLATFORM_CONFIG.sessionKey));
    return Boolean(stored?.session?.token && Number(stored.session.expiresAt) > Date.now());
  } catch {
    return false;
  }
}

const isPortalPage = /\/portal\.html$/.test(location.pathname);
const allowPublicQa = ["127.0.0.1", "localhost"].includes(location.hostname)
  && new URLSearchParams(location.search).get("public") === "1";
if (!isPortalPage && !allowPublicQa && !hasValidPlatformSession()) {
  location.replace(new URL("portal.html", location.href).href);
}

const requestedWork = new URLSearchParams(location.search).get("work");
const activeWork = QA_WORKS.find((work) => work.slug === requestedWork) || QA_WORKS[0];
const nativeReplaceState = history.replaceState.bind(history);

window.QA_CONFIG = Object.freeze({
  evaluationApiUrl: "",
  productionSiteBase: "https://choukaten-arch.github.io/japanese-dubbing-practice/",
  dataFile: `data/${activeWork.slug}.json?v=${QA_RELEASE}`,
  activeWork,
  works: QA_WORKS,
});

history.replaceState = (state, unused, url) => {
  if (typeof url === "string" && /^#line-\d+$/.test(url)) {
    const params = new URLSearchParams(location.search);
    params.set("work", activeWork.slug);
    return nativeReplaceState(state, unused, `${location.pathname}?${params}${url}`);
  }
  return nativeReplaceState(state, unused, url);
};

function renderWorkSwitcher() {
  const heading = document.querySelector(".work-heading");
  const pageTitle = document.getElementById("pageTitle");
  if (!heading || !pageTitle) return;

  const navigation = document.createElement("nav");
  navigation.className = "work-switcher";
  navigation.setAttribute("aria-label", "選擇配音作品");

  const label = document.createElement("span");
  label.className = "work-switcher__label";
  label.textContent = "五部作品";

  const tabs = document.createElement("div");
  tabs.className = "work-switcher__tabs";
  let activeLink;

  QA_WORKS.forEach((work) => {
    const link = document.createElement("a");
    link.className = "work-switcher__link";
    link.href = `?work=${encodeURIComponent(work.slug)}#line-1`;
    link.innerHTML = `<strong>${work.navTitle}</strong><span>${work.lineCount} 句</span>`;
    if (work.slug === activeWork.slug) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
      activeLink = link;
    }
    tabs.append(link);
  });

  navigation.append(label, tabs);
  heading.before(navigation);
  pageTitle.textContent = activeWork.title;
  document.title = `${activeWork.navTitle}錄音評分 QA｜日語配音練習站`;
  requestAnimationFrame(() => {
    if (!activeLink || tabs.scrollWidth <= tabs.clientWidth) return;
    const centeredLeft = activeLink.offsetLeft - (tabs.clientWidth - activeLink.offsetWidth) / 2;
    tabs.scrollLeft = Math.max(0, centeredLeft);
  });
}

document.addEventListener("DOMContentLoaded", renderWorkSwitcher);
