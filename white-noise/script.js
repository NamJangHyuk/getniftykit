// 백색소음 플레이어의 핵심 로직
// 실제 자연음을 녹음한 오디오 파일을 쓰지 않고, Web Audio API로 노이즈 파형 자체를
// 코드에서 직접 계산해 짧은 버퍼(2초)에 채운 뒤 loop 재생합니다. 파일이 전혀 없으므로
// 저작권 문제가 없고 네트워크 지연도 없습니다.
//   - 화이트 노이즈: 매 샘플이 완전히 독립적인 난수(모든 주파수가 균일하게 섞임)
//   - 핑크 노이즈: Paul Kellet의 근사식으로 저음이 강조되도록 난수를 여러 단계
//     저역통과 필터에 통과시킨 값들을 합산(주파수가 낮을수록 에너지가 커짐, -3dB/oct)
//   - 브라운 노이즈: 난수를 적분(누적합)해서 만드는 랜덤워크. 핑크보다도 저음이
//     훨씬 강조됨(-6dB/oct). 값이 발산하지 않도록 매 스텝마다 감쇠를 살짝 섞습니다.
//   - 심장박동 소리: 난수 기반 노이즈가 아니라, 안정 시 심박수(HEARTBEAT_BPM)에 맞춰
//     "쿵(수축기)-쾅(이완기)" 두 번의 저음 펄스를 감쇠하는 사인파로 직접 합성합니다.
//     버퍼 길이 자체를 정확히 심장박동 한 주기로 맞춰서 루프해도 박자가 끊기지 않습니다.

const HEARTBEAT_BPM = 70;

const displaySection = document.getElementById("wn-display");
const statusLabelEl = document.getElementById("wn-status-label");
const remainingEl = document.getElementById("wn-remaining");
const typeRadios = document.querySelectorAll('input[name="wn-noise-type"]');
const volumeInput = document.getElementById("wn-volume");
const autoStopSelect = document.getElementById("wn-auto-stop");
const playBtn = document.getElementById("wn-play-btn");
const stopBtn = document.getElementById("wn-stop-btn");

const READY_LABEL = displaySection.dataset.readyLabel;
const PLAYING_LABEL = displaySection.dataset.playingLabel;
const REMAINING_TEMPLATE = displaySection.dataset.remainingTemplate;

let audioCtx = null;
let sourceNode = null;
let gainNode = null;
let autoStopEndTime = 0; // 0이면 자동 종료 없음
let remainingTimer = null;

function createNoiseBuffer(ctx, type) {
  // 심장박동은 난수 노이즈가 아니라 정해진 박자를 가진 소리라서, 버퍼 길이를 다른
  // 노이즈처럼 임의로 2초 잡으면 한 박동 주기(약 0.86초)와 안 맞아떨어져 루프 지점에서
  // 박자가 어긋나는 게 들립니다. 그래서 버퍼 길이 자체를 정확히 한 주기로 맞춥니다.
  const bufferSeconds = type === "heartbeat" ? 60 / HEARTBEAT_BPM : 2;
  const bufferSize = Math.round(ctx.sampleRate * bufferSeconds);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (type === "heartbeat") {
    // "쿵"(S1, 수축기, 낮은음)과 "쾅"(S2, 이완기, 살짝 높은음) 두 펄스를 각각 감쇠하는
    // 사인파로 만듭니다. decay 값은 pulseDuration(0.12초) 시점에 진폭이 0에 가깝게
    // 줄어들도록 잡아서, 펄스 끝에서 딸깍거리는 끊김(클릭 노이즈)이 없게 했습니다.
    const pulseDuration = 0.12;
    const pulses = [
      { start: 0, freq: 55, peak: 0.9, decay: 45 },
      { start: bufferSeconds * 0.32, freq: 70, peak: 0.55, decay: 55 },
    ];
    for (let i = 0; i < bufferSize; i++) {
      const t = i / ctx.sampleRate;
      let sample = 0;
      for (const p of pulses) {
        const local = t - p.start;
        if (local >= 0 && local < pulseDuration) {
          sample += p.peak * Math.exp(-local * p.decay) * Math.sin(2 * Math.PI * p.freq * local);
        }
      }
      data[i] = sample;
    }
  } else if (type === "pink") {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
  } else if (type === "brown") {
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
  } else {
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  return buffer;
}

function currentVolume() {
  return Number(volumeInput.value) / 100;
}

function selectedNoiseType() {
  const checked = Array.from(typeRadios).find((r) => r.checked);
  return checked ? checked.value : "white";
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function updateRemainingDisplay() {
  if (autoStopEndTime === 0) {
    remainingEl.textContent = "";
    return;
  }
  const remainingMs = autoStopEndTime - Date.now();
  if (remainingMs <= 0) {
    stopPlayback();
    return;
  }
  remainingEl.textContent = REMAINING_TEMPLATE.replace("{time}", formatRemaining(remainingMs));
}

function startPlayback() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioCtx();

  const buffer = createNoiseBuffer(audioCtx, selectedNoiseType());
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = buffer;
  sourceNode.loop = true;

  gainNode = audioCtx.createGain();
  gainNode.gain.value = currentVolume();

  sourceNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  sourceNode.start();

  const autoStopMinutes = Number(autoStopSelect.value);
  autoStopEndTime = autoStopMinutes > 0 ? Date.now() + autoStopMinutes * 60000 : 0;

  displaySection.classList.add("is-playing");
  statusLabelEl.textContent = PLAYING_LABEL;
  updateRemainingDisplay();

  typeRadios.forEach((r) => (r.disabled = true));
  autoStopSelect.disabled = true;
  playBtn.hidden = true;
  stopBtn.hidden = false;

  remainingTimer = setInterval(updateRemainingDisplay, 500);
}

function stopPlayback() {
  clearInterval(remainingTimer);
  remainingTimer = null;
  autoStopEndTime = 0;

  if (sourceNode) {
    sourceNode.stop();
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (gainNode) {
    gainNode.disconnect();
    gainNode = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }

  displaySection.classList.remove("is-playing");
  statusLabelEl.textContent = READY_LABEL;
  remainingEl.textContent = "";

  typeRadios.forEach((r) => (r.disabled = false));
  autoStopSelect.disabled = false;
  playBtn.hidden = false;
  stopBtn.hidden = true;
}

volumeInput.addEventListener("input", () => {
  if (gainNode) {
    gainNode.gain.value = currentVolume();
  }
});

playBtn.addEventListener("click", startPlayback);
stopBtn.addEventListener("click", stopPlayback);
