// 다국어 페이지 빌드 스크립트
// 1) {tool}/template.html (구조는 언어와 무관하게 동일)
// 2) {tool}/content.{lang}.json (언어별 텍스트)
// 이 두 가지를 조합해서 각 언어의 index.html을 ko/{tool}/, en/{tool}/ 에 정적으로 생성합니다.
// (한국어도 영어와 대칭으로 /ko/{tool}/ 경로를 씁니다. 예전에는 한국어만 /{tool}/에 있었는데,
// 이미 배포된 그 URL이 깨지지 않도록 /{tool}/index.html 자리에는 /ko/{tool}/로 안내하는
// 리다이렉트 스텁을 남겨둡니다 — buildRedirectStub() 참고.)
//
// script.js·style.css·countries.json 같은 실제 로직/데이터 파일은 전혀 건드리지 않고
// {tool}/ 폴더에 있는 걸 그대로 공유합니다. ko/{tool}/·en/{tool}/ 양쪽 다 <base href>를
// {tool}/로 가리키게 해서, script.js의 상대경로 fetch("countries.json") 같은 코드를
// 한 줄도 고치지 않고 그대로 재사용할 수 있게 했습니다.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_BASE = "https://getniftykit.com/";
const LANGS = ["ko", "en", "ja", "zh"];

const TOOLS = [
  "flag-master",
  "emoji-search",
  "special-char",
  "qr-code",
  "password-generator",
  "gradient-builder",
  "dday-counter",
  "interval-timer",
  "tempo-counter",
  "pomodoro-timer",
  "white-noise",
  "flashcards",
  "square-check",
  "stair-calc",
  "shelf-spacing",
  "clay-shrinkage",
  "kiln-loading",
  "image-converter",
  "vector-converter",
  "username-generator",
  "svg-cleaner",
];
const INFO_PAGES = ["privacy", "about"];

// 팀 정책(CLAUDE.md 0장): 새 도구는 PM이 번역을 요청하기 전까지 ko/en만 지원합니다.
// 여기 없는 도구는 기본값(LANGS, 4개 언어 전부)을 씁니다. ja/zh 번역이 준비되면
// 이 목록에서 해당 도구를 지우기만 하면(=기본값 LANGS를 쓰게 됨) 됩니다.
// ko/en만 지원하던 도구들이 ja/zh 번역까지 마쳐서(PM 요청, 2026-07) 이제 4개 언어
// 전부를 지원합니다. 다만 키 자체는 지우지 않고 LANGS와 동일한 값으로 남겨둡니다 —
// 이 도구들은 처음부터 대칭 구조로 시작해 예전 bare 경로(`/{tool}/`)가 존재한 적이
// 없으므로, 아래 buildTool()의 "TOOL_LANGS에 없는 도구만 리다이렉트 스텁 생성" 로직이
// 이 도구들에도 스텁을 잘못 만들지 않도록 하기 위함입니다.
const TOOL_LANGS = {
  "password-generator": LANGS,
  "gradient-builder": LANGS,
  "dday-counter": LANGS,
  "interval-timer": LANGS,
  "tempo-counter": LANGS,
  "pomodoro-timer": LANGS,
  "white-noise": LANGS,
  "flashcards": LANGS,
  "square-check": LANGS,
  "stair-calc": LANGS,
  "shelf-spacing": LANGS,
  "clay-shrinkage": LANGS,
  "kiln-loading": LANGS,
  "image-converter": LANGS,
  "vector-converter": LANGS,
  // PM 요청으로 ja/zh 번역 완료(2026-07) — 처음부터 대칭 구조로 시작해 예전 bare 경로가
  // 없으므로, 다른 4개 언어 도구들과 같은 이유로 키는 지우지 않고 LANGS로 남겨둡니다.
  "username-generator": LANGS,
  // PM 요청으로 ja/zh 번역 완료(2026-07). 처음부터 대칭 구조로 시작해 예전 bare 경로가
  // 없으므로 다른 도구들과 같은 이유로 키는 지우지 않고 LANGS로 남겨둡니다.
  "svg-cleaner": LANGS,
};

function langsFor(tool) {
  return TOOL_LANGS[tool] || LANGS;
}

// 이메일 대신 이 구글 폼을 유일한 문의 창구로 씁니다(정적 사이트라 서버로 받는 방식이 없음).
const GOOGLE_FORM_URL = "https://forms.gle/3NPQoMPL7oJo2pwV7";

// 모든 페이지 footer의 "개인정보 처리방침 · 소개" 링크 문구입니다. 도구마다 반복해서
// content.json에 넣지 않고 여기 한 곳에서만 관리합니다.
const FOOTER_LABELS = {
  ko: { privacy: "개인정보 처리방침", about: "소개" },
  en: { privacy: "Privacy Policy", about: "About" },
  ja: { privacy: "プライバシーポリシー", about: "概要" },
  zh: { privacy: "隐私政策", about: "关于" },
};

// 우하단 "맨 위로 이동" 버튼의 aria-label입니다. 모든 페이지(도구·대시보드·정보 페이지)에
// 공통으로 쓰이는 고정 UI 문구라 FOOTER_LABELS와 동일하게 여기 한 곳에서만 관리합니다.
const SCROLL_TOP_LABELS = {
  ko: "맨 위로 이동",
  en: "Scroll to top",
  ja: "トップに戻る",
  zh: "回到顶部",
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildFaqHtml(faq) {
  return faq
    .map(
      (item) => `        <div class="faq-item">
          <dt>${escapeHtml(item.q)}</dt>
          <dd>${escapeHtml(item.a)}</dd>
        </div>`
    )
    .join("\n");
}

function buildUseCasesHtml(items) {
  return items.map((item) => `        <li>${escapeHtml(item)}</li>`).join("\n");
}

// 템포 카운터의 운동 종류 <select> 옵션을 만듭니다. bpm이 있는 항목은 라벨 뒤에
// "(40 BPM)"처럼 기본 속도를 함께 보여주고, data-bpm 속성에 숫자를 담아둬서
// script.js가 선택 시 BPM 입력란에 그대로 채워 넣을 수 있게 합니다. bpm이 없는
// "직접 설정" 항목은 data-bpm 없이 라벨만 표시되고, 선택해도 BPM 값을 건드리지 않습니다.
function buildCategoryOptionsHtml(categories) {
  return categories
    .map((c) => {
      const label = escapeHtml(c.label);
      if (c.bpm == null) {
        return `          <option value="${escapeHtml(c.id)}">${label}</option>`;
      }
      return `          <option value="${escapeHtml(c.id)}" data-bpm="${c.bpm}">${label} (${c.bpm} BPM)</option>`;
    })
    .join("\n");
}

function buildSectionsHtml(sections) {
  return sections
    .map(
      (s) => `    <h2>${escapeHtml(s.heading)}</h2>
    <p>${escapeHtml(s.body)}</p>`
    )
    .join("\n\n");
}

function buildSoftwareAppJsonLd(content) {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: content.softwareAppName,
      applicationCategory: "UtilityApplication",
      operatingSystem: content.osLabel,
      description: content.softwareAppDescription,
      offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
    },
    null,
    2
  );
}

function buildFaqJsonLd(faq) {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
    null,
    2
  );
}

function buildHreflangLinks(tool) {
  // 언어별 hreflang은 검색엔진이 검색자의 로케일에 맞는 언어 버전을 그대로 보여주는 데
  // 쓰이므로 그대로 둡니다. x-default(로케일이 매칭되지 않는 방문자용 기본값)만
  // en으로 둡니다 — 특정 언어를 "메인 사이트"처럼 보이지 않게 하기 위함입니다.
  // 실제로 존재하는 언어만 나열합니다 — 아직 ja/zh가 없는 도구인데 hreflang에서
  // 존재하지 않는 URL을 가리키면 검색엔진에 잘못된 신호를 주게 됩니다.
  const defaultUrl = `${SITE_BASE}en/${tool}/`;
  const lines = langsFor(tool).map(
    (lang) => `  <link rel="alternate" hreflang="${lang}" href="${SITE_BASE}${lang}/${tool}/" />`
  );
  lines.push(`  <link rel="alternate" hreflang="x-default" href="${defaultUrl}" />`);
  return lines.join("\n");
}

// 예전에는 한국어 페이지가 /{tool}/에 있었습니다(대칭 구조로 바꾸기 전).
// 이미 그 URL로 검색엔진에 색인됐거나 누군가 북마크했을 수 있어서, 그 자리에는
// 실제 콘텐츠 대신 새 위치(/ko/{tool}/)로 즉시 안내하는 최소한의 정적 리다이렉트 페이지를
// 남겨둡니다. GitHub Pages는 서버 사이드 301 리다이렉트를 지원하지 않기 때문에,
// canonical 태그 + meta refresh + 사람이 볼 수 있는 링크 3중으로 처리했습니다.
function buildRedirectStub(absoluteUrl, relativeUrl, label, htmlLang = "ko") {
  // canonical은 스펙상 절대 URL을 씁니다(검색엔진용). meta refresh는 상대경로로 둬서
  // 로컬(python -m http.server)에서 열어도 실제 운영 도메인이 아니라 로컬의 새 경로로
  // 이동하도록 했습니다 — <base> 때와 같은 이유입니다.
  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(label)}</title>
  <link rel="canonical" href="${absoluteUrl}" />
  <meta http-equiv="refresh" content="0; url=${relativeUrl}" />
  <meta name="robots" content="noindex" />
</head>
<body>
  <p><a href="${relativeUrl}">${escapeHtml(label)}</a></p>
</body>
</html>
`;
}

// 루트 bare "/"는 도메인만 입력해 들어온 방문자를 위한 진입점입니다. 브라우저 언어
// (navigator.languages)를 감지해 지원하는 언어(LANGS)와 일치하면 그 언어로, 일치하는
// 언어가 없으면 중립 기본값인 /en/으로 보냅니다. GitHub Pages는 서버 사이드 리다이렉트가
// 없어 클라이언트 JS로 처리하며, JS가 꺼진 경우를 대비해 <noscript> 안에 정적
// meta refresh(→ /en/)를 백업으로 둡니다. 검색엔진에는 이 페이지 대신 hreflang이 걸린
// /{lang}/ 페이지가 각각 색인되므로 noindex를 유지합니다.
function buildLangDetectStub(enUrl, supportedLangs, label) {
  const langsJson = JSON.stringify(supportedLangs);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(label)}</title>
  <link rel="canonical" href="${enUrl}" />
  <meta name="robots" content="noindex" />
  <noscript><meta http-equiv="refresh" content="0; url=en/" /></noscript>
  <script>
    (function () {
      var supported = ${langsJson};
      var candidates = (navigator.languages && navigator.languages.length)
        ? navigator.languages
        : [navigator.language || navigator.userLanguage || "en"];
      var target = "en";
      for (var i = 0; i < candidates.length; i++) {
        var primary = String(candidates[i] || "").toLowerCase().split("-")[0];
        if (supported.indexOf(primary) !== -1) {
          target = primary;
          break;
        }
      }
      location.replace(target + "/");
    })();
  </script>
</head>
<body>
  <p><a href="en/">${escapeHtml(label)}</a></p>
</body>
</html>
`;
}

// 구글 애드센스 사이트 소유권 확인 스크립트입니다. 애드센스가 "사이트의 모든 페이지"의
// <head>에 넣으라고 요구하므로, 도구마다 template.html에 토큰을 추가하는 대신 모든 실제
// 콘텐츠 페이지가 공통으로 거치는 render() 한 곳에서 삽입합니다(대시보드/도구/privacy/about
// 22개 템플릿 전부가 "<head>"를 단독 줄로 갖고 있어 안전하게 매칭됩니다). bare "/" 같은
// 리다이렉트 스텁은 render()를 거치지 않으므로 이 스크립트가 들어가지 않는데, 실제 콘텐츠가
// 없이 즉시 다른 페이지로 넘어가는 페이지라 광고 승인 검토 대상이 아니라서 괜찮습니다.
const ADSENSE_SCRIPT =
  '  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1920319600070989" crossorigin="anonymous"></script>\n';

function render(template, tokens) {
  let out = template;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  const leftover = out.match(/{{[A-Z_]+}}/);
  if (leftover) {
    throw new Error(`템플릿에 채워지지 않은 토큰이 남았습니다: ${leftover[0]}`);
  }
  out = out.replace("<head>\n", `<head>\n${ADSENSE_SCRIPT}`);
  return out;
}

async function buildTool(tool) {
  const toolDir = path.join(ROOT, tool);
  const template = await fs.readFile(path.join(toolDir, "template.html"), "utf-8");

  for (const lang of langsFor(tool)) {
    const content = JSON.parse(
      await fs.readFile(path.join(toolDir, `content.${lang}.json`), "utf-8")
    );

    const canonicalUrl = `${SITE_BASE}${lang}/${tool}/`;
    // <base>는 절대 URL(운영 도메인)이 아니라 "현재 문서 기준 상대경로"로 씁니다.
    // 절대 URL로 쓰면 로컬(python -m http.server)에서 페이지를 열었을 때도
    // style.css·script.js·countries.json을 전부 실제 운영 사이트(namjanghyuk.github.io)에서
    // 받아오게 되어, 로컬에서 고친 내용이 아니라 배포된 옛 버전을 테스트하게 되는 문제가 있었습니다.
    // 상대경로는 로컬/운영 어디서 열든 "현재 문서 위치({lang}/{tool}/) 기준 두 단계 위 + {tool}/"로
    // 항상 올바르게 풀립니다. ko/en 둘 다 같은 깊이(lang/tool/)라 base 로직도 동일합니다.
    const baseTag = `  <base href="../../${tool}/" />\n`;

    // 뒤로가기(back-link)는 반드시 "이 페이지와 같은 언어"의 대시보드로 가야 합니다.
    // 하지만 위 <base>가 페이지의 모든 상대경로(뒤로가기 링크 포함)를 "{tool}/" 기준으로
    // 다시 계산해버리기 때문에, 그냥 href="../"만 쓰면 언어 정보가 사라지고 항상
    // 루트("/")로 가버리는 버그가 있었습니다(실사용 테스트로 발견). 그래서 "{tool}/"
    // 기준 상대경로로 각 언어 대시보드를 직접 가리키도록 계산합니다. 모든 언어의
    // 대시보드가 이제 /{lang}/에 대칭으로 있으므로(예전엔 한국어만 "/"에 있었음)
    // 언어별 예외 없이 동일한 공식을 씁니다.
    const backLinkHref = `../${lang}/`;

    const tokens = {
      HTML_LANG: content.htmlLang,
      PAGE_TITLE: escapeHtml(content.pageTitle),
      META_DESCRIPTION: escapeHtml(content.metaDescription),
      CANONICAL_URL: canonicalUrl,
      HREFLANG_LINKS: buildHreflangLinks(tool),
      BASE_TAG: baseTag,
      SOFTWAREAPP_JSONLD: buildSoftwareAppJsonLd(content),
      FAQ_JSONLD: buildFaqJsonLd(content.faq),
      BACK_LINK_HREF: backLinkHref,
      BACK_LINK_TEXT: escapeHtml(content.backLinkText),
      H1: escapeHtml(content.h1),
      SUBTITLE: escapeHtml(content.subtitle),
      TAGLINE_EXTRA: escapeHtml(content.taglineExtra),
      SEARCH_SECTION_ARIA: escapeHtml(content.searchSectionAria),
      SEARCH_PLACEHOLDER: escapeHtml(content.searchPlaceholder),
      FAQ_HEADING: escapeHtml(content.faqHeading),
      INFO_INTRO_H2: escapeHtml(content.infoIntroH2),
      INFO_INTRO_P: escapeHtml(content.infoIntroP),
      INFO_HOWTO_H2: escapeHtml(content.infoHowtoH2),
      INFO_HOWTO_P: escapeHtml(content.infoHowtoP),
      INFO_USECASES_H2: escapeHtml(content.infoUseCasesH2),
      INFO_USECASES_HTML: buildUseCasesHtml(content.infoUseCases),
      FAQ_HTML: buildFaqHtml(content.faq),
      PRIVACY_NOTE: escapeHtml(content.privacyNote),
      RECENT_SECTION_ARIA: escapeHtml(content.recentSectionAria),
      RECENT_SECTION_H2: escapeHtml(content.recentSectionH2),
      RECENT_CLEAR_TEXT: escapeHtml(content.recentClearText),
      FOOTER_PRIVACY_HREF: `${backLinkHref}privacy/`,
      FOOTER_PRIVACY_TEXT: escapeHtml(FOOTER_LABELS[lang].privacy),
      FOOTER_ABOUT_HREF: `${backLinkHref}about/`,
      FOOTER_ABOUT_TEXT: escapeHtml(FOOTER_LABELS[lang].about),
      SCROLL_TOP_ARIA: escapeHtml(SCROLL_TOP_LABELS[lang]),
    };

    if (tool === "flag-master") {
      Object.assign(tokens, {
        CONTINENT_TABS_ARIA: escapeHtml(content.continentTabsAria),
        FLAG_GRID_ARIA: escapeHtml(content.flagGridAria),
        TAB_ALL: escapeHtml(content.continentTabs.all),
        TAB_EUROPE: escapeHtml(content.continentTabs.europe),
        TAB_AMERICAS: escapeHtml(content.continentTabs.americas),
        TAB_ASIA: escapeHtml(content.continentTabs.asia),
        TAB_AFRICA: escapeHtml(content.continentTabs.africa),
        TAB_OCEANIA: escapeHtml(content.continentTabs.oceania),
        TAB_OTHER: escapeHtml(content.continentTabs.other),
      });
    }

    if (tool === "emoji-search") {
      Object.assign(tokens, {
        CATEGORY_TABS_ARIA: escapeHtml(content.categoryTabsAria),
        EMOJI_GRID_ARIA: escapeHtml(content.emojiGridAria),
        TAB_ALL: escapeHtml(content.tabAll),
      });
    }

    if (tool === "special-char") {
      Object.assign(tokens, {
        CATEGORY_TABS_ARIA: escapeHtml(content.categoryTabsAria),
        CHAR_GRID_ARIA: escapeHtml(content.charGridAria),
        TAB_ALL: escapeHtml(content.tabAll),
      });
    }

    if (tool === "qr-code") {
      Object.assign(tokens, {
        INPUT_SECTION_ARIA: escapeHtml(content.inputSectionAria),
        INPUT_LABEL: escapeHtml(content.inputLabel),
        INPUT_PLACEHOLDER: escapeHtml(content.inputPlaceholder),
        PREVIEW_SECTION_ARIA: escapeHtml(content.previewSectionAria),
        // 아직 ko/en만 번역된 필드라, 없는 언어에서는 "undefined" 글자가 그대로
        // 찍히지 않도록 빈 문자열로 대체합니다(번역 자체는 요청 시 별도 진행).
        DESIGN_SECTION_ARIA: escapeHtml(content.designSectionAria || ""),
        DESIGN_TOGGLE_TEXT: escapeHtml(content.designToggleText || ""),
        DESIGN_COLOR_LABEL: escapeHtml(content.designColorLabel || ""),
        DESIGN_BG_LABEL: escapeHtml(content.designBgLabel || ""),
        DESIGN_MARGIN_LABEL: escapeHtml(content.designMarginLabel || ""),
        DESIGN_BORDER_ENABLED_LABEL: escapeHtml(content.designBorderEnabledLabel || ""),
        DESIGN_BORDER_WIDTH_LABEL: escapeHtml(content.designBorderWidthLabel || ""),
        DESIGN_BORDER_COLOR_LABEL: escapeHtml(content.designBorderColorLabel || ""),
        DESIGN_RESET_TEXT: escapeHtml(content.designResetText || ""),
      });
    }

    if (tool === "password-generator") {
      Object.assign(tokens, {
        PW_DISPLAY_ARIA: escapeHtml(content.pwDisplayAria),
        PW_OPTIONS_ARIA: escapeHtml(content.pwOptionsAria),
        LENGTH_LABEL: escapeHtml(content.lengthLabel),
        UPPER_LABEL: escapeHtml(content.upperLabel),
        LOWER_LABEL: escapeHtml(content.lowerLabel),
        NUMBERS_LABEL: escapeHtml(content.numbersLabel),
        SYMBOLS_LABEL: escapeHtml(content.symbolsLabel),
        GENERATE_BTN_TEXT: escapeHtml(content.generateBtnText),
        COPY_BTN_TEXT: escapeHtml(content.copyBtnText),
        COPIED_TEXT: escapeHtml(content.copiedText),
        STRENGTH_WEAK: escapeHtml(content.strengthWeak),
        STRENGTH_MEDIUM: escapeHtml(content.strengthMedium),
        STRENGTH_STRONG: escapeHtml(content.strengthStrong),
        STRENGTH_VERY_STRONG: escapeHtml(content.strengthVeryStrong),
        NO_CHARSET_ERROR: escapeHtml(content.noCharsetError),
      });
    }

    if (tool === "gradient-builder") {
      Object.assign(tokens, {
        PREVIEW_ARIA: escapeHtml(content.previewAria),
        CODE_ARIA: escapeHtml(content.codeAria),
        TYPE_LABEL: escapeHtml(content.typeLabel),
        TYPE_LINEAR: escapeHtml(content.typeLinear),
        TYPE_RADIAL: escapeHtml(content.typeRadial),
        ANGLE_LABEL: escapeHtml(content.angleLabel),
        STOPS_LABEL: escapeHtml(content.stopsLabel),
        ADD_STOP_BTN_TEXT: escapeHtml(content.addStopBtnText),
        REMOVE_STOP_BTN_TEXT: escapeHtml(content.removeStopBtnText),
        COPY_BTN_TEXT: escapeHtml(content.copyBtnText),
        COPIED_TEXT: escapeHtml(content.copiedText),
        MAX_STOPS_ERROR: escapeHtml(content.maxStopsError),
        MIN_STOPS_ERROR: escapeHtml(content.minStopsError),
      });
    }

    if (tool === "dday-counter") {
      Object.assign(tokens, {
        FORM_ARIA: escapeHtml(content.formAria),
        LIST_ARIA: escapeHtml(content.listAria),
        NAME_LABEL: escapeHtml(content.nameLabel),
        NAME_PLACEHOLDER: escapeHtml(content.namePlaceholder),
        DATE_LABEL: escapeHtml(content.dateLabel),
        DATE_PLACEHOLDER: escapeHtml(content.datePlaceholder),
        PREV_MONTH_LABEL: escapeHtml(content.prevMonthLabel),
        NEXT_MONTH_LABEL: escapeHtml(content.nextMonthLabel),
        ADD_BTN_TEXT: escapeHtml(content.addBtnText),
        DELETE_BTN_TEXT: escapeHtml(content.deleteBtnText),
        EMPTY_MESSAGE: escapeHtml(content.emptyMessage),
        TODAY_LABEL: escapeHtml(content.todayLabel),
        NAME_REQUIRED_ERROR: escapeHtml(content.nameRequiredError),
        DATE_REQUIRED_ERROR: escapeHtml(content.dateRequiredError),
      });
    }

    if (tool === "interval-timer") {
      Object.assign(tokens, {
        SETUP_ARIA: escapeHtml(content.setupAria),
        DISPLAY_ARIA: escapeHtml(content.displayAria),
        SETS_LABEL: escapeHtml(content.setsLabel),
        WORK_LABEL: escapeHtml(content.workLabel),
        REST_LABEL: escapeHtml(content.restLabel),
        START_BTN_TEXT: escapeHtml(content.startBtnText),
        PAUSE_BTN_TEXT: escapeHtml(content.pauseBtnText),
        RESUME_BTN_TEXT: escapeHtml(content.resumeBtnText),
        RESET_BTN_TEXT: escapeHtml(content.resetBtnText),
        WORK_PHASE_LABEL: escapeHtml(content.workPhaseLabel),
        REST_PHASE_LABEL: escapeHtml(content.restPhaseLabel),
        READY_LABEL: escapeHtml(content.readyLabel),
        DONE_LABEL: escapeHtml(content.doneLabel),
        SET_PROGRESS_TEMPLATE: escapeHtml(content.setProgressTemplate),
        INVALID_INPUT_ERROR: escapeHtml(content.invalidInputError),
      });
    }

    if (tool === "tempo-counter") {
      Object.assign(tokens, {
        SETUP_ARIA: escapeHtml(content.setupAria),
        DISPLAY_ARIA: escapeHtml(content.displayAria),
        CATEGORY_LABEL: escapeHtml(content.categoryLabel),
        CATEGORY_OPTIONS_HTML: buildCategoryOptionsHtml(content.categories),
        BPM_LABEL: escapeHtml(content.bpmLabel),
        START_BTN_TEXT: escapeHtml(content.startBtnText),
        STOP_BTN_TEXT: escapeHtml(content.stopBtnText),
        REP_LABEL: escapeHtml(content.repLabel),
        DOWN_PHASE_LABEL: escapeHtml(content.downPhaseLabel),
        UP_PHASE_LABEL: escapeHtml(content.upPhaseLabel),
        READY_LABEL: escapeHtml(content.readyLabel),
        INVALID_BPM_ERROR: escapeHtml(content.invalidBpmError),
      });
    }

    if (tool === "pomodoro-timer") {
      Object.assign(tokens, {
        SETUP_ARIA: escapeHtml(content.setupAria),
        DISPLAY_ARIA: escapeHtml(content.displayAria),
        WORK_LABEL: escapeHtml(content.workLabel),
        SHORT_BREAK_LABEL: escapeHtml(content.shortBreakLabel),
        LONG_BREAK_LABEL: escapeHtml(content.longBreakLabel),
        CYCLES_LABEL: escapeHtml(content.cyclesLabel),
        UNIT_HOUR_LABEL: escapeHtml(content.unitHourLabel),
        UNIT_MINUTE_LABEL: escapeHtml(content.unitMinuteLabel),
        UNIT_SECOND_LABEL: escapeHtml(content.unitSecondLabel),
        START_BTN_TEXT: escapeHtml(content.startBtnText),
        PAUSE_BTN_TEXT: escapeHtml(content.pauseBtnText),
        RESUME_BTN_TEXT: escapeHtml(content.resumeBtnText),
        RESET_BTN_TEXT: escapeHtml(content.resetBtnText),
        FOCUS_PHASE_LABEL: escapeHtml(content.focusPhaseLabel),
        SHORT_BREAK_PHASE_LABEL: escapeHtml(content.shortBreakPhaseLabel),
        LONG_BREAK_PHASE_LABEL: escapeHtml(content.longBreakPhaseLabel),
        READY_LABEL: escapeHtml(content.readyLabel),
        SET_PROGRESS_TEMPLATE: escapeHtml(content.setProgressTemplate),
        COMPLETED_LABEL: escapeHtml(content.completedLabel),
        INVALID_INPUT_ERROR: escapeHtml(content.invalidInputError),
        NOTIFY_FOCUS_START_TITLE: escapeHtml(content.notifyFocusStartTitle),
        NOTIFY_FOCUS_START_BODY: escapeHtml(content.notifyFocusStartBody),
        NOTIFY_SHORT_BREAK_START_TITLE: escapeHtml(content.notifyShortBreakStartTitle),
        NOTIFY_SHORT_BREAK_START_BODY: escapeHtml(content.notifyShortBreakStartBody),
        NOTIFY_LONG_BREAK_START_TITLE: escapeHtml(content.notifyLongBreakStartTitle),
        NOTIFY_LONG_BREAK_START_BODY: escapeHtml(content.notifyLongBreakStartBody),
      });
    }

    if (tool === "white-noise") {
      Object.assign(tokens, {
        DISPLAY_ARIA: escapeHtml(content.displayAria),
        SETUP_ARIA: escapeHtml(content.setupAria),
        NOISE_TYPE_LABEL: escapeHtml(content.noiseTypeLabel),
        WHITE_NOISE_LABEL: escapeHtml(content.whiteNoiseLabel),
        PINK_NOISE_LABEL: escapeHtml(content.pinkNoiseLabel),
        BROWN_NOISE_LABEL: escapeHtml(content.brownNoiseLabel),
        VOLUME_LABEL: escapeHtml(content.volumeLabel),
        AUTO_STOP_LABEL: escapeHtml(content.autoStopLabel),
        AUTO_STOP_OFF_LABEL: escapeHtml(content.autoStopOffLabel),
        AUTO_STOP_OPTION_15: escapeHtml(content.autoStopOption15),
        AUTO_STOP_OPTION_30: escapeHtml(content.autoStopOption30),
        AUTO_STOP_OPTION_45: escapeHtml(content.autoStopOption45),
        AUTO_STOP_OPTION_60: escapeHtml(content.autoStopOption60),
        PLAY_BTN_TEXT: escapeHtml(content.playBtnText),
        STOP_BTN_TEXT: escapeHtml(content.stopBtnText),
        STATUS_READY_LABEL: escapeHtml(content.statusReadyLabel),
        STATUS_PLAYING_LABEL: escapeHtml(content.statusPlayingLabel),
        REMAINING_TEMPLATE: escapeHtml(content.remainingTemplate),
      });
    }

    if (tool === "flashcards") {
      Object.assign(tokens, {
        STUDY_ARIA: escapeHtml(content.studyAria),
        MANAGE_ARIA: escapeHtml(content.manageAria),
        QUESTION_LABEL: escapeHtml(content.questionLabel),
        QUESTION_PLACEHOLDER: escapeHtml(content.questionPlaceholder),
        ANSWER_LABEL: escapeHtml(content.answerLabel),
        ANSWER_PLACEHOLDER: escapeHtml(content.answerPlaceholder),
        ADD_BTN_TEXT: escapeHtml(content.addBtnText),
        DELETE_BTN_TEXT: escapeHtml(content.deleteBtnText),
        SHUFFLE_BTN_TEXT: escapeHtml(content.shuffleBtnText),
        PREV_BTN_TEXT: escapeHtml(content.prevBtnText),
        NEXT_BTN_TEXT: escapeHtml(content.nextBtnText),
        FLIP_HINT_TEXT: escapeHtml(content.flipHintText),
        PROGRESS_TEMPLATE: escapeHtml(content.progressTemplate),
        CARD_LIST_HEADING_TEMPLATE: escapeHtml(content.cardListHeadingTemplate),
        EMPTY_STUDY_MESSAGE: escapeHtml(content.emptyStudyMessage),
        EMPTY_LIST_MESSAGE: escapeHtml(content.emptyListMessage),
        QUESTION_REQUIRED_ERROR: escapeHtml(content.questionRequiredError),
        ANSWER_REQUIRED_ERROR: escapeHtml(content.answerRequiredError),
      });
    }

    if (tool === "square-check") {
      Object.assign(tokens, {
        SETUP_ARIA: escapeHtml(content.setupAria),
        RESULT_ARIA: escapeHtml(content.resultAria),
        VERIFY_ARIA: escapeHtml(content.verifyAria),
        SETUP_INTRO: escapeHtml(content.setupIntro),
        SIDE_A_LABEL: escapeHtml(content.sideALabel),
        SIDE_A_PLACEHOLDER: escapeHtml(content.sideAPlaceholder),
        SIDE_B_LABEL: escapeHtml(content.sideBLabel),
        SIDE_B_PLACEHOLDER: escapeHtml(content.sideBPlaceholder),
        HYPOTENUSE_LABEL: escapeHtml(content.hypotenuseLabel),
        HYPOTENUSE_PLACEHOLDER: escapeHtml(content.hypotenusePlaceholder),
        RESET_BTN_TEXT: escapeHtml(content.resetBtnText),
        INVALID_NUMBER_ERROR: escapeHtml(content.invalidNumberError),
        INVALID_TRIANGLE_ERROR: escapeHtml(content.invalidTriangleError),
        VERIFY_HEADING: escapeHtml(content.verifyHeading),
        VERIFY_INTRO: escapeHtml(content.verifyIntro),
        ACTUAL_DIAGONAL_LABEL: escapeHtml(content.actualDiagonalLabel),
        ACTUAL_DIAGONAL_PLACEHOLDER: escapeHtml(content.actualDiagonalPlaceholder),
        VERIFY_PASS_TEMPLATE: escapeHtml(content.verifyPassTemplate),
        VERIFY_FAIL_TEMPLATE: escapeHtml(content.verifyFailTemplate),
        INVALID_ACTUAL_DIAGONAL_ERROR: escapeHtml(content.invalidActualDiagonalError),
        VERIFY_NEEDS_HYPOTENUSE_MESSAGE: escapeHtml(content.verifyNeedsHypotenuseMessage),
        DIAGRAM_ARIA_LABEL: escapeHtml(content.diagramAriaLabel),
      });
    }

    if (tool === "stair-calc") {
      Object.assign(tokens, {
        SETUP_ARIA: escapeHtml(content.setupAria),
        RESULT_ARIA: escapeHtml(content.resultAria),
        FLOOR_HEIGHT_LABEL: escapeHtml(content.floorHeightLabel),
        FLOOR_HEIGHT_UNIT: escapeHtml(content.floorHeightUnit),
        FLOOR_HEIGHT_PLACEHOLDER: escapeHtml(content.floorHeightPlaceholder),
        INVALID_HEIGHT_ERROR: escapeHtml(content.invalidHeightError),
        RESULT_STEPS_LABEL: escapeHtml(content.resultStepsLabel),
        RESULT_STEPS_UNIT: escapeHtml(content.resultStepsUnit),
        RESULT_RISER_LABEL: escapeHtml(content.resultRiserLabel),
        RESULT_TREAD_LABEL: escapeHtml(content.resultTreadLabel),
        RESULT_RUN_LABEL: escapeHtml(content.resultRunLabel),
        RISER_WARNING: escapeHtml(content.riserWarning),
        TREAD_WARNING: escapeHtml(content.treadWarning),
        DIAGRAM_ARIA_LABEL: escapeHtml(content.diagramAriaLabel),
        DISCLAIMER_TEXT: escapeHtml(content.disclaimerText),
      });
    }

    if (tool === "shelf-spacing") {
      Object.assign(tokens, {
        SETUP_ARIA: escapeHtml(content.setupAria),
        RESULT_ARIA: escapeHtml(content.resultAria),
        POSITIONS_ARIA: escapeHtml(content.positionsAria),
        TOTAL_LENGTH_LABEL: escapeHtml(content.totalLengthLabel),
        TOTAL_LENGTH_UNIT: escapeHtml(content.totalLengthUnit),
        TOTAL_LENGTH_PLACEHOLDER: escapeHtml(content.totalLengthPlaceholder),
        SHELF_COUNT_LABEL: escapeHtml(content.shelfCountLabel),
        SHELF_COUNT_PLACEHOLDER: escapeHtml(content.shelfCountPlaceholder),
        SHELF_THICKNESS_LABEL: escapeHtml(content.shelfThicknessLabel),
        SHELF_THICKNESS_PLACEHOLDER: escapeHtml(content.shelfThicknessPlaceholder),
        INVALID_INPUT_ERROR: escapeHtml(content.invalidInputError),
        INVALID_FIT_ERROR: escapeHtml(content.invalidFitError),
        RESULT_GAP_LABEL: escapeHtml(content.resultGapLabel),
        RESULT_COMPARTMENTS_LABEL: escapeHtml(content.resultCompartmentsLabel),
        RESULT_COMPARTMENTS_UNIT: escapeHtml(content.resultCompartmentsUnit),
        NARROW_GAP_WARNING: escapeHtml(content.narrowGapWarning),
        DIAGRAM_ARIA_LABEL: escapeHtml(content.diagramAriaLabel),
        POSITIONS_HEADING: escapeHtml(content.positionsHeading),
        POSITION_TEMPLATE: escapeHtml(content.positionTemplate),
        DISCLAIMER_TEXT: escapeHtml(content.disclaimerText),
      });
    }

    if (tool === "clay-shrinkage") {
      Object.assign(tokens, {
        SETUP_ARIA: escapeHtml(content.setupAria),
        DIMENSIONS_ARIA: escapeHtml(content.dimensionsAria),
        RESULT_ARIA: escapeHtml(content.resultAria),
        SHRINKAGE_LABEL: escapeHtml(content.shrinkageLabel),
        SHRINKAGE_PLACEHOLDER: escapeHtml(content.shrinkagePlaceholder),
        PRESET_LABEL: escapeHtml(content.presetLabel),
        PRESET_1: escapeHtml(content.preset1),
        PRESET_2: escapeHtml(content.preset2),
        PRESET_3: escapeHtml(content.preset3),
        PRESET_4: escapeHtml(content.preset4),
        INVALID_SHRINKAGE_ERROR: escapeHtml(content.invalidShrinkageError),
        HIGH_SHRINKAGE_WARNING: escapeHtml(content.highShrinkageWarning),
        BISQUE_HEADING: escapeHtml(content.bisqueHeading),
        FINAL_HEADING: escapeHtml(content.finalHeading),
        WIDTH_LABEL: escapeHtml(content.widthLabel),
        WIDTH_PLACEHOLDER: escapeHtml(content.widthPlaceholder),
        DEPTH_LABEL: escapeHtml(content.depthLabel),
        DEPTH_PLACEHOLDER: escapeHtml(content.depthPlaceholder),
        HEIGHT_LABEL: escapeHtml(content.heightLabel),
        HEIGHT_PLACEHOLDER: escapeHtml(content.heightPlaceholder),
        DIMENSION_UNIT: escapeHtml(content.dimensionUnit),
        INVALID_DIMENSION_ERROR: escapeHtml(content.invalidDimensionError),
        DIAGRAM_ARIA_LABEL: escapeHtml(content.diagramAriaLabel),
        DIAGRAM_BISQUE_LABEL: escapeHtml(content.diagramBisqueLabel),
        DIAGRAM_FINAL_LABEL: escapeHtml(content.diagramFinalLabel),
        DIAGRAM_DEPTH_TEMPLATE: escapeHtml(content.diagramDepthTemplate),
        DIAGRAM_HINT: escapeHtml(content.diagramHint),
        DISCLAIMER_TEXT: escapeHtml(content.disclaimerText),
      });
    }

    if (tool === "kiln-loading") {
      Object.assign(tokens, {
        KILN_SIZE_ARIA: escapeHtml(content.kilnSizeAria),
        SHELF_SIZE_ARIA: escapeHtml(content.shelfSizeAria),
        PIECE_SHAPE_ARIA: escapeHtml(content.pieceShapeAria),
        SPACING_ARIA: escapeHtml(content.spacingAria),
        RESULT_ARIA: escapeHtml(content.resultAria),
        KILN_SIZE_HEADING: escapeHtml(content.kilnSizeHeading),
        SHELF_SIZE_HEADING: escapeHtml(content.shelfSizeHeading),
        PIECE_SHAPE_HEADING: escapeHtml(content.pieceShapeHeading),
        SPACING_HEADING: escapeHtml(content.spacingHeading),
        WIDTH_LABEL: escapeHtml(content.widthLabel),
        DEPTH_LABEL: escapeHtml(content.depthLabel),
        HEIGHT_LABEL: escapeHtml(content.heightLabel),
        THICKNESS_LABEL: escapeHtml(content.thicknessLabel),
        DIMENSION_UNIT: escapeHtml(content.dimensionUnit),
        SHAPE_ROUND_LABEL: escapeHtml(content.shapeRoundLabel),
        SHAPE_SQUARE_LABEL: escapeHtml(content.shapeSquareLabel),
        SHAPE_RECT_LABEL: escapeHtml(content.shapeRectLabel),
        DIAMETER_LABEL: escapeHtml(content.diameterLabel),
        SIDE_LENGTH_LABEL: escapeHtml(content.sideLengthLabel),
        SIDE_LENGTH_PLACEHOLDER: escapeHtml(content.sideLengthPlaceholder),
        PIECE_GAP_LABEL: escapeHtml(content.pieceGapLabel),
        EDGE_MARGIN_LABEL: escapeHtml(content.edgeMarginLabel),
        CLEARANCE_LABEL: escapeHtml(content.clearanceLabel),
        WIDTH_PLACEHOLDER: escapeHtml(content.widthPlaceholder),
        DEPTH_PLACEHOLDER: escapeHtml(content.depthPlaceholder),
        HEIGHT_PLACEHOLDER: escapeHtml(content.heightPlaceholder),
        THICKNESS_PLACEHOLDER: escapeHtml(content.thicknessPlaceholder),
        DIAMETER_PLACEHOLDER: escapeHtml(content.diameterPlaceholder),
        PIECE_HEIGHT_PLACEHOLDER: escapeHtml(content.pieceHeightPlaceholder),
        PIECE_WIDTH_PLACEHOLDER: escapeHtml(content.pieceWidthPlaceholder),
        PIECE_DEPTH_PLACEHOLDER: escapeHtml(content.pieceDepthPlaceholder),
        INVALID_INPUT_ERROR: escapeHtml(content.invalidInputError),
        SHELF_TOO_BIG_ERROR: escapeHtml(content.shelfTooBigError),
        NO_FIT_ERROR: escapeHtml(content.noFitError),
        KILN_TOO_SHORT_ERROR: escapeHtml(content.kilnTooShortError),
        RESULT_BOARDS_PER_LAYER_LABEL: escapeHtml(content.resultBoardsPerLayerLabel),
        RESULT_BOARDS_PER_LAYER_TEMPLATE: escapeHtml(content.resultBoardsPerLayerTemplate),
        RESULT_PER_SHELF_LABEL: escapeHtml(content.resultPerShelfLabel),
        RESULT_GRID_TEMPLATE: escapeHtml(content.resultGridTemplate),
        RESULT_SHELVES_LABEL: escapeHtml(content.resultShelvesLabel),
        RESULT_SHELVES_UNIT: escapeHtml(content.resultShelvesUnit),
        RESULT_TOTAL_BOARDS_LABEL: escapeHtml(content.resultTotalBoardsLabel),
        RESULT_TOTAL_BOARDS_UNIT: escapeHtml(content.resultTotalBoardsUnit),
        RESULT_TOTAL_LABEL: escapeHtml(content.resultTotalLabel),
        RESULT_TOTAL_UNIT: escapeHtml(content.resultTotalUnit),
        TOP_VIEW_LABEL: escapeHtml(content.topViewLabel),
        SIDE_VIEW_LABEL: escapeHtml(content.sideViewLabel),
        DIAGRAM_ARIA_LABEL: escapeHtml(content.diagramAriaLabel),
        DIAGRAM_KILN_SIZE_TEMPLATE: escapeHtml(content.diagramKilnSizeTemplate),
        DIAGRAM_SHELF_SIZE_TEMPLATE: escapeHtml(content.diagramShelfSizeTemplate),
        DIAGRAM_PIECE_ROUND_TEMPLATE: escapeHtml(content.diagramPieceRoundTemplate),
        DIAGRAM_PIECE_SQUARE_TEMPLATE: escapeHtml(content.diagramPieceSquareTemplate),
        DIAGRAM_PIECE_RECT_TEMPLATE: escapeHtml(content.diagramPieceRectTemplate),
        DIAGRAM_HEIGHT_TEMPLATE: escapeHtml(content.diagramHeightTemplate),
        DIAGRAM_BOARDS_PER_LAYER_TEMPLATE: escapeHtml(content.diagramBoardsPerLayerTemplate),
        DISCLAIMER_TEXT: escapeHtml(content.disclaimerText),
      });
    }

    if (tool === "image-converter") {
      Object.assign(tokens, {
        UPLOAD_ARIA: escapeHtml(content.uploadAria),
        DROPZONE_TEXT: escapeHtml(content.dropzoneText),
        DROPZONE_HINT: escapeHtml(content.dropzoneHint),
        CHOOSE_FILE_BTN_TEXT: escapeHtml(content.chooseFileBtnText),
        FILE_LIST_ARIA: escapeHtml(content.fileListAria),
        FILE_COUNT_TEMPLATE: escapeHtml(content.fileCountTemplate),
        FORMAT_PNG_LABEL: escapeHtml(content.formatPngLabel),
        FORMAT_JPG_LABEL: escapeHtml(content.formatJpgLabel),
        FORMAT_WEBP_LABEL: escapeHtml(content.formatWebpLabel),
        SAME_FORMAT_HINT: escapeHtml(content.sameFormatHint),
        SAVE_BTN_TEXT: escapeHtml(content.saveBtnText),
        REMOVE_BTN_TEXT: escapeHtml(content.removeBtnText),
        CLEAR_ALL_BTN_TEXT: escapeHtml(content.clearAllBtnText),
        CONVERTING_TEXT: escapeHtml(content.convertingText),
        SIZE_CHANGE_TEMPLATE: escapeHtml(content.sizeChangeTemplate),
        UNSUPPORTED_FILE_ERROR: escapeHtml(content.unsupportedFileError),
        DECODE_ERROR_TEXT: escapeHtml(content.decodeErrorText),
        SCALE_OPTION_LABEL: escapeHtml(content.scaleOptionLabel),
        QUALITY_OPTION_LABEL: escapeHtml(content.qualityOptionLabel),
        QUALITY_OPTION_HINT: escapeHtml(content.qualityOptionHint),
        ORIGINAL_SIZE_LABEL: escapeHtml(content.originalSizeLabel),
      });
    }

    if (tool === "svg-cleaner") {
      Object.assign(tokens, {
        UPLOAD_ARIA: escapeHtml(content.uploadAria),
        DROPZONE_TEXT: escapeHtml(content.dropzoneText),
        DROPZONE_HINT: escapeHtml(content.dropzoneHint),
        CHOOSE_FILE_BTN_TEXT: escapeHtml(content.chooseFileBtnText),
        FILE_LIST_ARIA: escapeHtml(content.fileListAria),
        FILE_COUNT_TEMPLATE: escapeHtml(content.fileCountTemplate),
        SAVE_BTN_TEXT: escapeHtml(content.saveBtnText),
        REMOVE_BTN_TEXT: escapeHtml(content.removeBtnText),
        CLEAR_ALL_BTN_TEXT: escapeHtml(content.clearAllBtnText),
        SIZE_CHANGE_TEMPLATE: escapeHtml(content.sizeChangeTemplate),
        UNSUPPORTED_FILE_ERROR: escapeHtml(content.unsupportedFileError),
        INVALID_SVG_ERROR: escapeHtml(content.invalidSvgError),
        ALREADY_CLEAN_TEXT: escapeHtml(content.alreadyCleanText),
        REMOVED_LABEL: escapeHtml(content.removedLabel),
        REMOVED_XML_DECL: escapeHtml(content.removedXmlDecl),
        REMOVED_DOCTYPE: escapeHtml(content.removedDoctype),
        REMOVED_COMMENTS: escapeHtml(content.removedComments),
        VIEW_CODE_BTN_TEXT: escapeHtml(content.viewCodeBtnText),
        HIDE_CODE_BTN_TEXT: escapeHtml(content.hideCodeBtnText),
        CODE_AREA_LABEL: escapeHtml(content.codeAreaLabel),
        CODE_COPY_BTN_TEXT: escapeHtml(content.codeCopyBtnText),
        CODE_COPIED_TEXT: escapeHtml(content.codeCopiedText),
        PASTE_TOGGLE_TEXT: escapeHtml(content.pasteToggleText),
        PASTE_INPUT_LABEL: escapeHtml(content.pasteInputLabel),
        PASTE_INPUT_PLACEHOLDER: escapeHtml(content.pasteInputPlaceholder),
        PASTE_CLEAN_BTN_TEXT: escapeHtml(content.pasteCleanBtnText),
        PASTE_OUTPUT_LABEL: escapeHtml(content.pasteOutputLabel),
        PASTE_COPY_BTN_TEXT: escapeHtml(content.pasteCopyBtnText),
        PASTE_COPIED_TEXT: escapeHtml(content.pasteCopiedText),
        PASTE_EMPTY_ERROR: escapeHtml(content.pasteEmptyError),
        PASTE_INVALID_ERROR: escapeHtml(content.pasteInvalidError),
      });
    }

    if (tool === "vector-converter") {
      Object.assign(tokens, {
        UPLOAD_ARIA: escapeHtml(content.uploadAria),
        DROPZONE_TEXT: escapeHtml(content.dropzoneText),
        DROPZONE_HINT: escapeHtml(content.dropzoneHint),
        CHOOSE_FILE_BTN_TEXT: escapeHtml(content.chooseFileBtnText),
        RESULT_SECTION_ARIA: escapeHtml(content.resultSectionAria),
        CONVERTING_TEXT: escapeHtml(content.convertingText),
        DETAIL_SETTING_LABEL: escapeHtml(content.detailSettingLabel),
        DETAIL_SETTING_HINT: escapeHtml(content.detailSettingHint),
        DETAIL_LOW: escapeHtml(content.detailLow),
        DETAIL_HIGH: escapeHtml(content.detailHigh),
        ORIGINAL_LABEL: escapeHtml(content.originalLabel),
        RESULT_LABEL: escapeHtml(content.resultLabel),
        DOWNLOAD_BTN_TEXT: escapeHtml(content.downloadBtnText),
        CONVERT_ANOTHER_BTN_TEXT: escapeHtml(content.convertAnotherBtnText),
        FILE_SIZE_TEMPLATE: escapeHtml(content.fileSizeTemplate),
        SVG_SIZE_TEMPLATE: escapeHtml(content.svgSizeTemplate),
        UNSUPPORTED_FILE_ERROR: escapeHtml(content.unsupportedFileError),
        DECODE_ERROR_TEXT: escapeHtml(content.decodeErrorText),
        CONVERSION_ERROR_TEXT: escapeHtml(content.conversionErrorText),
        ENGINE_LOAD_ERROR_TEXT: escapeHtml(content.engineLoadErrorText),
        TOO_LARGE_WARNING: escapeHtml(content.tooLargeWarning),
      });
    }

    if (tool === "username-generator") {
      Object.assign(tokens, {
        RESULT_SECTION_ARIA: escapeHtml(content.resultSectionAria),
        OPTIONS_SECTION_ARIA: escapeHtml(content.optionsSectionAria),
        PATTERN_LABEL: escapeHtml(content.patternLabel),
        PATTERN_ADJ2NOUN1_OPTION: escapeHtml(content.patternAdj2Noun1Option),
        PATTERN_ADJ1NOUN2_OPTION: escapeHtml(content.patternAdj1Noun2Option),
        PATTERN_ADJ3_OPTION: escapeHtml(content.patternAdj3Option),
        PATTERN_NOUN3_OPTION: escapeHtml(content.patternNoun3Option),
        SEPARATOR_LABEL: escapeHtml(content.separatorLabel),
        SEPARATOR_NONE_OPTION: escapeHtml(content.separatorNoneOption),
        SEPARATOR_DOT_OPTION: escapeHtml(content.separatorDotOption),
        SEPARATOR_UNDERSCORE_OPTION: escapeHtml(content.separatorUnderscoreOption),
        SEPARATOR_HYPHEN_OPTION: escapeHtml(content.separatorHyphenOption),
        CASE_STYLE_LABEL: escapeHtml(content.caseStyleLabel),
        CASE_LOWER_OPTION: escapeHtml(content.caseLowerOption),
        CASE_CAMEL_OPTION: escapeHtml(content.caseCamelOption),
        CASE_PASCAL_OPTION: escapeHtml(content.casePascalOption),
        NUMBER_TOGGLE_LABEL: escapeHtml(content.numberToggleLabel),
        GENERATE_BTN_TEXT: escapeHtml(content.generateBtnText),
        COPY_BTN_TEXT: escapeHtml(content.copyBtnText),
        COPIED_TEXT: escapeHtml(content.copiedText),
        RESULT_NOTE: escapeHtml(content.resultNote),
        LOAD_ERROR: escapeHtml(content.loadError),
      });
    }

    const html = render(template, tokens);

    const outPath = path.join(ROOT, lang, tool, "index.html");

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, html);
    console.log(`생성됨: ${path.relative(ROOT, outPath)}`);
  }

  // 예전 URL(/{tool}/)에는 새 한국어 위치(/ko/{tool}/)로 안내하는 리다이렉트 스텁을 남깁니다.
  // 이건 대칭 구조로 통일되기 전(예전엔 한국어가 prefix 없이 bare 경로에 있었음)부터
  // 있던 도구에만 해당하는 이력입니다 — TOOL_LANGS에 등록된, 처음부터 대칭으로 시작한
  // 새 도구는 그런 예전 URL 자체가 없었으므로 스텁이 필요 없습니다.
  if (!TOOL_LANGS[tool]) {
    const stubContent = JSON.parse(
      await fs.readFile(path.join(toolDir, "content.ko.json"), "utf-8")
    );
    const newKoUrl = `${SITE_BASE}ko/${tool}/`;
    const stubHtml = buildRedirectStub(newKoUrl, `../ko/${tool}/`, stubContent.h1);
    await fs.writeFile(path.join(toolDir, "index.html"), stubHtml);
    console.log(`리다이렉트 스텁 생성됨: ${path.relative(ROOT, path.join(toolDir, "index.html"))} → ${newKoUrl}`);
  }
}

// 대시보드에 나열되는 모든 도구의 메타데이터입니다. category별로 섹션을 나눠
// 보여주기 위해 각 도구가 어느 카테고리에 속하는지도 함께 관리합니다. 대시보드는
// 4개 언어 전부에 존재하지만, 카드는 그 도구가 실제로 지원하는 언어(langsFor)의
// 대시보드에서만 나타나야 합니다 — 그렇지 않으면 ja/zh 대시보드에 아직 없는
// 페이지로 링크가 걸려서 클릭 시 404가 됩니다.
const ALL_TOOLS = [
  { key: "flag-master", icon: "flag-master.svg", titleField: "flagMasterTitle", descField: "flagMasterDesc", category: "resources" },
  { key: "emoji-search", icon: "emoji-search.svg", titleField: "emojiSearchTitle", descField: "emojiSearchDesc", category: "resources" },
  { key: "special-char", icon: "special-char.svg", titleField: "specialCharTitle", descField: "specialCharDesc", category: "resources" },
  { key: "qr-code", icon: "qr-code.svg", titleField: "qrCodeTitle", descField: "qrCodeDesc", category: "generators" },
  { key: "password-generator", icon: "password-generator.svg", titleField: "passwordGeneratorTitle", descField: "passwordGeneratorDesc", category: "generators" },
  { key: "gradient-builder", icon: "gradient-builder.svg", titleField: "gradientBuilderTitle", descField: "gradientBuilderDesc", category: "generators" },
  { key: "dday-counter", icon: "dday-counter.svg", titleField: "ddayCounterTitle", descField: "ddayCounterDesc", category: "time" },
  { key: "interval-timer", icon: "interval-timer.svg", titleField: "intervalTimerTitle", descField: "intervalTimerDesc", category: "time" },
  { key: "tempo-counter", icon: "tempo-counter.svg", titleField: "tempoCounterTitle", descField: "tempoCounterDesc", category: "time" },
  { key: "pomodoro-timer", icon: "pomodoro-timer.svg", titleField: "pomodoroTimerTitle", descField: "pomodoroTimerDesc", category: "time" },
  { key: "white-noise", icon: "white-noise.svg", titleField: "whiteNoiseTitle", descField: "whiteNoiseDesc", category: "focus" },
  { key: "flashcards", icon: "flashcards.svg", titleField: "flashcardsTitle", descField: "flashcardsDesc", category: "focus" },
  { key: "square-check", icon: "square-check.svg", titleField: "squareCheckTitle", descField: "squareCheckDesc", category: "pro" },
  { key: "stair-calc", icon: "stair-calc.svg", titleField: "stairCalcTitle", descField: "stairCalcDesc", category: "pro" },
  { key: "shelf-spacing", icon: "shelf-spacing.svg", titleField: "shelfSpacingTitle", descField: "shelfSpacingDesc", category: "pro" },
  { key: "clay-shrinkage", icon: "clay-shrinkage.svg", titleField: "clayShrinkageTitle", descField: "clayShrinkageDesc", category: "pro" },
  { key: "kiln-loading", icon: "kiln-loading.svg", titleField: "kilnLoadingTitle", descField: "kilnLoadingDesc", category: "pro" },
  { key: "image-converter", icon: "image-converter.svg", titleField: "imageConverterTitle", descField: "imageConverterDesc", category: "image" },
  { key: "vector-converter", icon: "vector-converter.svg", titleField: "vectorConverterTitle", descField: "vectorConverterDesc", category: "image" },
  { key: "svg-cleaner", icon: "svg-cleaner.svg", titleField: "svgCleanerTitle", descField: "svgCleanerDesc", category: "image" },
  { key: "username-generator", icon: "username-generator.svg", titleField: "usernameGeneratorTitle", descField: "usernameGeneratorDesc", category: "generators" },
];

const CATEGORY_ORDER = ["resources", "generators", "time", "focus", "image", "pro"];

const CATEGORY_LABELS = {
  ko: { resources: "이미지 자료", generators: "생성기", time: "시간", focus: "학습", image: "변환툴", pro: "전문가용 계산기" },
  en: { resources: "Image Resources", generators: "Generators", time: "Time", focus: "Focus & Study", image: "Conversion Tools", pro: "Professional Calculators" },
  ja: { resources: "画像素材", generators: "ジェネレーター", time: "時間", focus: "学習", image: "変換ツール", pro: "専門計算機" },
  zh: { resources: "图片素材", generators: "生成器", time: "时间", focus: "学习", image: "转换工具", pro: "专业计算器" },
};

// 도구를 category 순서대로 묶어서 각각 <section>으로 만듭니다. 그 언어를 지원하는
// 도구가 하나도 없는 카테고리(예: ja/zh 대시보드의 "시간" 카테고리)는 빈 섹션
// 제목만 뜨지 않도록 통째로 건너뜁니다.
function buildToolSectionsHtml(lang, content) {
  return CATEGORY_ORDER.map((categoryKey) => {
    const toolsInCategory = ALL_TOOLS.filter((t) => t.category === categoryKey && langsFor(t.key).includes(lang));
    if (toolsInCategory.length === 0) return "";

    const cardsHtml = toolsInCategory
      .map(
        (t) => `        <a class="tool-card" href="${lang}/${t.key}/">
          <img src="assets/icons/${t.icon}" alt="" class="tool-card-icon" aria-hidden="true" />
          <span class="tool-card-title">${escapeHtml(content[t.titleField])}</span>
          <span class="tool-card-desc">${escapeHtml(content[t.descField])}</span>
        </a>`
      )
      .join("\n");

    return `    <section class="tool-category">
      <h2 class="tool-category-heading">${escapeHtml(CATEGORY_LABELS[lang][categoryKey])}</h2>
      <div class="tool-grid">
${cardsHtml}
      </div>
    </section>`;
  })
    .filter((section) => section !== "")
    .join("\n\n");
}

// 루트 대시보드도 도구 페이지와 완전히 대칭인 /{lang}/ 구조를 씁니다(예전엔 한국어만
// 예외로 "/"에 그대로 있었는데, 특정 언어가 "메인 사이트"처럼 보이지 않도록 이번에
// 전부 통일했습니다). 대신 bare "/"에는 실제 콘텐츠 없이 "/en/"로 안내하는 최소한의
// 리다이렉트 스텁만 남깁니다 — 도메인만 입력해 들어온 방문자를 위한 기본값이며,
// 검색엔진이 각 언어 사용자에게 맞는 버전을 보여주는 hreflang 매칭과는 별개입니다.
async function buildRoot() {
  const template = await fs.readFile(path.join(ROOT, "template.html"), "utf-8");
  let enContent = null;

  for (const lang of LANGS) {
    const content = JSON.parse(
      await fs.readFile(path.join(ROOT, `content.${lang}.json`), "utf-8")
    );
    if (lang === "en") enContent = content;

    const canonicalUrl = `${SITE_BASE}${lang}/`;
    const baseTag = `  <base href="../" />\n`;
    const hreflangLines = LANGS.map((l) => {
      const url = `${SITE_BASE}${l}/`;
      return `  <link rel="alternate" hreflang="${l}" href="${url}" />`;
    });
    hreflangLines.push(`  <link rel="alternate" hreflang="x-default" href="${SITE_BASE}en/" />`);
    const hreflangLinks = hreflangLines.join("\n");

    const tokens = {
      HTML_LANG: content.htmlLang,
      PAGE_TITLE: escapeHtml(content.pageTitle),
      META_DESCRIPTION: escapeHtml(content.metaDescription),
      CANONICAL_URL: canonicalUrl,
      HREFLANG_LINKS: hreflangLinks,
      BASE_TAG: baseTag,
      HERO_SUBTITLE: escapeHtml(content.heroSubtitle),
      TOOL_SECTIONS_HTML: buildToolSectionsHtml(lang, content),
      FOOTER_NOTE: escapeHtml(content.footerNote),
      FOOTER_PRIVACY_HREF: `${lang}/privacy/`,
      FOOTER_PRIVACY_TEXT: escapeHtml(FOOTER_LABELS[lang].privacy),
      FOOTER_ABOUT_HREF: `${lang}/about/`,
      FOOTER_ABOUT_TEXT: escapeHtml(FOOTER_LABELS[lang].about),
      SCROLL_TOP_ARIA: escapeHtml(SCROLL_TOP_LABELS[lang]),
    };

    const html = render(template, tokens);
    const outPath = path.join(ROOT, lang, "index.html");

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, html);
    console.log(`생성됨: ${path.relative(ROOT, outPath)}`);
  }

  // bare "/"는 실제 대시보드가 아니라 브라우저 언어를 감지해 /{lang}/로 안내하는
  // 라우팅 스텁입니다(지원 언어가 아니면 중립 기본값 "/en/"로 보냄).
  const enUrl = `${SITE_BASE}en/`;
  const stubHtml = buildLangDetectStub(enUrl, LANGS, enContent.pageTitle);
  await fs.writeFile(path.join(ROOT, "index.html"), stubHtml);
  console.log(`언어 감지 스텁 생성됨: index.html (지원 언어: ${LANGS.join(", ")}, 기본값: en)`);
}

// privacy/about 페이지는 도구가 아니라 정적 정보 페이지라서 검색·SoftwareApplication
// JSON-LD가 필요 없습니다. 자체 script.js·style.css도 없이 루트 대시보드의 style.css를
// 그대로 재사용합니다(<base>를 저장소 루트로 향하게 해서). URL은 도구와 동일하게
// /ko/privacy/, /en/privacy/ ... 대칭 구조를 쓰고, 새로 만든 페이지라 예전 URL을
// 보호할 리다이렉트 스텁은 필요 없습니다.
async function buildInfoPage(page) {
  const pageDir = path.join(ROOT, page);
  const template = await fs.readFile(path.join(pageDir, "template.html"), "utf-8");

  for (const lang of LANGS) {
    const content = JSON.parse(
      await fs.readFile(path.join(pageDir, `content.${lang}.json`), "utf-8")
    );

    const canonicalUrl = `${SITE_BASE}${lang}/${page}/`;
    const baseTag = `  <base href="../../" />\n`;
    // 주의: 도구 페이지의 <base>(`../../{tool}/`)는 사이트 루트보다 한 단계 더 아래
    // ({tool}/ 디렉터리)를 가리키기 때문에 뒤로가기 링크가 "../{lang}/"(한 단계 위로)여야
    // 하지만, 이 페이지의 <base>(`../../`)는 이미 사이트 루트 자체를 가리킵니다.
    // 여기서도 "../{lang}/"을 쓰면 루트보다 한 단계 더 위로 올라가버려서 저장소 경로
    // (/getniftykit/)가 통째로 빠진 잘못된 URL(예: namjanghyuk.github.io/ko/)이 되고
    // 404가 납니다(실사용 테스트로 발견). <base>가 이미 루트이므로 앞에 "../" 없이
    // "{lang}/"만 붙입니다.
    const backLinkHref = `${lang}/`;

    const hreflangLines = LANGS.map(
      (l) => `  <link rel="alternate" hreflang="${l}" href="${SITE_BASE}${l}/${page}/" />`
    );
    hreflangLines.push(`  <link rel="alternate" hreflang="x-default" href="${SITE_BASE}en/${page}/" />`);

    const tokens = {
      HTML_LANG: content.htmlLang,
      PAGE_TITLE: escapeHtml(content.pageTitle),
      META_DESCRIPTION: escapeHtml(content.metaDescription),
      CANONICAL_URL: canonicalUrl,
      HREFLANG_LINKS: hreflangLines.join("\n"),
      BASE_TAG: baseTag,
      BACK_LINK_HREF: backLinkHref,
      BACK_LINK_TEXT: escapeHtml(content.backLinkText),
      H1: escapeHtml(content.h1),
      GOOGLE_FORM_URL,
      CONTACT_HEADING: escapeHtml(content.contactHeading),
      CONTACT_BODY: escapeHtml(content.contactBody),
      CONTACT_LINK_TEXT: escapeHtml(content.contactLinkText),
      FOOTER_PRIVACY_HREF: `${backLinkHref}privacy/`,
      FOOTER_PRIVACY_TEXT: escapeHtml(FOOTER_LABELS[lang].privacy),
      FOOTER_ABOUT_HREF: `${backLinkHref}about/`,
      FOOTER_ABOUT_TEXT: escapeHtml(FOOTER_LABELS[lang].about),
      SCROLL_TOP_ARIA: escapeHtml(SCROLL_TOP_LABELS[lang]),
    };

    if (page === "privacy") {
      Object.assign(tokens, {
        LAST_UPDATED: escapeHtml(content.lastUpdated),
        INTRO: escapeHtml(content.intro),
        SECTIONS_HTML: buildSectionsHtml(content.sections),
      });
    }

    if (page === "about") {
      Object.assign(tokens, {
        INTRO: escapeHtml(content.intro),
        WHAT_HEADING: escapeHtml(content.whatHeading),
        WHAT_BODY: escapeHtml(content.whatBody),
        HOW_IT_WORKS_HEADING: escapeHtml(content.howItWorksHeading),
        HOW_IT_WORKS_BODY: escapeHtml(content.howItWorksBody),
      });
    }

    const html = render(template, tokens);
    const outPath = path.join(ROOT, lang, page, "index.html");

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, html);
    console.log(`생성됨: ${path.relative(ROOT, outPath)}`);
  }
}

// sitemap.xml / robots.txt는 예전엔 도메인이 88곳(도구 수 × 언어 수)에 하드코딩된
// 손수 관리 파일이었습니다. 도메인이 바뀔 때마다 전부 손으로 고치는 대신, 이미 위에서
// 페이지별 hreflang을 만들 때 쓰는 것과 같은 SITE_BASE/TOOLS/TOOL_LANGS/INFO_PAGES
// 정보를 그대로 재사용해 빌드 시점에 생성합니다. 앞으로 도메인이 바뀌면 SITE_BASE
// 한 줄만 고치고 재빌드하면 sitemap.xml/robots.txt도 함께 갱신됩니다.
function sitemapUrlBlock(loc, priority, changefreq, hreflangLangs, hreflangUrl) {
  const altLines = hreflangLangs
    .map((lang) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${hreflangUrl(lang)}" />`)
    .join("\n");
  return `  <url>
    <loc>${loc}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
${altLines}
  </url>`;
}

async function generateSitemap() {
  const entries = [];

  // 대시보드: 4개 언어 전부 대칭이므로 LANGS를 그대로 씁니다. bare "/"는 실제
  // 콘텐츠가 아니라 리다이렉트 스텁이라 sitemap에서 제외합니다(9-1 규칙).
  for (const lang of LANGS) {
    entries.push(
      sitemapUrlBlock(`${SITE_BASE}${lang}/`, "0.9", "weekly", LANGS, (l) => `${SITE_BASE}${l}/`)
    );
  }

  // 도구 페이지: 도구별로 실제 지원하는 언어(langsFor)만 나열합니다 — hreflang과
  // 동일한 이유로, 아직 번역이 없는 언어의 URL을 sitemap에 올리면 안 됩니다.
  for (const tool of TOOLS) {
    for (const lang of langsFor(tool)) {
      const priority = lang === "ko" ? "0.8" : "0.7";
      entries.push(
        sitemapUrlBlock(
          `${SITE_BASE}${lang}/${tool}/`,
          priority,
          "monthly",
          langsFor(tool),
          (l) => `${SITE_BASE}${l}/${tool}/`
        )
      );
    }
  }

  // 정보 페이지(privacy/about): 항상 4개 언어 대칭입니다.
  for (const page of INFO_PAGES) {
    for (const lang of LANGS) {
      const priority = lang === "ko" ? "0.6" : "0.5";
      entries.push(
        sitemapUrlBlock(
          `${SITE_BASE}${lang}/${page}/`,
          priority,
          "monthly",
          LANGS,
          (l) => `${SITE_BASE}${l}/${page}/`
        )
      );
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;

  await fs.writeFile(path.join(ROOT, "sitemap.xml"), xml);
  console.log(`생성됨: sitemap.xml (${entries.length}개 URL)`);
}

async function generateRobotsTxt() {
  const txt = `User-agent: *
Allow: /

Sitemap: ${SITE_BASE}sitemap.xml
`;
  await fs.writeFile(path.join(ROOT, "robots.txt"), txt);
  console.log("생성됨: robots.txt");
}

for (const tool of TOOLS) {
  await buildTool(tool);
}
await buildRoot();
for (const page of INFO_PAGES) {
  await buildInfoPage(page);
}
await generateSitemap();
await generateRobotsTxt();
