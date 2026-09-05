// 3D 그림자 시뮬레이터(Shadow Simulator)
//
// 이 도구는 위도·경도·날짜·시각을 입력받아 그 순간 태양이 하늘의 어느 방향에
// 떠 있는지 계산한 뒤(태양 고도=altitude, 방위각=azimuth), 그 방향에서 빛을
// 쏘는 3D 조명(DirectionalLight)을 만들어서 사용자가 만든 간이 건물 모형에
// 실시간으로 그림자를 드리웁니다. 큰 흐름은 3단계입니다.
//   1) 입력값 → 건물 3D 모형 생성 (벽 4개 + 지붕 + 바닥)
//   2) 위도/경도/날짜/시각 → 태양 방향 벡터 계산 (SunCalc 라이브러리 사용)
//   3) 매 프레임 렌더링 (OrbitControls로 마우스/터치 회전 지원)
//
// 3D 렌더링은 Three.js(CDN), 태양 위치 계산은 SunCalc(CDN)를 그대로 씁니다.
// 둘 다 검증된 소형 오픈소스 라이브러리라 직접 재구현하지 않았습니다(WebGL
// 그림자 매핑이나 균시차 보정 수식을 처음부터 짜는 건 이 프로젝트 규모에 안 맞습니다).

// ---------- 건물 치수 관련 상수 ----------
var WALL_THICKNESS = 0.2; // 벽 두께(m). 그림자 정확도에 큰 영향 없어 고정값으로 둠
var ROOF_THICKNESS = 0.12; // 평지붕 슬래브 두께(m)
var WALL_COLOR = 0xe8e2d6;
var ROOF_COLOR = 0x6b4f3a;
var FLOOR_COLOR = 0xc9a876; // 실외 잔디밭과 구분되도록 실내 바닥만 따로 칠함
var GROUND_COLOR = 0x4a7c3f;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ---------- 태양 위치 계산 ----------
//
// 사용자가 입력한 "날짜+시각"은 건물이 있는 위치의 시계 시각이지만, 이 앱은
// 정식 타임존 데이터베이스(DST 포함)를 갖고 있지 않습니다. 대신 경도를 이용해
// "그 경도에서의 겉보기 태양시"로 취급합니다: 경도 15도마다 태양시는 1시간씩
// 차이 나므로, 입력 시각에서 (경도/15)시간만큼 보정하면 UTC 시각이 나옵니다.
// ponytail: 균시차(연중 최대 ±15분)와 실제 표준시(행정구역 타임존, 예: 한국은
// 135°E 기준이라 실제 경도 127°E와 30분 안팎 차이)는 무시한 근사치입니다.
// "정확히 몇 시 몇 분"보다 "이맘때 해가 어느 쪽에서 들어오는지"를 보여주는
// 용도로는 충분하지만, 분 단위 정밀 비교가 필요해지면 타임존 라이브러리를
// 추가해 실제 표준시 → 태양시 변환으로 교체해야 합니다.
function computeUtcDate(dateStr, timeStr, lonDeg) {
  if (!dateStr || !timeStr) return null;
  var dateParts = dateStr.split("-").map(Number);
  var timeParts = timeStr.split(":").map(Number);
  var utcMs =
    Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1]) -
    (lonDeg / 15) * 3600 * 1000;
  return new Date(utcMs);
}

// SunCalc가 돌려주는 azimuth(방위각)는 "남쪽=0, 서쪽으로 갈수록 +"인 라디안값이고,
// altitude(고도)는 "지평선=0, 천정=π/2"인 라디안값입니다. 이 씬의 좌표계는
// +X=동쪽, +Z=남쪽, +Y=위쪽으로 정했으므로, 구면좌표를 직교좌표로 바꿔서
// "태양이 있는 방향"을 가리키는 단위 벡터를 만듭니다.
function computeSunDirection(utcDate, lat, lonDeg) {
  var pos = SunCalc.getPosition(utcDate, lat, lonDeg);
  var cosAlt = Math.cos(pos.altitude);
  var dir = new THREE.Vector3(
    -Math.sin(pos.azimuth) * cosAlt,
    Math.sin(pos.altitude),
    Math.cos(pos.azimuth) * cosAlt
  );
  return { dir: dir, altitude: pos.altitude, azimuth: pos.azimuth };
}

// ---------- 건물 3D 모형 생성 ----------

// 사각형에서 개구부(창문/문) 자리만 구멍 뚫은 벽 한 장을 만듭니다.
// THREE.Shape(2D 외곽선) + holes(구멍)를 압출(extrude)해서 두께를 준 뒤,
// 압출은 항상 +Z 방향으로만 되므로 두께 절반만큼 뒤로 옮겨 벽이 두께
// 중심을 기준으로 배치되게 정리합니다.
function buildWallWithOpening(width, height, thickness, opening) {
  var halfWidth = width / 2;
  var shape = new THREE.Shape();
  shape.moveTo(-halfWidth, 0);
  shape.lineTo(halfWidth, 0);
  shape.lineTo(halfWidth, height);
  shape.lineTo(-halfWidth, height);
  shape.lineTo(-halfWidth, 0);

  if (opening) {
    var halfOpening = opening.width / 2;
    var hole = new THREE.Path();
    hole.moveTo(-halfOpening, opening.sill);
    hole.lineTo(halfOpening, opening.sill);
    hole.lineTo(halfOpening, opening.sill + opening.height);
    hole.lineTo(-halfOpening, opening.sill + opening.height);
    hole.lineTo(-halfOpening, opening.sill);
    shape.holes.push(hole);
  }

  var geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

// 입력값(params)을 받아 건물 전체(벽 4개 + 지붕 + 실내 바닥)를 하나의
// THREE.Group으로 조립합니다. 정면(남쪽) 벽에만 창문/문 구멍을 냅니다 —
// 남반구/북반구 어디서든 "정면이 남향"이라는 기준으로 태양 방향을 비교하기
// 위한 Phase 1 단순화이며, 벽면 방향 선택은 이후 단계에서 추가할 수 있습니다.
function buildBuilding(params) {
  var group = new THREE.Group();
  var wallMaterial = new THREE.MeshStandardMaterial({ color: WALL_COLOR });
  var roofMaterial = new THREE.MeshStandardMaterial({ color: ROOF_COLOR });
  var floorMaterial = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR });

  var halfWidth = params.width / 2;
  var halfDepth = params.depth / 2;

  var opening = {
    width: clamp(params.opening.width, 0.3, params.width - 0.4),
    height: clamp(params.opening.height, 0.3, params.height - params.opening.sill - 0.1),
    sill: params.opening.sill,
  };

  var southWall = new THREE.Mesh(
    buildWallWithOpening(params.width, params.height, WALL_THICKNESS, opening),
    wallMaterial
  );
  southWall.position.set(0, 0, halfDepth);
  southWall.castShadow = true;
  southWall.receiveShadow = true;
  group.add(southWall);

  var northWall = new THREE.Mesh(
    new THREE.BoxGeometry(params.width, params.height, WALL_THICKNESS),
    wallMaterial
  );
  northWall.position.set(0, params.height / 2, -halfDepth);
  northWall.castShadow = true;
  northWall.receiveShadow = true;
  group.add(northWall);

  var eastWall = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, params.height, params.depth),
    wallMaterial
  );
  eastWall.position.set(halfWidth, params.height / 2, 0);
  eastWall.castShadow = true;
  eastWall.receiveShadow = true;
  group.add(eastWall);

  var westWall = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, params.height, params.depth),
    wallMaterial
  );
  westWall.position.set(-halfWidth, params.height / 2, 0);
  westWall.castShadow = true;
  westWall.receiveShadow = true;
  group.add(westWall);

  // 처마 길이(eave)만큼 지붕을 벽 바깥으로 더 넓게 만듭니다.
  var roof = new THREE.Mesh(
    new THREE.BoxGeometry(params.width + params.eave * 2, ROOF_THICKNESS, params.depth + params.eave * 2),
    roofMaterial
  );
  roof.position.set(0, params.height + ROOF_THICKNESS / 2, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  var floor = new THREE.Mesh(
    new THREE.PlaneGeometry(params.width - WALL_THICKNESS, params.depth - WALL_THICKNESS),
    floorMaterial
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.011; // 바깥 지면과 겹쳐 깜빡이지(z-fighting) 않도록 살짝 띄움
  floor.receiveShadow = true;
  group.add(floor);

  group.userData.southWall = southWall;
  group.userData.roof = roof;
  return group;
}

function disposeGroup(group) {
  group.traverse(function (obj) {
    if (!obj.isMesh) return;
    obj.geometry.dispose();
    if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose(); });
    else obj.material.dispose();
  });
}

// ---------- 나침반 라벨 ----------
// 별도 폰트를 CDN으로 받아 3D 텍스트를 렌더링하는 대신, 2D 캔버스에 글자를 그려
// 텍스처로 쓰는 훨씬 가벼운 방법(Sprite)을 씁니다.
function makeCompassSprite(text) {
  var canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  var ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 76px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 68);
  var sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })
  );
  sprite.scale.set(1.6, 1.6, 1.6);
  return sprite;
}

// 하늘에서 태양 위치를 보여주는 거리(반지름). 그림자 계산용 빛의 실제 위치와는
// 별개로, "눈에 보이는 태양 표시"만을 위한 값입니다.
var SUN_MARKER_RADIUS = 25;

// 태양 자리를 은은하게 빛나는 원(광원 아이콘)으로 표시합니다. 캔버스에 방사형
// 그라디언트를 그려 텍스처로 쓰는 방식이라 별도 이미지 파일이 필요 없습니다.
function makeSunSprite() {
  var canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  var ctx = canvas.getContext("2d");
  var gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,244,196,1)");
  gradient.addColorStop(0.35, "rgba(255,209,102,0.95)");
  gradient.addColorStop(1, "rgba(255,209,102,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false })
  );
}

// 태양 방향 벡터(원점 기준 단위벡터)를 받아 "태양 → 건물"로 이어지는 얇은 빛줄기
// 선을 만듭니다. 매 시각 변경마다 두 점(태양 위치, 건물 중심)만 다시 계산해 넣습니다.
function makeSunRay() {
  var geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  var material = new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 });
  return new THREE.Line(geometry, material);
}

// 특정 날짜·위도·경도에서 하루 동안 태양이 지나가는 궤적(해가 떠 있는 구간만)을
// 15분 간격으로 샘플링해 곡선 점 목록을 만듭니다. 시각(time)이 아니라 날짜/위치가
// 바뀔 때만 다시 계산하면 되므로 updateSun()과는 별도 함수로 둡니다.
function buildSunPathPoints(lat, lon, dateStr) {
  var points = [];
  for (var minutes = 0; minutes <= 1440; minutes += 15) {
    var hh = Math.floor(minutes / 60);
    var mm = minutes % 60;
    var utcDate = computeUtcDate(dateStr, pad2(hh) + ":" + pad2(mm), lon);
    var pos = SunCalc.getPosition(utcDate, lat, lon);
    if (pos.altitude <= 0) continue;
    var cosAlt = Math.cos(pos.altitude);
    var dir = new THREE.Vector3(-Math.sin(pos.azimuth) * cosAlt, Math.sin(pos.altitude), Math.cos(pos.azimuth) * cosAlt);
    points.push(dir.multiplyScalar(SUN_MARKER_RADIUS));
  }
  return points;
}

function addCompass(scene, container) {
  var radius = 14;
  var labels = [
    { text: container.dataset.compassN || "N", pos: [0, 0.7, -radius] },
    { text: container.dataset.compassS || "S", pos: [0, 0.7, radius] },
    { text: container.dataset.compassE || "E", pos: [radius, 0.7, 0] },
    { text: container.dataset.compassW || "W", pos: [-radius, 0.7, 0] },
  ];
  labels.forEach(function (item) {
    var sprite = makeCompassSprite(item.text);
    sprite.position.set(item.pos[0], item.pos[1], item.pos[2]);
    scene.add(sprite);
  });
}

// ---------- DOM 참조 ----------
var widthInput = document.getElementById("ss-width");
var depthInput = document.getElementById("ss-depth");
var heightInput = document.getElementById("ss-height");
var eaveInput = document.getElementById("ss-eave");

var openingWindowRadio = document.getElementById("ss-opening-window");
var openingDoorRadio = document.getElementById("ss-opening-door");
var openingWidthInput = document.getElementById("ss-opening-width");
var openingHeightInput = document.getElementById("ss-opening-height");
var openingSillInput = document.getElementById("ss-opening-sill");
var openingSillField = document.getElementById("ss-opening-sill-field");

var addressInput = document.getElementById("ss-address");
var addressSearchBtn = document.getElementById("ss-address-search");
var addressErrorEl = document.getElementById("ss-address-error");

var latInput = document.getElementById("ss-lat");
var lonInput = document.getElementById("ss-lon");
var useLocationBtn = document.getElementById("ss-use-location");
var geolocationErrorEl = document.getElementById("ss-geolocation-error");
var dateInput = document.getElementById("ss-date");
var timeInput = document.getElementById("ss-time");
var presetNowBtn = document.getElementById("ss-preset-now");
var presetEquinoxBtn = document.getElementById("ss-preset-equinox");
var presetSummerBtn = document.getElementById("ss-preset-summer");
var presetWinterBtn = document.getElementById("ss-preset-winter");
var timeSliderInput = document.getElementById("ss-time-slider");

var hideRoofCheckbox = document.getElementById("ss-hide-roof");
var hideFrontWallCheckbox = document.getElementById("ss-hide-front-wall");

var container = document.getElementById("ss-canvas-container");
var fallbackEl = document.getElementById("ss-fallback");
var altitudeValueEl = document.getElementById("ss-info-altitude");
var azimuthValueEl = document.getElementById("ss-info-azimuth");
var nightBadgeEl = document.getElementById("ss-night-badge");

// ---------- Three.js 씬 초기화 ----------
var sceneCtx = null;

function initScene() {
  if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined" || typeof SunCalc === "undefined") {
    fallbackEl.hidden = false;
    return null;
  }

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ecae6);

  var camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 500);
  camera.position.set(12, 9, 14);

  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // 카메라가 지면 아래로 못 가게 제한
  controls.minDistance = 4;
  controls.maxDistance = 60;
  controls.update();

  var ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  var sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  // 벽↔바닥, 지붕↔벽처럼 수직으로 맞닿은 면 사이에 그림자가 붙지 못하고 살짝 떨어져
  // 보이는 "피터패닝" 현상을 막기 위해, 빛 방향이 아니라 표면 법선 방향으로 살짝
  // 오프셋을 주는 normalBias를 씁니다. depth bias(shadow.bias)만으로는 이런 직각
  // 접합부의 그림자가 잘 붙지 않아 접합선이 그대로 밝게 남는 문제가 있었습니다.
  sun.shadow.bias = -0.0001;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  var ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: GROUND_COLOR })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  addCompass(scene, container);

  var sunMarker = makeSunSprite();
  sunMarker.scale.set(4, 4, 4);
  scene.add(sunMarker);

  var sunRay = makeSunRay();
  scene.add(sunRay);

  var sunPathLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffe8a3, transparent: true, opacity: 0.6 })
  );
  scene.add(sunPathLine);

  return {
    scene: scene,
    camera: camera,
    renderer: renderer,
    controls: controls,
    sun: sun,
    sunMarker: sunMarker,
    sunRay: sunRay,
    sunPathLine: sunPathLine,
    buildingGroup: null,
  };
}

// ---------- 입력값 읽기 ----------
function readBuildingParams() {
  var isWindow = openingWindowRadio.checked;
  return {
    width: clamp(parseFloat(widthInput.value) || 6, 1, 30),
    depth: clamp(parseFloat(depthInput.value) || 5, 1, 30),
    height: clamp(parseFloat(heightInput.value) || 2.8, 1.5, 10),
    eave: clamp(parseFloat(eaveInput.value) || 0, 0, 3),
    opening: {
      width: clamp(parseFloat(openingWidthInput.value) || 1.5, 0.3, 10),
      height: clamp(parseFloat(openingHeightInput.value) || 1.2, 0.3, 8),
      sill: isWindow ? clamp(parseFloat(openingSillInput.value) || 0.9, 0, 5) : 0,
    },
  };
}

function rebuildBuilding() {
  if (!sceneCtx) return;
  var params = readBuildingParams();

  if (sceneCtx.buildingGroup) {
    sceneCtx.scene.remove(sceneCtx.buildingGroup);
    disposeGroup(sceneCtx.buildingGroup);
  }

  var group = buildBuilding(params);
  group.userData.roof.visible = !hideRoofCheckbox.checked;
  group.userData.southWall.visible = !hideFrontWallCheckbox.checked;
  sceneCtx.scene.add(group);
  sceneCtx.buildingGroup = group;
  sceneCtx.controls.target.set(0, params.height / 2, 0);

  // 그림자를 뿌리는 카메라(빛이 담당하는 그림자 계산 범위)를 건물 크기에 맞게 넓힙니다.
  // 너무 좁으면 그림자가 잘리고, 너무 넓으면 그림자 해상도가 흐려집니다.
  var span = Math.max(params.width, params.depth) * 0.9 + 4;
  var shadowCam = sceneCtx.sun.shadow.camera;
  shadowCam.left = -span;
  shadowCam.right = span;
  shadowCam.top = span;
  shadowCam.bottom = -span;
  shadowCam.updateProjectionMatrix();

  updateSun();
}

function updateSun() {
  if (!sceneCtx || !dateInput.value || !timeInput.value) return;
  var lat = clamp(parseFloat(latInput.value) || 0, -90, 90);
  var lon = clamp(parseFloat(lonInput.value) || 0, -180, 180);
  var utcDate = computeUtcDate(dateInput.value, timeInput.value, lon);
  var result = computeSunDirection(utcDate, lat, lon);
  var isNight = result.altitude <= 0;

  altitudeValueEl.textContent = (result.altitude * 180 / Math.PI).toFixed(1) + "°";
  azimuthValueEl.textContent = (result.azimuth * 180 / Math.PI).toFixed(1) + "°";
  nightBadgeEl.hidden = !isNight;

  var target = sceneCtx.controls.target;
  var distance = 30;
  sceneCtx.sun.position.set(
    target.x + result.dir.x * distance,
    target.y + result.dir.y * distance,
    target.z + result.dir.z * distance
  );
  sceneCtx.sun.target.position.copy(target);
  sceneCtx.sun.target.updateMatrixWorld();
  sceneCtx.sun.intensity = isNight ? 0 : 1.1;
  sceneCtx.sun.castShadow = !isNight;

  // 눈에 보이는 태양 표시(빛나는 원)와 태양→건물 방향 빛줄기를 실제 그림자를
  // 만드는 조명과 같은 방향으로 맞춰줍니다. 밤에는 둘 다 숨깁니다.
  var markerPos = new THREE.Vector3(
    target.x + result.dir.x * SUN_MARKER_RADIUS,
    target.y + result.dir.y * SUN_MARKER_RADIUS,
    target.z + result.dir.z * SUN_MARKER_RADIUS
  );
  sceneCtx.sunMarker.position.copy(markerPos);
  sceneCtx.sunMarker.visible = !isNight;
  sceneCtx.sunRay.visible = !isNight;
  sceneCtx.sunRay.geometry.setFromPoints([markerPos, target]);

  syncTimeSlider();
}

// 날짜·위도·경도가 바뀔 때만 호출합니다(시각만 바뀔 때는 궤적 자체는 그대로라
// 다시 계산할 필요가 없습니다). 하루 동안 해가 지나가는 길을 얇은 곡선으로 보여줍니다.
function updateSunPath() {
  if (!sceneCtx || !dateInput.value) return;
  var lat = clamp(parseFloat(latInput.value) || 0, -90, 90);
  var lon = clamp(parseFloat(lonInput.value) || 0, -180, 180);
  var points = buildSunPathPoints(lat, lon, dateInput.value);
  sceneCtx.sunPathLine.geometry.dispose();
  sceneCtx.sunPathLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
}

// ---------- 이벤트 연결 ----------
function updateOpeningTypeUI() {
  openingSillField.hidden = openingDoorRadio.checked;
}

[widthInput, depthInput, heightInput, eaveInput, openingWidthInput, openingHeightInput, openingSillInput].forEach(
  function (input) {
    input.addEventListener("input", rebuildBuilding);
  }
);

[openingWindowRadio, openingDoorRadio].forEach(function (radio) {
  radio.addEventListener("change", function () {
    updateOpeningTypeUI();
    rebuildBuilding();
  });
});

[latInput, lonInput, dateInput].forEach(function (input) {
  input.addEventListener("input", function () {
    updateSunPath();
    updateSun();
  });
});
timeInput.addEventListener("input", updateSun);

function minutesToHHMM(totalMinutes) {
  return pad2(Math.floor(totalMinutes / 60)) + ":" + pad2(totalMinutes % 60);
}

function hhmmToMinutes(hhmm) {
  var parts = hhmm.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

// 시간 입력칸(HH:MM)과 슬라이더는 서로의 값을 계속 반영해야 합니다. updateSun()이
// 호출될 때마다 슬라이더 위치를 시간 입력값에 맞춰두면(syncTimeSlider), 프리셋
// 버튼이나 직접 타이핑으로 시각이 바뀌어도 슬라이더가 항상 따라옵니다.
function syncTimeSlider() {
  if (!timeInput.value) return;
  timeSliderInput.value = hhmmToMinutes(timeInput.value);
}

timeSliderInput.addEventListener("input", function () {
  timeInput.value = minutesToHHMM(parseInt(timeSliderInput.value, 10));
  updateSun();
});

hideRoofCheckbox.addEventListener("change", function () {
  if (sceneCtx && sceneCtx.buildingGroup) sceneCtx.buildingGroup.userData.roof.visible = !hideRoofCheckbox.checked;
});
hideFrontWallCheckbox.addEventListener("change", function () {
  if (sceneCtx && sceneCtx.buildingGroup) {
    sceneCtx.buildingGroup.userData.southWall.visible = !hideFrontWallCheckbox.checked;
  }
});

// 주소 → 좌표 변환(geocoding)입니다. 이 사이트는 서버가 없으므로, API 키 없이
// 브라우저에서 바로 호출 가능한 OpenStreetMap의 Nominatim 검색 API를 씁니다.
// 이 요청은 이 도구에서 유일하게 외부 서버로 데이터(입력한 주소)를 보내는
// 부분이라, privacyNote와 화면 안내 문구에 그 사실을 명시해뒀습니다.
async function searchAddress() {
  var query = addressInput.value.trim();
  if (!query) return;
  addressErrorEl.hidden = true;
  addressSearchBtn.disabled = true;
  try {
    var response = await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(query)
    );
    var results = await response.json();
    if (!results || !results.length) {
      addressErrorEl.hidden = false;
      return;
    }
    latInput.value = parseFloat(results[0].lat).toFixed(4);
    lonInput.value = parseFloat(results[0].lon).toFixed(4);
    updateSunPath();
    updateSun();
  } catch (err) {
    addressErrorEl.hidden = false;
  } finally {
    addressSearchBtn.disabled = false;
  }
}

addressSearchBtn.addEventListener("click", searchAddress);
addressInput.addEventListener("keydown", function (event) {
  if (event.key === "Enter") searchAddress();
});

useLocationBtn.addEventListener("click", function () {
  geolocationErrorEl.hidden = true;
  if (!navigator.geolocation) {
    geolocationErrorEl.hidden = false;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (position) {
      latInput.value = position.coords.latitude.toFixed(4);
      lonInput.value = position.coords.longitude.toFixed(4);
      updateSunPath();
      updateSun();
    },
    function () {
      geolocationErrorEl.hidden = false;
    },
    { timeout: 8000 }
  );
});

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

function setDateAndTime(year, month, day, hour, minute) {
  dateInput.value = year + "-" + pad2(month) + "-" + pad2(day);
  timeInput.value = pad2(hour) + ":" + pad2(minute);
  updateSunPath();
  updateSun();
}

presetNowBtn.addEventListener("click", function () {
  var now = new Date();
  setDateAndTime(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes());
});
// 춘분/하지/동지 날짜는 해마다 하루 정도 앞뒤로 움직이는데, 이 앱은 "대략 이맘때"를
// 빠르게 보여주는 버튼이라 매년 거의 같은 날짜(3/20, 6/21, 12/21)로 고정했습니다.
presetEquinoxBtn.addEventListener("click", function () {
  setDateAndTime(new Date().getFullYear(), 3, 20, 12, 0);
});
presetSummerBtn.addEventListener("click", function () {
  setDateAndTime(new Date().getFullYear(), 6, 21, 12, 0);
});
presetWinterBtn.addEventListener("click", function () {
  setDateAndTime(new Date().getFullYear(), 12, 21, 12, 0);
});

// ---------- 렌더 루프 ----------
function animate() {
  requestAnimationFrame(animate);
  if (!sceneCtx) return;
  sceneCtx.controls.update();
  sceneCtx.renderer.render(sceneCtx.scene, sceneCtx.camera);
}

window.addEventListener("resize", function () {
  if (!sceneCtx) return;
  var w = container.clientWidth;
  var h = container.clientHeight;
  sceneCtx.camera.aspect = w / h;
  sceneCtx.camera.updateProjectionMatrix();
  sceneCtx.renderer.setSize(w, h);
});

// ---------- 초기 실행 ----------
(function init() {
  // 처음 열었을 때 바로 그림자가 보이도록 오늘 날짜 + 정오로 기본값을 채웁니다.
  var now = new Date();
  dateInput.value = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
  timeInput.value = "12:00";

  updateOpeningTypeUI();
  sceneCtx = initScene();
  if (!sceneCtx) return;
  updateSunPath();
  rebuildBuilding();
  animate();
})();
