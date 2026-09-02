// 불량화소 테스트의 핵심 로직
// 단색(검정·흰색·빨강·초록·파랑), 그레이스케일 밴딩 패턴, 깜빡임(복구 시도) 패턴을
// 화면 전체를 덮는 오버레이에 순서대로 띄워줍니다. 액정 픽셀은 빨강·초록·파랑
// 서브픽셀 3개로 이루어져 있어서, 서브픽셀 하나만 고장 나도 특정 색에서만 티가
// 나는 경우가 많습니다. 그래서 한 색만 보여주고 끝내지 않고 SEQUENCE 순서대로
// 전부 돌아보게 만들었습니다.

const SEQUENCE = ["black", "white", "red", "green", "blue", "gray", "flicker"];

// 단색 모드에서 실제로 배경에 칠할 색상값입니다. gray·flicker는 별도 로직으로 처리하므로
// 여기 없습니다.
const SOLID_COLORS = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
};

// 깜빡임(복구 시도) 모드에서 빠르게 순환시킬 색상들입니다. 짧은 간격으로 강한 대비의
// 색을 반복해서 보여주면, 화면에 눌어붙은 픽셀(상시켜짐화소)이 정상으로 돌아오는
// 경우가 보고된 방법이지만 효과가 보장되는 건 아닙니다(FAQ에서 안내).
const FLICKER_COLORS = ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#000000"];
const FLICKER_INTERVAL_MS = 60;

const colorButtons = document.querySelectorAll(".dp-color-btn");
const startBtn = document.getElementById("dp-start-btn");
const exitBtn = document.getElementById("dp-exit-btn");
const overlay = document.getElementById("dp-overlay");
const grayBands = document.getElementById("dp-gray-bands");
const hint = document.getElementById("dp-overlay-hint");
const autoplayCheckbox = document.getElementById("dp-autoplay");
const intervalInput = document.getElementById("dp-interval");

let currentIndex = 0;
let autoplayTimer = null;
let flickerTimer = null;
let hintTimeoutId = null;

// 그레이스케일 패턴은 검정→흰색까지 밝기를 16단계로 균등하게 나눈 세로 막대들입니다.
// 단계가 너무 적으면 밝기 차이가 안 보이고, 너무 많으면 막대 하나가 좁아져서 오히려
// 불량화소를 찾기 어려워지므로 16단계로 절충했습니다.
function buildGrayBands() {
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    const band = document.createElement("div");
    band.style.background = `rgb(${v}, ${v}, ${v})`;
    grayBands.appendChild(band);
  }
}
buildGrayBands();

function stopFlicker() {
  if (flickerTimer) {
    clearInterval(flickerTimer);
    flickerTimer = null;
  }
}

function renderMode(mode) {
  stopFlicker();
  grayBands.hidden = true;
  overlay.style.background = "";

  if (mode === "gray") {
    grayBands.hidden = false;
    return;
  }

  if (mode === "flicker") {
    let i = 0;
    overlay.style.background = FLICKER_COLORS[0];
    flickerTimer = setInterval(() => {
      i = (i + 1) % FLICKER_COLORS.length;
      overlay.style.background = FLICKER_COLORS[i];
    }, FLICKER_INTERVAL_MS);
    return;
  }

  overlay.style.background = SOLID_COLORS[mode] || "#000000";
}

// 조작 힌트는 화면을 가리지 않도록 잠깐만 보여주고 자동으로 사라집니다.
function showHintBriefly() {
  hint.classList.add("is-visible");
  clearTimeout(hintTimeoutId);
  hintTimeoutId = setTimeout(() => hint.classList.remove("is-visible"), 2500);
}

function goToIndex(nextIndex) {
  currentIndex = ((nextIndex % SEQUENCE.length) + SEQUENCE.length) % SEQUENCE.length;
  renderMode(SEQUENCE[currentIndex]);
}

function stopAutoplay() {
  if (autoplayTimer) {
    clearInterval(autoplayTimer);
    autoplayTimer = null;
  }
}

function startAutoplay() {
  stopAutoplay();
  const seconds = Math.min(30, Math.max(1, Number(intervalInput.value) || 3));
  autoplayTimer = setInterval(() => goToIndex(currentIndex + 1), seconds * 1000);
}

// 사용자가 직접 화면을 넘기면(클릭·화살표) 자동 재생 중이었더라도 멈춥니다 — 자동으로
// 계속 넘어가는 도중에 수동으로 원하는 색을 골랐는데 몇 초 뒤 또 바뀌어버리면
// 혼란스러우니, 수동 조작이 우선하도록 만들었습니다.
function advance(step) {
  goToIndex(currentIndex + step);
  stopAutoplay();
  autoplayCheckbox.checked = false;
  showHintBriefly();
}

function enterTestView(startMode) {
  const startIndex = SEQUENCE.indexOf(startMode);
  currentIndex = startIndex === -1 ? 0 : startIndex;
  overlay.hidden = false;
  document.body.classList.add("dp-locked");
  renderMode(SEQUENCE[currentIndex]);
  showHintBriefly();

  // 전체화면 API는 사용자 제스처(클릭) 안에서 호출해야 브라우저가 승인합니다.
  // 거부되거나 지원하지 않아도 오버레이 자체가 이미 뷰포트 전체를 채우므로
  // 검사에는 지장이 없어(catch로 조용히 무시) 별도 에러 처리를 하지 않습니다.
  const requestFs = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
  if (requestFs) {
    requestFs.call(overlay).catch(() => {});
  }

  if (autoplayCheckbox.checked) startAutoplay();
}

function exitTestView() {
  stopAutoplay();
  stopFlicker();
  overlay.hidden = true;
  document.body.classList.remove("dp-locked");
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  }
}

colorButtons.forEach((btn) => {
  btn.addEventListener("click", () => enterTestView(btn.dataset.mode));
});

startBtn.addEventListener("click", () => enterTestView(SEQUENCE[0]));
exitBtn.addEventListener("click", exitTestView);

overlay.addEventListener("click", (event) => {
  if (event.target === exitBtn) return;
  advance(1);
});

document.addEventListener("keydown", (event) => {
  if (overlay.hidden) return;

  if (event.key === "Escape") {
    exitTestView();
  } else if (event.key === "ArrowRight") {
    advance(1);
  } else if (event.key === "ArrowLeft") {
    advance(-1);
  } else if (event.key === " ") {
    event.preventDefault();
    if (autoplayTimer) {
      stopAutoplay();
    } else {
      startAutoplay();
    }
    autoplayCheckbox.checked = !!autoplayTimer;
    showHintBriefly();
  }
});

// 브라우저 자체 단축키(F11 등)나 시스템 동작으로 전체화면이 풀렸을 때도 검사 화면은
// 그대로 유지합니다 — 위에서 설명했듯 오버레이가 이미 뷰포트를 꽉 채우고 있어서
// 전체화면 여부와 무관하게 계속 검사할 수 있습니다.
