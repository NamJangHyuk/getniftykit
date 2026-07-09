// 빌드 시점(build-time)에만 실행하는 스크립트입니다.
// 국가 목록(대륙/다국어 이름)과 국기 PNG/SVG 이미지를 미리 받아서 정적 파일로 저장해두면,
// 실제 사용자가 사이트를 방문했을 때는 외부 API 호출 없이 즉시 로드/다운로드할 수 있습니다.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worldCountries from "world-countries";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const THUMB_DIR = path.join(ROOT, "flags-thumb"); // 화면 그리드 미리보기용 (작고 빠르게, w320)
const PNG_DIR = path.join(ROOT, "flags-png"); // 실제 다운로드용 PNG (flagcdn 최대 해상도, w2560)
const SVG_DIR = path.join(ROOT, "flags-svg"); // 실제 다운로드용 SVG (벡터, 해상도 제한 없음)
const OUTPUT_JSON = path.join(ROOT, "countries.json");

// world-countries의 region 값을 이 사이트의 대륙 카테고리 키로 정리합니다.
// eu/un처럼 world-countries에 없는(국가가 아닌) 코드는 "other"로 분류됩니다.
function toRegionKey(region) {
  switch (region) {
    case "Asia":
      return "asia";
    case "Europe":
      return "europe";
    case "Africa":
      return "africa";
    case "Americas":
      return "americas";
    case "Oceania":
      return "oceania";
    default:
      return "other";
  }
}

// world-countries 데이터에서 이 사이트가 지원하는 언어별 국가명을 뽑아냅니다.
// 지원 언어가 없는 항목(eu/un 등)은 영문 fallback 이름을 그대로 사용합니다.
function buildNames(wc, fallbackEn) {
  const t = wc?.translations || {};
  const en = wc?.name?.common || fallbackEn;
  return {
    en,
    ko: t.kor?.common || en,
    ja: t.jpn?.common || en,
    zh: t.zho?.common || en,
    ar: t.ara?.common || en,
    es: t.spa?.common || en,
    fr: t.fra?.common || en,
    de: t.deu?.common || en,
    ru: t.rus?.common || en,
    pt: t.por?.common || en,
  };
}

// 공식 국명(예: 한국의 "대한민국", 일본의 "日本国")도 함께 모아서 검색 대상에 포함시킵니다.
function buildOfficialNames(wc) {
  const t = wc?.translations || {};
  return [
    wc?.name?.official,
    t.kor?.official,
    t.jpn?.official,
    t.zho?.official,
    t.ara?.official,
    t.spa?.official,
    t.fra?.official,
    t.deu?.official,
    t.rus?.official,
    t.por?.official,
  ].filter(Boolean);
}

// 검색창에 어떤 언어/표기로 입력해도 찾을 수 있도록, 이 나라를 가리키는 모든 검증된
// 이름을 한데 모읍니다: 언어별 통칭 + 언어별 공식 명칭 + world-countries의 altSpellings
// (국가 코드, 구 명칭, 자국어 별칭 등 실제로 쓰이는 이름들 — 임의로 지어낸 표기는 넣지 않습니다).
function buildSearchTerms(names, wc) {
  const terms = new Set([
    ...Object.values(names),
    ...buildOfficialNames(wc),
    ...(wc?.altSpellings || []),
  ]);
  return [...terms].filter(Boolean);
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await fs.mkdir(THUMB_DIR, { recursive: true });
  await fs.mkdir(PNG_DIR, { recursive: true });
  await fs.mkdir(SVG_DIR, { recursive: true });

  const wcByCca2 = new Map(worldCountries.map((c) => [c.cca2, c]));

  // flagcdn.com은 가입 없이 무료로 국가 코드 목록과 국기 이미지를 제공합니다.
  const res = await fetch("https://flagcdn.com/en/codes.json");
  if (!res.ok) throw new Error(`codes.json fetch failed: ${res.status}`);
  const codes = await res.json(); // { "kr": "South Korea", "us": "United States", ... }

  // flagcdn codes.json에는 미국 주(us-ca)나 영국 지역(gb-eng) 같은 하위 지역 국기도
  // 섞여 있습니다. 이 도구는 "국가" 국기만 다루므로 2자리 ISO 3166-1 alpha-2 코드만 남깁니다.
  const entries = Object.entries(codes).filter(([code]) => code.length === 2);
  const results = [];
  let done = 0;

  for (const [code, nameEn] of entries) {
    const iso2 = code.toUpperCase();
    const wc = wcByCca2.get(iso2);

    const thumbUrl = `https://flagcdn.com/w320/${code}.png`;
    const pngUrl = `https://flagcdn.com/w2560/${code}.png`;
    const svgUrl = `https://flagcdn.com/${code}.svg`;
    const thumbDest = path.join(THUMB_DIR, `${code}.png`);
    const pngDest = path.join(PNG_DIR, `${code}.png`);
    const svgDest = path.join(SVG_DIR, `${code}.svg`);

    try {
      // 이미 받아둔 파일은 다시 내려받지 않고 건너뜁니다 (재실행 속도 향상).
      if (!(await fileExists(thumbDest))) {
        const thumbRes = await fetch(thumbUrl);
        if (!thumbRes.ok) throw new Error(`thumb status ${thumbRes.status}`);
        const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
        // flagcdn PNG는 인덱스(팔레트) 컬러라 일부 프로그램에서 "지원 안 함"으로 거부될 수 있어
        // sharp로 표준 RGBA 트루컬러로 재인코딩합니다. 픽셀 값 자체는 그대로 유지됩니다.
        const thumbRgba = await sharp(thumbBuf).png({ palette: false }).toBuffer();
        await fs.writeFile(thumbDest, thumbRgba);
      }

      let hasPng = await fileExists(pngDest);
      if (!hasPng) {
        const pngRes = await fetch(pngUrl);
        if (pngRes.ok) {
          const pngBuf = Buffer.from(await pngRes.arrayBuffer());
          const pngRgba = await sharp(pngBuf).png({ palette: false }).toBuffer();
          await fs.writeFile(pngDest, pngRgba);
          hasPng = true;
        } else {
          console.warn(`  ↳ 고해상도 PNG 없음: ${code} (status ${pngRes.status})`);
        }
      }

      let hasSvg = await fileExists(svgDest);
      if (!hasSvg) {
        // SVG도 같은 flagcdn.com(실제 국기 벡터 소스)에서 받아옵니다.
        const svgRes = await fetch(svgUrl);
        if (svgRes.ok) {
          const svgText = await svgRes.text();
          await fs.writeFile(svgDest, svgText);
          hasSvg = true;
        } else {
          console.warn(`  ↳ SVG 없음: ${code} (status ${svgRes.status})`);
        }
      }

      const names = buildNames(wc, nameEn);

      results.push({
        code,
        region: toRegionKey(wc?.region),
        names,
        searchTerms: buildSearchTerms(names, wc),
        hasPng,
        hasSvg,
      });
    } catch (err) {
      console.warn(`skip ${code} (${nameEn}): ${err.message}`);
    }

    done += 1;
    if (done % 25 === 0) console.log(`${done}/${entries.length} 완료...`);
  }

  results.sort((a, b) => a.names.en.localeCompare(b.names.en));

  await fs.writeFile(OUTPUT_JSON, JSON.stringify(results, null, 2));
  console.log(`\n완료: 국가 ${results.length}개, countries.json 저장됨`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
