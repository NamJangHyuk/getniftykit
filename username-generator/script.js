// 유저네임 생성기 핵심 로직
// 형용사·명사 단어 뱅크에서 조합 패턴(형용사2+명사1 등)에 맞게 무작위로 골라
// 이메일 아이디/닉네임 후보 문자열을 만듭니다.
// Math.random()은 예측 가능한 의사난수라 배제하고, 비밀번호 생성기와 동일하게
// crypto.getRandomValues()(Web Crypto API)로 배열 인덱스를 뽑습니다. 단어 데이터(words.json)는
// 도구 폴더에 정적으로 두고 fetch로 불러오며, 조합·생성 전 과정이 브라우저 안에서만
// 이루어져 서버로 전송되는 데이터가 없습니다.

const output = document.getElementById("ug-output");
const copyBtn = document.getElementById("ug-copy-btn");
const generateBtn = document.getElementById("ug-generate-btn");
const errorEl = document.getElementById("ug-error");
const patternSelect = document.getElementById("ug-pattern");
const separatorSelect = document.getElementById("ug-separator");
const caseSelect = document.getElementById("ug-case");
const numberToggle = document.getElementById("ug-number-toggle");
const numberDigitsSelect = document.getElementById("ug-number-digits");

let ADJECTIVES = [];
let NOUNS = [];
let currentUsername = "";

// crypto.getRandomValues() 기반으로 [0, max) 범위의 정수 인덱스를 뽑습니다.
function randomIndex(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

// 부분 Fisher-Yates 셔플: 배열에서 서로 다른 n개를 무작위로 뽑습니다(같은 단어가
// 두 번 나오는 것을 방지). 단어 뱅크가 수백 개 규모라 앞 n개만 섞어도 충분히 무작위롭고,
// 매번 새 배열을 통째로 섞는 것보다 빠릅니다.
function pickDistinct(arr, n) {
  const indices = arr.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + randomIndex(indices.length - i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, n).map((i) => arr[i]);
}

// 조합 패턴에 따라 형용사·명사 배열에서 몇 개씩 뽑을지 결정합니다.
function wordsForPattern(pattern) {
  if (pattern === "adj1noun2") return [...pickDistinct(ADJECTIVES, 1), ...pickDistinct(NOUNS, 2)];
  if (pattern === "adj3") return pickDistinct(ADJECTIVES, 3);
  if (pattern === "noun3") return pickDistinct(NOUNS, 3);
  return [...pickDistinct(ADJECTIVES, 2), ...pickDistinct(NOUNS, 1)]; // "adj2noun1" (기본값)
}

function randomDigits(count) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const max = 10 ** count;
  return String(buf[0] % max).padStart(count, "0");
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function applyCase(words, style) {
  if (style === "pascal") return words.map(capitalize);
  if (style === "camel") return words.map((w, i) => (i === 0 ? w : capitalize(w)));
  return words; // "lower": words.json은 이미 소문자로만 저장되어 있어 그대로 사용
}

function generate() {
  if (!ADJECTIVES.length || !NOUNS.length) return;

  const words = applyCase(wordsForPattern(patternSelect.value), caseSelect.value);

  const sep = separatorSelect.value === "none" ? "" : separatorSelect.value;
  let result = words.join(sep);

  if (numberToggle.checked) {
    const digits = Number(numberDigitsSelect.value);
    result += sep + randomDigits(digits);
  }

  currentUsername = result;
  output.textContent = result;
}

function bindControls() {
  [patternSelect, separatorSelect, caseSelect, numberToggle, numberDigitsSelect].forEach((el) => {
    el.addEventListener("change", generate);
  });
  generateBtn.addEventListener("click", generate);

  let copyResetTimer = null;
  copyBtn.addEventListener("click", () => {
    if (!currentUsername) return;
    navigator.clipboard.writeText(currentUsername).then(() => {
      clearTimeout(copyResetTimer);
      copyBtn.textContent = copyBtn.dataset.copiedLabel;
      copyResetTimer = setTimeout(() => {
        copyBtn.textContent = copyBtn.dataset.copyLabel;
      }, 1500);
    });
  });
}

fetch("words.json")
  .then((res) => {
    if (!res.ok) throw new Error("failed to load words.json");
    return res.json();
  })
  .then((data) => {
    ADJECTIVES = data.adjectives;
    NOUNS = data.nouns;
    bindControls();
    generate();
  })
  .catch(() => {
    errorEl.hidden = false;
    generateBtn.disabled = true;
    copyBtn.disabled = true;
  });
