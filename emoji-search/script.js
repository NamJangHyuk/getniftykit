// 이모지 검색 도구의 핵심 로직
// 1) emojis.json(빌드 시 미리 생성해둔 정적 데이터)을 불러오고
// 2) 검색어/카테고리 필터에 맞춰 화면에 카드를 그리고
// 3) 클릭 시 이모지를 클립보드로 복사합니다.
// (PNG/SVG 다운로드 기능은 코드상 남겨두고 UI에서만 숨겨둔 상태입니다 — SHOW_DOWNLOAD_BUTTONS 참고)
// 서버 통신이 전혀 없어서 매우 빠르고 안정적입니다.

const searchInput = document.getElementById("search-input");
const emojiGrid = document.getElementById("emoji-grid");
const resultCount = document.getElementById("result-count");
const categoryTabs = document.getElementById("category-tabs");
const searchSection = document.querySelector(".search-section");
const copyToast = document.getElementById("copy-toast");
const recentSection = document.getElementById("recent-section");
const recentGrid = document.getElementById("recent-grid");
const recentClear = document.getElementById("recent-clear");

// PNG/SVG 다운로드 버튼은 당분간 숨겨두고 복사 기능만 노출합니다.
// (이미지/다운로드 로직 자체는 그대로 남겨둬서, 나중에 true로 바꾸면 바로 복원됩니다.)
const SHOW_DOWNLOAD_BUTTONS = false;

let allEmojis = [];
let groups = [];
let subgroups = [];
let activeGroup = "all";

// "자주 사용한 이모지"는 서버로 전송되지 않고 이 브라우저의 localStorage에만 남습니다.
const RECENT_KEY = "emoji-search:recentlyUsed";
const RECENT_MAX = 30;

// 이 페이지가 한국어(/ko/emoji-search/)·영어(/en/...)·일본어(/ja/...)·중국어(/zh/...) 중
// 어느 버전인지는 <html lang>으로 구분합니다. 화면에 보이는 고정 UI 문구(에러 메시지,
// 결과 개수, 토스트 등)만 이 언어를 따르고, 이모지 이름 표시 언어(uiLang, 아래 detectLang()
// 참고)는 한국어 페이지에 한해서만 지금까지처럼 브라우저 언어를 자동 감지합니다.
const pageLang = document.documentElement.lang || "ko";

const UI_STRINGS = {
  ko: {
    loadError: "이모지 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    noResults: "검색 결과가 없습니다.",
    resultCountSuffix: "개 이모지",
    copyAria: (name) => `${name} 이모지 복사`,
    emojiAlt: (name) => `${name} 이모지`,
    copiedToast: (name, emoji) => `${name} 복사됨 ${emoji}`,
    copyFailed: "복사에 실패했습니다",
    recentCardAria: (name) => `${name} 이모지, 목록에서 위치 보기`,
  },
  en: {
    loadError: "Couldn't load the emoji list. Please try again shortly.",
    noResults: "No results found.",
    resultCountSuffix: " emojis",
    copyAria: (name) => `Copy ${name} emoji`,
    emojiAlt: (name) => `${name} emoji`,
    copiedToast: (name, emoji) => `Copied ${name} ${emoji}`,
    copyFailed: "Copy failed",
    recentCardAria: (name) => `${name} emoji, jump to it in the list`,
  },
  ja: {
    loadError: "絵文字リストを読み込めませんでした。しばらくしてからもう一度お試しください。",
    noResults: "検索結果がありません。",
    resultCountSuffix: "件の絵文字",
    copyAria: (name) => `${name}をコピー`,
    emojiAlt: (name) => `${name}の絵文字`,
    copiedToast: (name, emoji) => `${name}をコピーしました ${emoji}`,
    copyFailed: "コピーに失敗しました",
    recentCardAria: (name) => `${name}の絵文字、リスト内の位置を表示`,
  },
  zh: {
    loadError: "无法加载表情符号列表，请稍后重试。",
    noResults: "未找到搜索结果。",
    resultCountSuffix: "个表情符号",
    copyAria: (name) => `复制${name}表情`,
    emojiAlt: (name) => `${name}表情符号`,
    copiedToast: (name, emoji) => `已复制${name} ${emoji}`,
    copyFailed: "复制失败",
    recentCardAria: (name) => `${name}表情符号，跳转到列表中的位置`,
  },
};
const T = UI_STRINGS[pageLang];

// emojis.json의 names 객체가 지원하는 언어 키 목록입니다 (emojibase-data가 제공하는 4개 언어).
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

// /en/, /ja/, /zh/ 페이지는 검색엔진에 "이건 이 언어 전용 페이지"라고 hreflang으로
// 명시해뒀기 때문에, 방문자의 브라우저 언어와 상관없이 카테고리 탭·소제목 등 이모지
// 이름도 항상 그 언어로 고정합니다. (그렇지 않으면 영어 페이지인데 한국어 브라우저로
// 접속한 방문자에게 카테고리만 한국어로 보이는 언어가 뒤섞인 페이지가 되어버립니다.)
// 한국어(기본) 페이지만 기존처럼 브라우저 언어를 자동 감지해서 보여주는 동작을 유지합니다.
const uiLang = pageLang !== "ko" ? pageLang : detectLang();

function displayName(item) {
  return item.names[uiLang] || item.names.en;
}

async function loadData() {
  try {
    const res = await fetch("emojis.json");
    if (!res.ok) throw new Error(`emojis.json 로드 실패: ${res.status}`);
    const data = await res.json();
    groups = data.groups;
    subgroups = data.subgroups;
    allEmojis = data.emojis;
    renderCategoryTabs();
    applyFilters();
    renderRecent();
  } catch (err) {
    emojiGrid.innerHTML = `<p class="no-results">${T.loadError}</p>`;
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
  // 이모지는 빠르게 훑고 바로 복사하는 게 핵심이라, 이름 텍스트는 화면에 표시하지 않고
  // (스크린리더용 aria-label로만 남겨두고) 이모지 자체만 큼직하게 보여줍니다.
  const primaryName = displayName(item);

  const card = document.createElement("div");
  card.className = "emoji-card";
  card.dataset.hexcode = item.hexcode;

  const visual = document.createElement("button");
  visual.type = "button";
  visual.className = "emoji-visual";
  visual.setAttribute("aria-label", T.copyAria(primaryName));
  visual.title = primaryName;

  if (item.hasImage) {
    const img = document.createElement("img");
    img.src = `emoji-thumb/${item.hexcode}.png`;
    img.alt = T.emojiAlt(primaryName);
    img.loading = "lazy";
    visual.appendChild(img);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "emoji-fallback";
    fallback.textContent = item.emoji;
    visual.appendChild(fallback);
  }

  visual.addEventListener("click", () => copyEmoji(item));
  card.appendChild(visual);

  // 이미지 파일이 있는 이모지만 PNG/SVG 다운로드 버튼을 보여줍니다.
  if (SHOW_DOWNLOAD_BUTTONS && item.hasImage) {
    const btnRow = document.createElement("div");
    btnRow.className = "download-btn-row";

    const pngBtn = document.createElement("button");
    pngBtn.className = "download-btn";
    pngBtn.type = "button";
    pngBtn.textContent = "PNG";
    pngBtn.addEventListener("click", () => downloadEmoji(item, "png"));
    btnRow.appendChild(pngBtn);

    const svgBtn = document.createElement("button");
    svgBtn.className = "download-btn download-btn-svg";
    svgBtn.type = "button";
    svgBtn.textContent = "SVG";
    svgBtn.addEventListener("click", () => downloadEmoji(item, "svg"));
    btnRow.appendChild(svgBtn);

    card.appendChild(btnRow);
  }

  return card;
}

function subgroupName(subgroupIndex) {
  const sg = subgroups[subgroupIndex];
  if (!sg) return "";
  return sg.names[uiLang] || sg.names.en;
}

function render(list) {
  resultCount.textContent = `${list.length}${T.resultCountSuffix}`;

  if (list.length === 0) {
    emojiGrid.innerHTML = `<p class="no-results">${T.noResults}</p>`;
    return;
  }

  // list는 항상 emojibase의 원래 순서(그룹→서브그룹→순번)를 유지하고 있어서,
  // 훑으면서 subgroup 값이 바뀔 때마다 새 소제목 섹션을 시작하면 됩니다.
  // (매번 새 DOM을 통째로 그리기보다 문서 조각에 모아 한 번에 붙여서 reflow를 줄입니다.)
  const fragment = document.createDocumentFragment();
  let currentSubgroup = null;
  let currentGrid = null;

  for (const item of list) {
    if (item.subgroup !== currentSubgroup) {
      currentSubgroup = item.subgroup;

      const section = document.createElement("div");
      section.className = "emoji-subgroup";

      const title = document.createElement("h3");
      title.className = "emoji-subgroup-title";
      title.textContent = subgroupName(currentSubgroup);
      section.appendChild(title);

      currentGrid = document.createElement("div");
      currentGrid.className = "emoji-grid";
      section.appendChild(currentGrid);

      fragment.appendChild(section);
    }

    currentGrid.appendChild(buildCard(item));
  }

  emojiGrid.innerHTML = "";
  emojiGrid.appendChild(fragment);
}

let toastTimer = null;

async function copyEmoji(item) {
  try {
    await navigator.clipboard.writeText(item.emoji);
    showToast(T.copiedToast(displayName(item), item.emoji));
    recordRecent(item.hexcode);
  } catch (err) {
    // 클립보드 권한이 막힌 브라우저(오래된 사파리 등)를 위한 대체 방법입니다.
    const textarea = document.createElement("textarea");
    textarea.value = item.emoji;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showToast(T.copiedToast(displayName(item), item.emoji));
      recordRecent(item.hexcode);
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

function recordRecent(hexcode) {
  const codes = loadRecentCodes().filter((c) => c !== hexcode);
  codes.unshift(hexcode);
  saveRecentCodes(codes.slice(0, RECENT_MAX));
  renderRecent();
}

function renderRecent() {
  const codes = loadRecentCodes();
  const byCode = new Map(allEmojis.map((e) => [e.hexcode, e]));
  const recentEmojis = codes.map((code) => byCode.get(code)).filter(Boolean);

  if (recentEmojis.length === 0) {
    recentSection.hidden = true;
    return;
  }

  recentSection.hidden = false;

  const fragment = document.createDocumentFragment();
  for (const item of recentEmojis) {
    const name = displayName(item);

    const card = document.createElement("div");
    card.className = "recent-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", T.recentCardAria(name));

    const visual = document.createElement("span");
    visual.className = "recent-card-visual";
    if (item.hasImage) {
      const img = document.createElement("img");
      img.src = `emoji-thumb/${item.hexcode}.png`;
      img.alt = T.emojiAlt(name);
      img.loading = "lazy";
      visual.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "recent-card-fallback";
      fallback.textContent = item.emoji;
      visual.appendChild(fallback);
    }

    // 자주 사용한 이모지 카드를 누르면 복사도 되고(핵심 기능), 본문 목록에서
    // 어디 있는지도 보여주도록(기존 기능) 두 동작을 함께 실행합니다.
    const open = () => {
      copyEmoji(item);
      jumpToEmoji(item);
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

function jumpToEmoji(item) {
  // 검색어나 카테고리 필터가 걸려있으면 그 이모지가 목록에서 안 보일 수 있어서,
  // "자주 사용한 이모지"에서 누르면 항상 전체 목록으로 리셋한 뒤 찾아갑니다.
  searchInput.value = "";
  activeGroup = "all";
  for (const tab of categoryTabs.querySelectorAll(".category-tab")) {
    const isAll = tab.dataset.group === "all";
    tab.classList.toggle("is-active", isAll);
    tab.setAttribute("aria-selected", String(isAll));
  }
  applyFilters();

  requestAnimationFrame(() => {
    const target = emojiGrid.querySelector(`[data-hexcode="${item.hexcode}"]`);
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

function downloadEmoji(item, format) {
  const slug = item.names.en.replace(/\s+/g, "-").toLowerCase();
  const src = format === "svg" ? `emoji-svg/${item.hexcode}.svg` : `emoji-png/${item.hexcode}.png`;

  const link = document.createElement("a");
  link.href = src;
  link.download = `${slug}-emoji.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function normalize(str) {
  return str.toLowerCase().trim();
}

function applyFilters() {
  const query = normalize(searchInput.value);

  let filtered = allEmojis;

  if (activeGroup !== "all") {
    const groupNum = Number(activeGroup);
    filtered = filtered.filter((e) => e.group === groupNum);
  }

  if (query) {
    filtered = filtered.filter((e) =>
      e.searchTerms.some((term) => normalize(term).includes(query))
    );
  }

  // emojibase가 정해둔 순서(group/order)가 이미 표준 이모지 피커와 같은 자연스러운
  // 배열이라, 이름 기준 재정렬 없이 그대로 사용합니다.
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
