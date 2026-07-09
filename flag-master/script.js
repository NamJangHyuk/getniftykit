// 국기 다운로드 도구의 핵심 로직
// 1) countries.json(빌드 시 미리 생성해둔 정적 데이터)을 불러오고
// 2) 검색어/대륙 필터에 맞춰 화면에 카드를 그리고
// 3) 클릭 시 미리 저장해둔 국기 PNG/SVG를 다운로드시킵니다.
// 서버 통신이나 런타임 이미지 변환이 전혀 없어서 매우 빠르고 안정적입니다.

const searchInput = document.getElementById("search-input");
const flagGrid = document.getElementById("flag-grid");
const resultCount = document.getElementById("result-count");
const continentTabs = document.getElementById("continent-tabs");
const searchSection = document.querySelector(".search-section");
const recentSection = document.getElementById("recent-section");
const recentGrid = document.getElementById("recent-grid");
const recentToggle = document.getElementById("recent-toggle");
const recentClear = document.getElementById("recent-clear");

let countries = [];
let activeRegion = "all";

// "내가 찾아본 국가"는 서버로 전송되지 않고 이 브라우저의 localStorage에만 남습니다.
const RECENT_KEY = "flag-master:recentlyViewed";
const RECENT_MAX = 30;
let recentExpanded = false;

// countries.json의 names 객체가 지원하는 언어 키 목록입니다.
// 브라우저의 navigator.language(예: "ko-KR", "ja-JP", "zh-TW")에서 앞부분(주 언어 코드)만
// 추출해 이 목록에 있으면 그 언어로, 없으면 영어(en)로 국가명을 표시합니다.
const SUPPORTED_LANGS = ["en", "ko", "ja", "zh", "ar", "es", "fr", "de", "ru", "pt"];

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

const uiLang = detectLang();

// 한글/영어/스페인어/프랑스어/독일어/포르투갈어/러시아어/아랍어는 그 언어 고유의
// 정렬 순서(가나다순/알파벳순 등)가 명확해서 화면에 보이는 이름 그대로 정렬해도 자연스럽습니다.
// 반면 일본어·중국어는 한자를 발음(가나/병음) 정보 없이 유니코드 순서로만 정렬하면
// 사용자에게 뒤죽박죽으로 보이므로, 이 두 언어는 영문명 기준으로 정렬합니다.
const NATIVE_SORT_LANGS = new Set(["ko", "en", "es", "fr", "de", "pt", "ru", "ar"]);

function displayName(country) {
  return country.names[uiLang] || country.names.en;
}

function compareByDisplayOrder(a, b) {
  if (NATIVE_SORT_LANGS.has(uiLang)) {
    return displayName(a).localeCompare(displayName(b), uiLang);
  }
  return a.names.en.localeCompare(b.names.en, "en");
}

async function loadCountries() {
  try {
    const res = await fetch("countries.json");
    if (!res.ok) throw new Error(`countries.json 로드 실패: ${res.status}`);
    countries = await res.json();
    applyFilters();
    renderRecent();
  } catch (err) {
    flagGrid.innerHTML = `<p class="no-results">국가 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>`;
    console.error(err);
  }
}

function render(list) {
  resultCount.textContent = `${list.length}개 국가`;

  if (list.length === 0) {
    flagGrid.innerHTML = `<p class="no-results">검색 결과가 없습니다.</p>`;
    return;
  }

  // 매번 새 DOM을 통째로 그리기보다 문서 조각(fragment)에 모아 한 번에 붙여서
  // 검색/필터를 바꿀 때마다 화면이 여러 번 다시 그려지는 걸(reflow) 줄입니다.
  const fragment = document.createDocumentFragment();

  for (const country of list) {
    const primaryName = displayName(country);
    const showEnglishSub = uiLang !== "en" && country.names.en !== primaryName;

    const card = document.createElement("div");
    card.className = "flag-card";
    card.dataset.code = country.code;

    const img = document.createElement("img");
    img.src = `flags-thumb/${country.code}.png`;
    img.alt = `${primaryName} 국기`;
    img.loading = "lazy";

    const nameMain = document.createElement("span");
    nameMain.className = "flag-name";
    nameMain.textContent = primaryName;

    const btnRow = document.createElement("div");
    btnRow.className = "download-btn-row";

    const pngBtn = document.createElement("button");
    pngBtn.className = "download-btn";
    pngBtn.type = "button";
    pngBtn.textContent = "PNG";
    pngBtn.setAttribute("aria-label", `${primaryName} PNG 다운로드`);
    pngBtn.addEventListener("click", () => downloadFlag(country, "png"));
    btnRow.appendChild(pngBtn);

    // SVG는 실제로 파일이 존재하는 국가에 한해서만 버튼을 보여줍니다.
    if (country.hasSvg) {
      const svgBtn = document.createElement("button");
      svgBtn.className = "download-btn download-btn-svg";
      svgBtn.type = "button";
      svgBtn.textContent = "SVG";
      svgBtn.setAttribute("aria-label", `${primaryName} SVG 다운로드`);
      svgBtn.addEventListener("click", () => downloadFlag(country, "svg"));
      btnRow.appendChild(svgBtn);
    }

    card.append(img, nameMain);

    if (showEnglishSub) {
      const nameSub = document.createElement("span");
      nameSub.className = "flag-name-en";
      nameSub.textContent = country.names.en;
      card.appendChild(nameSub);
    }

    card.appendChild(btnRow);
    fragment.appendChild(card);
  }

  flagGrid.innerHTML = "";
  flagGrid.appendChild(fragment);
}

function downloadFlag(country, format) {
  const slug = country.names.en.replace(/\s+/g, "-").toLowerCase();
  let src;
  if (format === "svg") {
    src = `flags-svg/${country.code}.svg`;
  } else {
    // 고해상도(w2560) 파일이 있으면 그걸, 없으면 썸네일로 대체 다운로드합니다.
    src = country.hasPng ? `flags-png/${country.code}.png` : `flags-thumb/${country.code}.png`;
  }

  const link = document.createElement("a");
  link.href = src;
  link.download = `${slug}-flag.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  recordRecent(country.code);
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
  recentExpanded = false;
  renderRecent();
}

function renderRecent() {
  const codes = loadRecentCodes();
  const byCode = new Map(countries.map((c) => [c.code, c]));
  const recentCountries = codes.map((code) => byCode.get(code)).filter(Boolean);

  if (recentCountries.length === 0) {
    recentSection.hidden = true;
    return;
  }

  recentSection.hidden = false;

  const fragment = document.createDocumentFragment();
  for (const country of recentCountries) {
    const name = displayName(country);

    const card = document.createElement("div");
    card.className = "recent-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${name} 국기, 목록에서 위치 보기`);

    const img = document.createElement("img");
    img.src = `flags-thumb/${country.code}.png`;
    img.alt = `${name} 국기`;
    img.loading = "lazy";

    const label = document.createElement("span");
    label.className = "recent-card-name";
    label.textContent = name;

    const open = () => jumpToCountry(country);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    card.append(img, label);
    fragment.appendChild(card);
  }

  recentGrid.innerHTML = "";
  recentGrid.appendChild(fragment);

  // 카드 1개 높이를 기준으로, 실제로 2줄 이상이 될 때만 접어서 "더보기" 버튼을 보여줍니다.
  // (뷰포트 너비마다 한 줄에 들어가는 카드 수가 달라지므로 고정 개수 대신 실측으로 판단합니다.)
  recentGrid.classList.remove("is-collapsed");
  recentToggle.hidden = true;
  recentToggle.textContent = "더보기 ▾";

  const firstCard = recentGrid.querySelector(".recent-card");
  if (firstCard && recentGrid.scrollHeight > firstCard.offsetHeight + 5) {
    recentGrid.style.setProperty("--recent-row-height", `${firstCard.offsetHeight}px`);
    if (!recentExpanded) {
      recentGrid.classList.add("is-collapsed");
    }
    recentToggle.hidden = false;
    recentToggle.textContent = recentExpanded ? "접기 ▴" : "더보기 ▾";
  }
}

recentToggle.addEventListener("click", () => {
  recentExpanded = !recentExpanded;
  recentGrid.classList.toggle("is-collapsed", !recentExpanded);
  recentToggle.textContent = recentExpanded ? "접기 ▴" : "더보기 ▾";
});

recentClear.addEventListener("click", () => {
  saveRecentCodes([]);
  recentExpanded = false;
  renderRecent();
});

function normalize(str) {
  return str.toLowerCase().trim();
}

function applyFilters() {
  const query = normalize(searchInput.value);

  let filtered = countries;

  if (activeRegion !== "all") {
    filtered = filtered.filter((c) => c.region === activeRegion);
  }

  if (query) {
    filtered = filtered.filter((c) =>
      // searchTerms에는 언어별 통칭+공식명칭에 더해, 나라마다 실제로 쓰이는 별칭
      // (예: 한국="한국"/"대한민국"/"남한", 일본="Nippon"/"Nihon")까지 포함되어 있어서
      // 화면 표시 언어와 상관없이 다양한 표기로 검색할 수 있습니다.
      c.searchTerms.some((term) => normalize(term).includes(query))
    );
  }

  filtered = [...filtered].sort(compareByDisplayOrder);

  render(filtered);
}

searchInput.addEventListener("input", applyFilters);

continentTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".continent-tab");
  if (!btn) return;

  activeRegion = btn.dataset.region;

  for (const tab of continentTabs.querySelectorAll(".continent-tab")) {
    const isActive = tab === btn;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  }

  applyFilters();
  scrollToElement(flagGrid);
});

function scrollToElement(el, extraOffset = 8) {
  // search-section이 sticky라 그 높이만큼 보정해서, 대상이 검색바에 가리지 않게 합니다.
  const stickyOffset = searchSection ? searchSection.offsetHeight : 0;
  const top = el.getBoundingClientRect().top + window.scrollY - stickyOffset - extraOffset;
  window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
}

function jumpToCountry(country) {
  // 검색어나 대륙 필터가 걸려있으면 그 나라가 목록에서 안 보일 수 있어서,
  // "내가 찾아본 국가"에서 누르면 항상 전체 목록으로 리셋한 뒤 찾아갑니다.
  searchInput.value = "";
  activeRegion = "all";
  for (const tab of continentTabs.querySelectorAll(".continent-tab")) {
    const isAll = tab.dataset.region === "all";
    tab.classList.toggle("is-active", isAll);
    tab.setAttribute("aria-selected", String(isAll));
  }
  applyFilters();

  // applyFilters()가 방금 새로 그린 DOM이 실제로 배치(layout)된 다음 프레임에
  // 위치를 계산해야 정확한 스크롤 좌표가 나옵니다.
  requestAnimationFrame(() => {
    const target = flagGrid.querySelector(`[data-code="${country.code}"]`);
    if (!target) return;

    scrollToElement(target, 24);

    // 연속으로 다른 나라를 클릭해도 매번 깜빡임이 새로 시작되도록, 클래스를 뗐다가
    // 강제로 리플로우(offsetWidth 읽기)시킨 뒤 다시 붙여서 CSS 애니메이션을 재시작합니다.
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

loadCountries();
