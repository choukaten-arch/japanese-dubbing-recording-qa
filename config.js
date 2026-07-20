const QA_WORKS = Object.freeze([
  { slug: "kiki", title: "魔女宅急便", navTitle: "魔女宅急便", lineCount: 59 },
  { slug: "ponyo", title: "崖上的波妞", navTitle: "崖上的波妞", lineCount: 77 },
  { slug: "maruko", title: "櫻桃小丸子：來自義大利的少年", navTitle: "櫻桃小丸子", lineCount: 88 },
  { slug: "spirited-away", title: "神隱少女", navTitle: "神隱少女", lineCount: 70 },
  { slug: "totoro", title: "龍貓", navTitle: "龍貓", lineCount: 54 },
]);

window.QA_WORKS = QA_WORKS;
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
  dataFile: `data/${activeWork.slug}.json`,
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
