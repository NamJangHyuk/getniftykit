// 불량화소 테스트의 핵심 로직
// 단색(검정·흰색·빨강·초록·파랑), 그레이스케일 밴딩 패턴, 깜빡임(복구 시도) 패턴을
// 화면 전체를 덮는 오버레이에 순서대로 띄워줍니다. 액정 픽셀은 빨강·초록·파랑
// 서브픽셀 3개로 이루어져 있어서, 서브픽셀 하나만 고장 나도 특정 색에서만 티가
// 나는 경우가 많습니다. 그래서 한 색만 보여주고 끝내지 않고 SEQUENCE 순서대로
// 전부 돌아보게 만들었습니다.

// 그레이스케일은 좌→우 하나만으로는 특정 방향의 얼룩·밴딩을 놓칠 수 있어서
// 4방향(가로 두 방향 + 세로 두 방향)을 모두 순서에 넣었습니다. 화살표/클릭으로
// 넘어가는 기존 방식 그대로 4개를 차례로 훑을 수 있습니다.
const SEQUENCE = [
  "black",
  "white",
  "red",
  "green",
  "blue",
  "gray-ltr",
  "gray-rtl",
  "gray-ttb",
  "gray-btt",
  "flicker",
];

// 그레이스케일 모드별 flex-direction 매핑입니다. 밴드 DOM(16개)은 하나만 만들어두고
// 방향에 따라 이 값만 바꿔 끼워서 4방향을 재사용합니다.
const GRAY_FLEX_DIRECTION = {
  "gray-ltr": "row",
  "gray-rtl": "row-reverse",
  "gray-ttb": "column",
  "gray-btt": "column-reverse",
};

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
const autoplayBtn = document.getElementById("dp-autoplay-btn");
const exitBtn = document.getElementById("dp-exit-btn");
const overlay = document.getElementById("dp-overlay");
const grayBands = document.getElementById("dp-gray-bands");
const hint = document.getElementById("dp-overlay-hint");
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

  if (mode in GRAY_FLEX_DIRECTION) {
    grayBands.style.flexDirection = GRAY_FLEX_DIRECTION[mode];
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

// 조작 힌트와 종료(X) 버튼은 화면 일부를 가리거나(하단 힌트), 검사 중인 단색 화면
// 위에서 얼룩처럼 보일 수 있어서(우상단 X 버튼) 평소엔 숨겨두고, 마우스를 움직이거나
// 색상을 넘기는 등 조작이 있을 때만 잠깐 보여줍니다(2.5초 → 1.2초로 단축).
const HINT_VISIBLE_MS = 1200;
function showHintBriefly() {
  hint.classList.add("is-visible");
  exitBtn.classList.add("is-visible");
  clearTimeout(hintTimeoutId);
  hintTimeoutId = setTimeout(() => {
    hint.classList.remove("is-visible");
    exitBtn.classList.remove("is-visible");
  }, HINT_VISIBLE_MS);
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
  showHintBriefly();
}

// startAutoplay를 즉시 실행할지(autoplay 버튼으로 들어온 경우)만 다르고, 나머지
// 진입 로직(전체화면 전환 등)은 색상 버튼·수동 시작 버튼과 동일해서 하나로 씁니다.
function enterTestView(startMode, autoplay) {
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

  if (autoplay) startAutoplay();
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

// 자동 재생 버튼은 <button> 안에 <input type="number">를 직접 넣을 수 없어서(HTML
// 스펙상 버튼은 인터랙티브 콘텐츠를 못 담습니다) div+role="button"으로 만들었습니다.
// 간격 입력칸을 클릭·타이핑할 때는 버튼이 눌리면 안 되므로 클릭 대상이 입력칸이면
// 무시합니다.
autoplayBtn.addEventListener("click", (event) => {
  if (event.target === intervalInput) return;
  enterTestView(SEQUENCE[0], true);
});
autoplayBtn.addEventListener("keydown", (event) => {
  if (event.target === intervalInput) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    enterTestView(SEQUENCE[0], true);
  }
});

overlay.addEventListener("click", (event) => {
  if (event.target === exitBtn) return;
  advance(1);
});

// 마우스를 움직이는 동안에만 힌트·종료 버튼이 보이도록 합니다(동영상 플레이어의
// 컨트롤 자동 숨김과 같은 방식). 클릭·화살표 조작 시에는 advance()가 이미
// showHintBriefly()를 호출하므로, 순수 마우스 이동만 여기서 별도로 처리합니다.
overlay.addEventListener("mousemove", showHintBriefly);

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
    showHintBriefly();
  }
});

// 브라우저 자체 단축키(F11 등)나 시스템 동작으로 전체화면이 풀렸을 때도 검사 화면은
// 그대로 유지합니다 — 위에서 설명했듯 오버레이가 이미 뷰포트를 꽉 채우고 있어서
// 전체화면 여부와 무관하게 계속 검사할 수 있습니다.
