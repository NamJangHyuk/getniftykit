// 특수문자 모음 도구의 핵심 로직
// 1) specialchars.json(직접 큐레이션한 정적 데이터)을 불러오고
// 2) 검색어/카테고리 필터에 맞춰 화면에 카드를 그리고
// 3) 클릭 시 문자를 클립보드로 복사합니다.
// 이미지 리소스가 전혀 없는 순수 텍스트 문자라서 서버 통신 없이도 매우 빠르고 안정적입니다.

const searchInput = document.getElementById("search-input");
const charGrid = document.getElementById("char-grid");
const resultCount = document.getElementById("result-count");
const categoryTabs = document.getElementById("category-tabs");
const searchSection = document.querySelector(".search-section");
const copyToast = document.getElementById("copy-toast");
const recentSection = document.getElementById("recent-section");
const recentGrid = document.getElementById("recent-grid");
const recentClear = document.getElementById("recent-clear");

let allChars = [];
let groups = [];
let activeGroup = "all";

// "자주 사용한 문자"는 서버로 전송되지 않고 이 브라우저의 localStorage에만 남습니다.
const RECENT_KEY = "special-char:recentlyUsed";
const RECENT_MAX = 30;

// 이 페이지가 한국어(/ko/special-char/)·영어(/en/...)·일본어(/ja/...)·중국어(/zh/...) 중
// 어느 버전인지는 <html lang>으로 구분합니다. 화면에 보이는 고정 UI 문구(에러 메시지,
// 결과 개수, 토스트 등)만 이 언어를 따르고, 문자 이름 표시 언어(uiLang, 아래 detectLang()
// 참고)는 한국어 페이지에 한해서만 브라우저 언어를 자동 감지합니다.
const pageLang = document.documentElement.lang || "ko";

const UI_STRINGS = {
  ko: {
    loadError: "특수문자 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    noResults: "검색 결과가 없습니다.",
    resultCountSuffix: "개 문자",
    copyAria: (name) => `${name} 복사`,
    copiedToast: (name, char) => `${name} 복사됨 ${char}`,
    copyFailed: "복사에 실패했습니다",
    recentCardAria: (name) => `${name}, 목록에서 위치 보기`,
  },
  en: {
    loadError: "Couldn't load the character list. Please try again shortly.",
    noResults: "No results found.",
    resultCountSuffix: " characters",
    copyAria: (name) => `Copy ${name}`,
    copiedToast: (name, char) => `Copied ${name} ${char}`,
    copyFailed: "Copy failed",
    recentCardAria: (name) => `${name}, jump to it in the list`,
  },
  ja: {
    loadError: "文字リストを読み込めませんでした。しばらくしてからもう一度お試しください。",
    noResults: "検索結果がありません。",
    resultCountSuffix: "件の文字",
    copyAria: (name) => `${name}をコピー`,
    copiedToast: (name, char) => `${name}をコピーしました ${char}`,
    copyFailed: "コピーに失敗しました",
    recentCardAria: (name) => `${name}、リスト内の位置を表示`,
  },
  zh: {
    loadError: "无法加载字符列表，请稍后重试。",
    noResults: "未找到搜索结果。",
    resultCountSuffix: "个字符",
    copyAria: (name) => `复制${name}`,
    copiedToast: (name, char) => `已复制${name} ${char}`,
    copyFailed: "复制失败",
    recentCardAria: (name) => `${name}，跳转到列表中的位置`,
  },
};
const T = UI_STRINGS[pageLang];

// specialchars.json의 names 객체가 지원하는 언어 키 목록입니다.
const SUPPORTED_LANGS = ["en", "ko", "ja", "zh"];

function detectLang() {
  const browserLangs = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || "en"];

  for (const lang of browserLangs) {
    const primary = lang.toLowerCase().split("-")[0];
    if (SUPPORTED_LANGS.includes(primary)) return primary;
  }
  return "en";
}

// /en/, /ja/, /zh/ 페이지는 hreflang으로 "이건 이 언어 전용 페이지"라고 검색엔진에
// 명시해뒀기 때문에, 방문자의 브라우저 언어와 상관없이 문자 이름도 항상 그 언어로
// 고정합니다. 한국어(기본) 페이지만 브라우저 언어를 자동 감지해서 보여줍니다.
const uiLang = pageLang !== "ko" ? pageLang : detectLang();

function displayName(item) {
  return item.names[uiLang] || item.names.en;
}

async function loadData() {
  try {
    const res = await fetch("specialchars.json");
    if (!res.ok) throw new Error(`specialchars.json 로드 실패: ${res.status}`);
    const data = await res.json();
    groups = data.groups;
    allChars = data.chars;
    renderCategoryTabs();
    applyFilters();
    renderRecent();
  } catch (err) {
    charGrid.innerHTML = `<p class="no-results">${T.loadError}</p>`;
    console.error(err);
  }
}

function renderCategoryTabs() {
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-tab";
    btn.dataset.group = String(group.order);
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.textContent = group.names[uiLang] || group.names.en;
    fragment.appendChild(btn);
  }
  categoryTabs.appendChild(fragment);
}

function buildCard(item) {
  const primaryName = displayName(item);

  const card = document.createElement("div");
  card.className = "char-card";
  card.dataset.code = item.code;

  const visual = document.createElement("button");
  visual.type = "button";
  visual.className = "char-visual";
  visual.setAttribute("aria-label", T.copyAria(primaryName));
  visual.title = primaryName;
  visual.textContent = item.char;

  visual.addEventListener("click", () => copyChar(item));
  card.appendChild(visual);

  return card;
}

function groupName(groupIndex) {
  const group = groups[groupIndex];
  if (!group) return "";
  return group.names[uiLang] || group.names.en;
}

function render(list) {
  resultCount.textContent = `${list.length}${T.resultCountSuffix}`;

  if (list.length === 0) {
    charGrid.innerHTML = `<p class="no-results">${T.noResults}</p>`;
    return;
  }

  // list는 항상 데이터의 원래 순서(카테고리 순)를 유지하고 있어서, 훑으면서 group 값이
  // 바뀔 때마다 새 소제목 섹션을 시작하면 됩니다.
  const fragment = document.createDocumentFragment();
  let currentGroup = null;
  let currentGrid = null;

  for (const item of list) {
    if (item.group !== currentGroup) {
      currentGroup = item.group;

      const section = document.createElement("div");
      section.className = "char-subgroup";

      const title = document.createElement("h3");
      title.className = "char-subgroup-title";
      title.textContent = groupName(currentGroup);
      section.appendChild(title);

      currentGrid = document.createElement("div");
      currentGrid.className = "char-grid";
      section.appendChild(currentGrid);

      fragment.appendChild(section);
    }

    currentGrid.appendChild(buildCard(item));
  }

  charGrid.innerHTML = "";
  charGrid.appendChild(fragment);
}

let toastTimer = null;

async function copyChar(item) {
  try {
    await navigator.clipboard.writeText(item.char);
    showToast(T.copiedToast(displayName(item), item.char));
    recordRecent(item.code);
  } catch (err) {
    // 클립보드 권한이 막힌 브라우저(오래된 사파리 등)를 위한 대체 방법입니다.
    const textarea = document.createElement("textarea");
    textarea.value = item.char;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showToast(T.copiedToast(displayName(item), item.char));
      recordRecent(item.code);
    } catch {
      showToast(T.copyFailed);
    }
    textarea.remove();
  }
}

function loadRecentCodes() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentCodes(codes) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(codes));
  } catch {
    // 시크릿 모드 등 localStorage를 못 쓰는 환경에서는 조용히 무시합니다(핵심 기능이 아님).
  }
}

function recordRecent(code) {
  const codes = loadRecentCodes().filter((c) => c !== code);
  codes.unshift(code);
  saveRecentCodes(codes.slice(0, RECENT_MAX));
  renderRecent();
}

function renderRecent() {
  const codes = loadRecentCodes();
  const byCode = new Map(allChars.map((c) => [c.code, c]));
  const recentChars = codes.map((code) => byCode.get(code)).filter(Boolean);

  if (recentChars.length === 0) {
    recentSection.hidden = true;
    return;
  }

  recentSection.hidden = false;

  const fragment = document.createDocumentFragment();
  for (const item of recentChars) {
    const name = displayName(item);

    const card = document.createElement("div");
    card.className = "recent-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", T.recentCardAria(name));

    const visual = document.createElement("span");
    visual.className = "recent-card-fallback";
    visual.textContent = item.char;

    // 자주 사용한 문자 카드를 누르면 복사도 되고(핵심 기능), 본문 목록에서
    // 어디 있는지도 보여주도록(기존 기능) 두 동작을 함께 실행합니다.
    const open = () => {
      copyChar(item);
      jumpToChar(item);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    card.appendChild(visual);
    fragment.appendChild(card);
  }

  recentGrid.innerHTML = "";
  recentGrid.appendChild(fragment);
}

recentClear.addEventListener("click", () => {
  saveRecentCodes([]);
  renderRecent();
});

function jumpToChar(item) {
  // 검색어나 카테고리 필터가 걸려있으면 그 문자가 목록에서 안 보일 수 있어서,
  // "자주 사용한 문자"에서 누르면 항상 전체 목록으로 리셋한 뒤 찾아갑니다.
  searchInput.value = "";
  activeGroup = "all";
  for (const tab of categoryTabs.querySelectorAll(".category-tab")) {
    const isAll = tab.dataset.group === "all";
    tab.classList.toggle("is-active", isAll);
    tab.setAttribute("aria-selected", String(isAll));
  }
  applyFilters();

  requestAnimationFrame(() => {
    const target = charGrid.querySelector(`[data-code="${item.code}"]`);
    if (!target) return;

    scrollToElement(target, 24);

    target.classList.remove("is-flashing");
    void target.offsetWidth;
    target.classList.add("is-flashing");
    target.addEventListener(
      "animationend",
      () => target.classList.remove("is-flashing"),
      { once: true }
    );
  });
}

function showToast(message) {
  copyToast.textContent = message;
  copyToast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => copyToast.classList.remove("is-visible"), 1600);
}

function normalize(str) {
  return str.toLowerCase().trim();
}

function applyFilters() {
  const query = normalize(searchInput.value);

  let filtered = allChars;

  if (activeGroup !== "all") {
    const groupNum = Number(activeGroup);
    filtered = filtered.filter((c) => c.group === groupNum);
  }

  if (query) {
    filtered = filtered.filter((c) =>
      Object.values(c.names).some((name) => normalize(name).includes(query))
    );
  }

  render(filtered);
}

searchInput.addEventListener("input", applyFilters);

categoryTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".category-tab");
  if (!btn) return;

  activeGroup = btn.dataset.group;

  for (const tab of categoryTabs.querySelectorAll(".category-tab")) {
    const isActive = tab === btn;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  }

  applyFilters();
  scrollToElement(resultCount);
});

function scrollToElement(el, extraOffset = 8) {
  const stickyOffset = searchSection ? searchSection.offsetHeight : 0;
  const top = el.getBoundingClientRect().top + window.scrollY - stickyOffset - extraOffset;
  window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
}

loadData();
