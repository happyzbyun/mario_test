// 메인 루프, 게임 상태 머신, 렌더링.
// 고정 시간 단계(60Hz) 업데이트 + requestAnimationFrame 렌더.
const VIEW_W = 800;
const VIEW_H = 450;
const STEP_MS = 1000 / 60;
const GOAL_M = Math.round(STAGES[0].goalX / PX_PER_M); // 목표 거리(m). 모든 스테이지가 500m
const GROUND_Y = STAGES[0].groundTopRow * TILE;
const EFFECT_FRAMES = 30;          // 밟힌 버섯 연출 길이
const NEXT_STAGE_FRAMES = 180;     // 스테이지 클리어 후 다음 스테이지까지 (3초, F-46)
const TO_TITLE_FRAMES = 360;       // 전체 클리어 후 시작 화면까지 (6초, F-47)
const STAGE_INTRO_MS = 2200;       // 스테이지 시작 시 이름 안내 (F-49)

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const saveBtn = document.getElementById('saveBtn');

const map = new GameMap(STAGES[0]);
const camera = new Camera(VIEW_W, VIEW_H);
const player = new Player(STAGES[0].playerSpawnX, GROUND_Y - PLAYER_H);
let enemies = [];
let items = [];           // 물음표 블록에서 나온 파워 열매 (F-38)
let effects = [];         // 밟힌 버섯 / 열매 먹기 연출 (외형 전용, 충돌 없음)

// ---- 게임 상태 ----
// 'title' | 'select' | 'playing' | 'paused' | 'gameover' | 'clear'(스테이지 클리어) | 'allclear'(전체 클리어)
let state = 'title';
let menuIndex = 0;
let selectIndex = 0;
let stageIndex = 0;       // 현재 스테이지 (0부터)
let elapsed = 0;          // 현재 스테이지 플레이 시간(초). playing 상태에서만 흐른다.
let totalBefore = 0;      // 앞 스테이지들의 클리어 시간 합(초)
let runStageTimes = [];   // 이번 판의 스테이지별 클리어 시간 (전체 클리어 화면용)
let clearFrames = 0;      // 클리어 화면이 떠 있는 프레임 수 (자동 진행용)
let newStageRecord = false;
let newTotalRecord = false;
let saveInfo = null;      // 유효한 저장 데이터 (없으면 null)
let best = { total: null, stages: [] };
let toast = { text: '', until: 0 };
let assetsReady = false;  // 캐릭터 이미지 preload 가 끝나야 입력을 받는다 (13.4)
let stageIntroAt = -Infinity;

function refreshStoreInfo() {
  saveInfo = Store.loadSave();
  best = Store.loadBest();
}

function showToast(text) {
  toast = { text, until: performance.now() + 1800 };
}

// ---- 스테이지 / 월드 초기화 ----
function loadStage(i) {
  stageIndex = i;
  map.load(STAGES[i]);
  applyTheme(STAGES[i].theme); // F-45 (렌더 쪽)
}

// 현재 스테이지를 처음 상태로. keepBig 이면 커진 상태를 이어 간다 (F-46)
function resetWorld(keepBig) {
  const wasBig = player.big || player.pendingGrow;
  player.reset();
  player.character = CHARACTERS[selectIndex].id;
  enemies = map.def.enemies.map(([col, row], i) => Enemy.fromSpawn(i + 1, col, row, map.def.enemySpeed));
  items = [];
  effects = [];
  map.build(); // 물음표 블록 되살리기
  if (keepBig && wasBig) player.setBig(true, map);
  elapsed = 0;
  clearFrames = 0;
  jumpRequested = false;
  camera.follow(player, map.width);
}

function startStage(i, keepBig) {
  loadStage(i);
  resetWorld(keepBig);
  stageIntroAt = performance.now();
  state = 'playing';
}

// 새 게임: 1 스테이지부터 (F-43)
function startNewRun() {
  totalBefore = 0;
  runStageTimes = [];
  startStage(0, false);
}

// GAME OVER 후 다시 시작: 현재 스테이지 처음부터, 작은 상태로 (F-48)
function retryStage() {
  startStage(stageIndex, false);
}

function nextStage() {
  startStage(stageIndex + 1, true);
}

function distanceM() {
  return Math.min(GOAL_M, Math.max(0, Math.floor(player.x / PX_PER_M)));
}

// ---- 저장 / 불러오기 (F-22 ~ F-27, F-42, F-50) ----
function doSave() {
  if (!Store.available()) { showToast('저장소를 사용할 수 없어 저장하지 못했습니다'); return; }
  const data = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    character: player.character,
    player: { x: player.x, y: player.y, big: player.big || player.pendingGrow },
    stage: stageIndex + 1,
    distance: distanceM(),
    elapsedSec: elapsed,
    totalSec: totalBefore,
    enemies: enemies.map((e) => e.toJSON()),
    usedBlocks: map.usedBlocks(),
    items: items.map((it) => it.toJSON())
  };
  if (Store.writeSave(data)) { saveInfo = data; showToast('저장했습니다'); }
  else showToast('저장에 실패했습니다');
}

function continueFromSave() {
  const data = Store.loadSave();
  if (!data) { saveInfo = null; showToast('불러올 저장 데이터가 없습니다'); return; }
  selectIndex = characterIndex(data.character);
  totalBefore = data.totalSec || 0;
  runStageTimes = [];
  loadStage((data.stage || 1) - 1);
  resetWorld(false);
  map.applyUsedBlocks(data.usedBlocks || []);
  if (data.player.big === true) {
    player.big = true;
    player.w = PLAYER_BIG_W;
    player.h = PLAYER_BIG_H;
  }
  player.x = data.player.x;
  player.y = data.player.y;
  elapsed = data.elapsedSec;
  enemies = data.enemies.filter((e) => e.alive).map((e) => Enemy.fromSave(e, map.def.enemySpeed));
  items = (data.items || []).map((it) => Item.fromSave(it));
  camera.follow(player, map.width);
  stageIntroAt = performance.now();
  state = 'playing';
}

function goTitle() {
  refreshStoreInfo();
  menuIndex = 0;
  selectIndex = characterIndex(Store.loadChar());
  totalBefore = 0;
  loadStage(0);
  resetWorld(false);
  state = 'title';
}

function openSelect() {
  selectIndex = characterIndex(Store.loadChar());
  state = 'select';
}

function confirmSelect() {
  Store.saveChar(CHARACTERS[selectIndex].id);
  startNewRun();
}

// ---- 메뉴 ----
function titleItems() {
  return [
    { label: '새 게임', enabled: true, run: openSelect },
    { label: '이어하기', enabled: saveInfo !== null, run: continueFromSave },
    { label: '저장 데이터 삭제', enabled: saveInfo !== null, run: () => { Store.clearSave(); refreshStoreInfo(); menuIndex = 0; showToast('저장 데이터를 삭제했습니다'); } }
  ];
}
function pauseItems() {
  return [
    { label: '계속하기', enabled: true, run: () => { state = 'playing'; } },
    { label: '저장 (S)', enabled: true, run: doSave },
    { label: '처음으로', enabled: true, run: goTitle }
  ];
}
function gameoverItems() {
  return [
    { label: '다시 시작 (R)', enabled: true, run: retryStage },
    { label: '저장에서 이어하기 (C)', enabled: saveInfo !== null, run: continueFromSave },
    { label: '처음 화면 (T)', enabled: true, run: goTitle }
  ];
}
function clearItems() {
  return [
    { label: '다음 스테이지 (Enter)', enabled: true, run: nextStage },
    { label: '처음 화면 (T)', enabled: true, run: goTitle }
  ];
}
function allClearItems() {
  return [
    { label: '시작 화면으로 (Enter)', enabled: true, run: goTitle }
  ];
}
function currentItems() {
  switch (state) {
    case 'title': return titleItems();
    case 'paused': return pauseItems();
    case 'gameover': return gameoverItems();
    case 'clear': return clearItems();
    case 'allclear': return allClearItems();
    default: return [];
  }
}
function moveMenu(dir) {
  const items = currentItems();
  for (let i = 1; i <= items.length; i++) {
    const idx = (menuIndex + dir * i + items.length * i) % items.length;
    if (items[idx].enabled) { menuIndex = idx; return; }
  }
}
function activateMenu() {
  const item = currentItems()[menuIndex];
  if (item && item.enabled) item.run();
}

// ---- 입력 ----
const keys = { left: false, right: false, jump: false };
let jumpRequested = false;
const PREVENT = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

window.addEventListener('keydown', (e) => {
  if (PREVENT.includes(e.code)) e.preventDefault();
  if (e.code === 'ArrowLeft') keys.left = true;
  else if (e.code === 'ArrowRight') keys.right = true;
  else if (e.code === 'Space') {
    if (!keys.jump && state === 'playing') jumpRequested = true; // 누른 순간에만 점프 (꾹 눌러도 연속 점프 없음)
    keys.jump = true;
  }
  if (!e.repeat && assetsReady) onKeyPress(e.code);
});
window.addEventListener('keyup', (e) => {
  if (PREVENT.includes(e.code)) e.preventDefault();
  if (e.code === 'ArrowLeft') keys.left = false;
  else if (e.code === 'ArrowRight') keys.right = false;
  else if (e.code === 'Space') keys.jump = false;
});
// 포커스를 잃으면 눌린 키가 남지 않도록 초기화
window.addEventListener('blur', () => {
  keys.left = keys.right = keys.jump = false;
  jumpRequested = false;
  if (typeof releaseTouches === 'function') releaseTouches();
});

function onKeyPress(code) {
  switch (state) {
    case 'title':
      if (code === 'ArrowUp') moveMenu(-1);
      else if (code === 'ArrowDown') moveMenu(1);
      else if (code === 'Enter') activateMenu();
      break;
    case 'select':
      if (code === 'ArrowLeft') selectIndex = (selectIndex + CHARACTERS.length - 1) % CHARACTERS.length;
      else if (code === 'ArrowRight') selectIndex = (selectIndex + 1) % CHARACTERS.length;
      else if (code === 'Enter') confirmSelect();
      else if (code === 'Escape') state = 'title';
      break;
    case 'playing':
      if (code === 'KeyS') doSave();
      else if (code === 'KeyP' || code === 'Escape') { state = 'paused'; menuIndex = 0; }
      break;
    case 'paused':
      if (code === 'KeyP' || code === 'Escape') state = 'playing';
      else if (code === 'ArrowUp') moveMenu(-1);
      else if (code === 'ArrowDown') moveMenu(1);
      else if (code === 'Enter') activateMenu();
      else if (code === 'KeyS') doSave();
      break;
    case 'gameover':
      if (code === 'KeyR') retryStage();
      else if (code === 'KeyT') goTitle();
      else if (code === 'KeyC' && saveInfo) continueFromSave();
      else if (code === 'ArrowUp') moveMenu(-1);
      else if (code === 'ArrowDown') moveMenu(1);
      else if (code === 'Enter') activateMenu();
      break;
    case 'clear':
    case 'allclear':
      if (code === 'KeyT') goTitle();
      else if (code === 'ArrowUp') moveMenu(-1);
      else if (code === 'ArrowDown') moveMenu(1);
      else if (code === 'Enter') activateMenu();
      break;
  }
}

// 저장 버튼 (F-24). 포커스가 남아 Space/Enter 로 눌리지 않도록 바로 blur 한다.
saveBtn.addEventListener('click', () => {
  saveBtn.blur();
  if (state === 'playing' || state === 'paused') doSave();
});

// ---- 마우스: 캔버스에 그린 버튼/카드 ----
// 매 렌더마다 클릭 가능한 영역을 다시 등록한다. 좌표는 800x450 논리 좌표.
let hitAreas = [];
let hitState = null; // hitAreas 를 그린 시점의 상태. 화면이 바뀐 직후의 클릭이 이전 화면 버튼을 누르지 않게 한다.
function addHit(x, y, w, h, enabled, onClick, onHover) {
  hitAreas.push({ x, y, w, h, enabled, onClick, onHover });
}
function toView(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * VIEW_W / r.width, y: (e.clientY - r.top) * VIEW_H / r.height };
}
function hitAt(p) {
  if (hitState !== state) return null;
  for (let i = hitAreas.length - 1; i >= 0; i--) {
    const a = hitAreas[i];
    if (p.x >= a.x && p.x < a.x + a.w && p.y >= a.y && p.y < a.y + a.h) return a;
  }
  return null;
}
canvas.addEventListener('mousemove', (e) => {
  const a = assetsReady ? hitAt(toView(e)) : null;
  canvas.style.cursor = a && a.enabled ? 'pointer' : 'default';
  if (a && a.enabled && a.onHover) a.onHover();
});
canvas.addEventListener('click', (e) => {
  if (!assetsReady) return;
  const a = hitAt(toView(e));
  if (a && a.enabled && a.onClick) a.onClick();
});

// ---- 터치 조작 (F-56 ~ F-59) ----
// 터치가 가능한 기기면 처음부터, 아니면 터치 입력이 처음 들어올 때 켠다. 마우스 클릭은 점프로 쓰지 않는다.
let touchMode = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
const touchHold = { left: false, right: false };
const touchPointers = new Map(); // pointerId -> 'left' | 'right' | 'jump' | 'ui' | 'none'

// ◀ ▶ 버튼 위치와 크기 (논리 좌표). 화면이 작아도 실제 지름이 약 60px 이상이 되게 키운다.
function touchButtons() {
  const r = Math.max(40, 30 / cssScale);
  const y = VIEW_H - 14 - r;
  return { r, left: { x: 14 + r, y }, right: { x: 14 + r * 3 + 16, y } };
}
function touchZone(p) {
  const b = touchButtons();
  const near = (c) => Math.hypot(p.x - c.x, p.y - c.y) <= b.r * 1.15;
  if (near(b.left)) return 'left';
  if (near(b.right)) return 'right';
  return 'jump';
}
function refreshTouchHold() {
  touchHold.left = touchHold.right = false;
  for (const z of touchPointers.values()) {
    if (z === 'left') touchHold.left = true;
    else if (z === 'right') touchHold.right = true;
  }
}
function releaseTouches() {
  touchPointers.clear();
  refreshTouchHold();
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  touchMode = true;
  if (!assetsReady || state !== 'playing') return; // 메뉴·선택 화면은 click 으로 처리
  e.preventDefault();
  const p = toView(e);
  if (hitAt(p)) { touchPointers.set(e.pointerId, 'ui'); return; } // 일시정지 버튼 등은 click 이 처리
  const z = touchZone(p);
  touchPointers.set(e.pointerId, z);
  if (z === 'jump') jumpRequested = true; // F-57: 버튼 밖 터치 = 점프 (점프 버퍼가 착지 직전 입력도 받아 준다)
  refreshTouchHold();
});
canvas.addEventListener('pointermove', (e) => {
  const cur = touchPointers.get(e.pointerId);
  if (cur === undefined || cur === 'ui' || cur === 'jump') return;
  // F-56: 이동 버튼 사이로 미끄러뜨리면 방향 전환, 버튼 밖으로 나가면 정지 (새 점프는 만들지 않음)
  const z = touchZone(toView(e));
  touchPointers.set(e.pointerId, z === 'jump' ? 'none' : z);
  refreshTouchHold();
});
for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, (e) => {
    if (!touchPointers.delete(e.pointerId)) return;
    refreshTouchHold();
  });
}

// ---- 업데이트 ----
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function die() { state = 'gameover'; menuIndex = 0; }

// GOAL 도달 (F-16, F-46, F-47)
function clearStage() {
  menuIndex = 0;
  clearFrames = 0;
  runStageTimes[stageIndex] = elapsed;
  totalBefore += elapsed;
  newStageRecord = Store.submitStageTime(stageIndex, elapsed);
  if (stageIndex === STAGE_COUNT - 1) {
    newTotalRecord = Store.submitTotalTime(totalBefore);
    // F-47: 게임을 끝까지 깼으면 진행 저장 데이터를 지운다 (최고 기록·마지막 캐릭터는 유지)
    Store.clearSave();
    saveInfo = null;
    state = 'allclear';
  } else {
    newTotalRecord = false;
    state = 'clear';
  }
  best = Store.loadBest();
}

function update() {
  // 클리어 화면: 일정 시간이 지나면 자동으로 다음 스테이지 / 시작 화면
  if (state === 'clear' || state === 'allclear') {
    clearFrames++;
    if (state === 'clear' && clearFrames >= NEXT_STAGE_FRAMES) nextStage();
    else if (state === 'allclear' && clearFrames >= TO_TITLE_FRAMES) goTitle();
    jumpRequested = false;
    return;
  }
  if (state !== 'playing') { jumpRequested = false; return; }

  const prevBottom = player.y + player.h;
  player.update({ left: keys.left || touchHold.left, right: keys.right || touchHold.right, jumpPressed: jumpRequested }, map);
  jumpRequested = false;
  map.update(); // 블록 튕김 애니메이션

  // 물음표 블록을 쳤으면 파워 열매를 꺼낸다 (F-38)
  for (const [c, r] of map.hitQBlocks) items.push(new Item(c, r));
  map.hitQBlocks = [];

  for (const e of enemies) if (e.isActive(camera.x)) e.update(map);
  resolveEnemyCollisions(enemies); // F-51
  for (const it of items) it.update(map);

  // 플레이어 vs 파워 열매 (F-40). 다 솟아 나온 뒤에만 먹을 수 있다.
  for (const it of items) {
    if (!it.alive || it.rising || !overlaps(player, it)) continue;
    it.alive = false;
    player.powerUp(map);
    effects.push({ kind: 'power', x: player.x, y: player.y, w: player.w, h: player.h, t: 0 });
  }
  items = items.filter((it) => it.alive);

  // 플레이어 vs 버섯 (F-12, F-13): 하강 중 윗면을 밟으면 버섯 제거, 그 외 접촉은 사망
  for (const e of enemies) {
    if (!e.alive || !overlaps(player, e)) continue;
    const bottom = player.y + player.h;
    const stomp = player.fallSpeed > 0 &&
      (bottom <= e.y + e.h * 0.4 || prevBottom <= e.y + 2); // 빠르게 떨어져 영역을 지나친 경우도 밟은 것으로 본다
    if (stomp) {
      e.alive = false;
      effects.push({ kind: 'stomp', x: e.x, y: e.y, w: e.w, h: e.h, dir: e.dir, t: 0 }); // 납작해졌다 사라지는 연출
      player.vy = PHYSICS.stompBounce;
      player.onGround = false;
    } else if (player.hurt()) { // 커진 상태면 작아지고 무적, 작은 상태면 사망 (F-41)
      die();
      break;
    }
  }
  enemies = enemies.filter((e) => e.alive);
  for (const f of effects) f.t++;
  effects = effects.filter((f) => f.t < EFFECT_FRAMES);

  elapsed += STEP_MS / 1000;
  camera.follow(player, map.width);
  if (state !== 'playing') return;

  if (player.isBelowMap(map)) { die(); return; }                     // F-14
  if (player.x + player.w / 2 >= map.def.goalX) clearStage();         // F-16
}

// =====================================================================
// ---- 렌더 ----
// =====================================================================
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

// 통일된 팔레트 (밝은 아케이드 톤)
const PAL = {
  skyTop: '#4fb3ff', skyMid: '#97d9ff', skyBottom: '#d9f4ff',
  sun: '#fff3b0', cloud: '#ffffff', cloudShade: '#cfe8ff',
  hillFar: '#a3dfb8', hillFarLine: '#7cc596', hillNear: '#66c47e', hillNearLine: '#3f9d5a',
  grass: '#5fd04e', grassLight: '#a2f07f', grassDark: '#2f8a2c',
  dirt: '#c98143', dirtDark: '#a5652f', dirtEdge: '#7a4a22',
  brick: '#c8553d', brickLight: '#e88a6c', brickLine: '#5e2416',
  qBlock: '#3d8bfd', qLight: '#8cbcff', qShade: '#2462c4', qLine: '#14306b',
  used: '#9c8a78', usedLine: '#4a3b2e',
  wood: '#f0b867', woodLine: '#6b3f12', woodGrain: '#d99a4a', woodText: '#5a3210',
  ink: '#14183a',
  panel: 'rgba(20, 24, 58, 0.9)', panelLine: '#ffd54f',
  gold: '#ffd54f', info: '#9be7ff', sub: '#d5dcf0', danger: '#ff6b6b',
  btn: '#3b4a9a', btnLine: '#14183a', btnSel: '#ffd54f', btnSelText: '#2a1d00',
  btnOff: '#3a4058', btnOffText: '#7c8399'
};

// 화면 해상도: 실제 표시 크기 x devicePixelRatio 로 그려 글자를 선명하게 한다. 그리기 좌표는 항상 800x450.
let renderScale = 1;
let cssScale = 1; // 화면에 보이는 크기 / 800. 글자 최소 크기 계산용
const MIN_CSS_FONT = 10; // 4장: 창이 작아도 글자는 화면에서 10px 이상
function fitCanvas() {
  const r = canvas.getBoundingClientRect();
  cssScale = r.width > 0 ? r.width / VIEW_W : 1;
  const scale = Math.max(1, Math.min(3, (r.width * (window.devicePixelRatio || 1)) / VIEW_W));
  if (Math.abs(scale - renderScale) < 0.01 && canvas.width === Math.round(VIEW_W * scale)) return;
  renderScale = scale;
  canvas.width = Math.round(VIEW_W * scale);
  canvas.height = Math.round(VIEW_H * scale);
}
window.addEventListener('resize', fitCanvas);

// ---- 스테이지 테마 (F-45, PRD 14.1) ----
// PAL 의 월드 색을 테마별로 덮어쓴다. UI 색(패널, 버튼)은 모든 테마가 같다.
//  celestial: 'sun' | 'moon',  particles: null | 'snow' | 'stars' | 'embers',  lava: 구덩이를 용암으로
//  hillRy: 언덕 높이 배율 (사막 모래 언덕은 낮게, 화산은 높게)
const THEMES = {
  meadow: {
    celestial: 'sun', sunGlow: 'rgba(255, 243, 176, 0.35)', particles: null, hillRy: 1,
    cap: '#9b5de5', spot: '#fff1d6'
  },
  desert: {
    skyTop: '#ff9a5a', skyMid: '#ffc27a', skyBottom: '#ffe6b8',
    celestial: 'sun', sun: '#fff1c4', sunGlow: 'rgba(255, 220, 150, 0.45)',
    cloud: '#fff4e6', cloudShade: '#ffd8b0',
    hillFar: '#f3c98b', hillFarLine: '#d9a868', hillNear: '#e6a85e', hillNearLine: '#c0823d', hillRy: 0.6,
    grass: '#f6d98c', grassLight: '#fff2c2', grassDark: '#c9a24f',
    dirt: '#dba55f', dirtDark: '#b98544', dirtEdge: '#8a5a2b',
    particles: null, cap: '#e76f51', spot: '#fff1d6'
  },
  snow: {
    skyTop: '#8fb8de', skyMid: '#bcd6ee', skyBottom: '#eef5fb',
    celestial: 'sun', sun: '#ffffff', sunGlow: 'rgba(255, 255, 255, 0.4)',
    cloud: '#ffffff', cloudShade: '#d5e3f0',
    hillFar: '#e6f0f8', hillFarLine: '#b7cde0', hillNear: '#cfe1ef', hillNearLine: '#9bb8d0', hillRy: 1,
    grass: '#f7fbff', grassLight: '#ffffff', grassDark: '#b9d3e6',
    dirt: '#8fa9bf', dirtDark: '#748ea5', dirtEdge: '#55708a',
    particles: 'snow', cap: '#ef476f', spot: '#ffffff'
  },
  night: {
    skyTop: '#0b1433', skyMid: '#1a2a5c', skyBottom: '#34497f',
    celestial: 'moon', sun: '#fdf6d8', sunGlow: 'rgba(253, 246, 216, 0.18)',
    cloud: '#3b4a7a', cloudShade: '#2a3762',
    hillFar: '#1e3a4f', hillFarLine: '#142838', hillNear: '#1c4d33', hillNearLine: '#0f2d1d', hillRy: 1.1,
    grass: '#2f9e44', grassLight: '#69db7c', grassDark: '#1b5e20',
    dirt: '#5c3b28', dirtDark: '#43281a', dirtEdge: '#2b170c',
    brick: '#8c3b2e', brickLight: '#b5604f', brickLine: '#3a120b',
    particles: 'stars', cap: '#f4a261', spot: '#fff1d6'
  },
  lava: {
    skyTop: '#1f0a10', skyMid: '#4d1418', skyBottom: '#a3361c',
    celestial: 'sun', sun: '#ff7b3a', sunGlow: 'rgba(255, 100, 40, 0.3)',
    cloud: '#4a2a2a', cloudShade: '#2e1818',
    hillFar: '#3a1c1c', hillFarLine: '#20100f', hillNear: '#4f2420', hillNearLine: '#24100d', hillRy: 1.35,
    grass: '#7b7e8c', grassLight: '#a4a8b8', grassDark: '#4a4c58',
    dirt: '#55576a', dirtDark: '#3d3f4e', dirtEdge: '#262731',
    brick: '#7d7f8c', brickLight: '#a2a5b3', brickLine: '#2b2c35',
    particles: 'embers', lava: true, cap: '#2b2d42', spot: '#ff9f1c'
  }
};
let T = Object.assign({}, PAL, THEMES.meadow); // 현재 테마
let skyGradient = null;

function applyTheme(name) {
  T = Object.assign({}, PAL, THEMES[name] || THEMES.meadow);
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, T.skyTop);
  g.addColorStop(0.55, T.skyMid);
  g.addColorStop(1, T.skyBottom);
  skyGradient = g;
  MUSHROOM_COLORS.cap = T.cap;   // 스테이지마다 버섯 갓 색이 다르다
  MUSHROOM_COLORS.spot = T.spot;
}

// 시차 스크롤용: 주기 period 로 반복되는 레이어를 화면 전체에 깐다. (F-8)
function repeatLayer(camX, factor, period, fn) {
  const off = -((camX * factor) % period);
  for (let base = off - period; base < VIEW_W + period; base += period) fn(base);
}

function drawCloud(x, y, s) {
  const puffs = [[0, 0, 18], [20, -10, 22], [42, -2, 18], [24, 6, 16]];
  for (const [color, dy] of [[T.cloudShade, 4], [T.cloud, 0]]) {
    ctx.fillStyle = color;
    for (const [px, py, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x + px * s, y + py * s + dy, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHill(cx, cy, rx, ry, fill, line) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = line;
  ctx.stroke();
}

// 고정 위치 의사 난수 (프레임마다 같은 값)
function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawBackground(camX, now) {
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 별 (달밤)
  if (T.particles === 'stars') {
    for (let i = 0; i < 70; i++) {
      const x = ((hash01(i) * 1600 - camX * 0.05) % 800 + 800) % 800;
      const y = hash01(i + 100) * 260;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(now / 600 + i));
      ctx.fillStyle = 'rgba(255, 255, 230, ' + tw.toFixed(2) + ')';
      ctx.fillRect(x, y, i % 5 === 0 ? 3 : 2, i % 5 === 0 ? 3 : 2);
    }
  }

  // 해 / 달 (고정)
  ctx.fillStyle = T.sunGlow;
  ctx.beginPath(); ctx.arc(690, 92, 46, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = T.sun;
  ctx.beginPath(); ctx.arc(690, 92, 30, 0, Math.PI * 2); ctx.fill();
  if (T.celestial === 'moon') {
    ctx.fillStyle = T.skyTop; // 초승달 모양으로 깎기
    ctx.beginPath(); ctx.arc(704, 82, 26, 0, Math.PI * 2); ctx.fill();
  }

  repeatLayer(camX, 0.15, 720, (b) => {
    drawCloud(b + 60, 80, 1);
    drawCloud(b + 330, 135, 0.75);
    drawCloud(b + 540, 62, 1.15);
  });
  repeatLayer(camX, 0.3, 560, (b) => {
    drawHill(b + 120, GROUND_Y + 30, 170, 125 * T.hillRy, T.hillFar, T.hillFarLine);
    drawHill(b + 400, GROUND_Y + 40, 140, 100 * T.hillRy, T.hillFar, T.hillFarLine);
  });
  repeatLayer(camX, 0.5, 460, (b) => {
    drawHill(b + 80, GROUND_Y + 10, 110, 78 * T.hillRy, T.hillNear, T.hillNearLine);
    drawHill(b + 300, GROUND_Y + 18, 130, 72 * T.hillRy, T.hillNear, T.hillNearLine);
  });
}

// 구덩이: 아래로 갈수록 어두워지게 해서 위험한 곳임을 보여준다.
// 용암 성 테마에서는 구덩이 바닥에 출렁이는 용암을 그린다.
function drawPits(camX, now) {
  for (const [c, w] of map.def.pits) {
    const x = c * TILE - camX;
    const pw = w * TILE;
    if (x > VIEW_W || x + pw < 0) continue;
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, VIEW_H);
    if (T.lava) {
      g.addColorStop(0, 'rgba(255, 120, 40, 0)');
      g.addColorStop(1, 'rgba(255, 90, 30, 0.55)');
    } else {
      g.addColorStop(0, 'rgba(20, 24, 58, 0)');
      g.addColorStop(1, 'rgba(20, 24, 58, 0.85)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, GROUND_Y, pw, VIEW_H - GROUND_Y);
    if (T.lava) {
      const top = VIEW_H - 42;
      ctx.beginPath();
      ctx.moveTo(x, VIEW_H);
      for (let k = 0; k <= pw; k += 10) ctx.lineTo(x + k, top + Math.sin(now / 260 + (c * TILE + k) / 22) * 4);
      ctx.lineTo(x + pw, VIEW_H);
      ctx.closePath();
      ctx.fillStyle = '#ff6b1a';
      ctx.fill();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

// 앞쪽 장식 효과: 눈 (설원), 불티 (용암 성)
function drawFrontParticles(camX, now) {
  if (T.particles === 'snow') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (let i = 0; i < 70; i++) {
      const sp = 0.025 + hash01(i + 7) * 0.035;
      const x = ((hash01(i) * 900 - camX * 0.6 + Math.sin(now / 900 + i) * 20) % 820 + 820) % 820 - 10;
      const y = ((hash01(i + 50) * 470 + now * sp) % 470) - 10;
      const r = 1.5 + hash01(i + 9) * 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  } else if (T.particles === 'embers') {
    for (let i = 0; i < 40; i++) {
      const sp = 0.03 + hash01(i + 3) * 0.04;
      const x = ((hash01(i) * 900 - camX * 0.7 + Math.sin(now / 500 + i) * 12) % 820 + 820) % 820 - 10;
      const y = VIEW_H - ((hash01(i + 30) * 470 + now * sp) % 470);
      const a = Math.min(1, y / VIEW_H + 0.2);
      ctx.fillStyle = 'rgba(255, ' + (140 + (i % 4) * 25) + ', 60, ' + a.toFixed(2) + ')';
      ctx.fillRect(x, y, 3, 3);
    }
  }
}

function drawGroundTile(x, y, c, r) {
  ctx.fillStyle = T.dirt;
  ctx.fillRect(x, y, TILE, TILE);
  // 흙 알갱이 (타일 위치로 정해지는 고정 무늬)
  ctx.fillStyle = T.dirtDark;
  for (let k = 0; k < 3; k++) {
    const h = (c * 73 + r * 37 + k * 29) % 97;
    ctx.fillRect(x + 5 + ((h * 7) % 38), y + 18 + ((h * 3 + k * 11) % 26), 5, 4);
  }
  // 구덩이 쪽 옆면
  ctx.fillStyle = T.dirtEdge;
  if (map.get(c - 1, r) === TILE_EMPTY) ctx.fillRect(x, y, 4, TILE);
  if (map.get(c + 1, r) === TILE_EMPTY) ctx.fillRect(x + TILE - 4, y, 4, TILE);
  // 맨 윗줄 잔디
  if (map.get(c, r - 1) === TILE_EMPTY) {
    ctx.fillStyle = T.grassDark;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath(); ctx.arc(x + 5 + i * 10, y + 13, 5.5, 0, Math.PI); ctx.fill();
    }
    ctx.fillStyle = T.grass;
    ctx.fillRect(x, y, TILE, 12);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath(); ctx.arc(x + 5 + i * 10, y + 11, 5, 0, Math.PI); ctx.fill();
    }
    ctx.fillStyle = T.grassLight;
    ctx.fillRect(x, y, TILE, 3);
  }
}

// 벽돌 블록 (F-37): 붉은 벽돌 4줄, 줄마다 반 칸씩 엇갈림
function drawBrickTile(x, y) {
  const s = TILE;
  ctx.fillStyle = T.brickLine;
  ctx.fillRect(x, y, s, s);
  const bh = 11, bw = 23;
  for (let i = 0; i < 4; i++) {
    const by = y + 2 + i * (bh + 1);
    const off = i % 2 === 0 ? 0 : -12;
    for (let bx = x + 2 + off; bx < x + s - 1; bx += bw + 1) {
      const l = Math.max(bx, x + 2), r = Math.min(bx + bw, x + s - 2);
      if (r <= l) continue;
      ctx.fillStyle = T.brick;
      ctx.fillRect(l, by, r - l, bh);
      ctx.fillStyle = T.brickLight;
      ctx.fillRect(l, by, r - l, 2);
    }
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = T.brickLine;
  ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
}

// 물음표 블록 (F-37): 파란 상자 + 흰 물음표, 은은하게 반짝인다
function drawQBlockTile(x, y, now) {
  const s = TILE;
  roundRectPath(ctx, x + 1, y + 1, s - 2, s - 2, 7);
  ctx.fillStyle = PAL.qLine;
  ctx.fill();
  roundRectPath(ctx, x + 4, y + 4, s - 8, s - 8, 4);
  ctx.fillStyle = PAL.qBlock;
  ctx.fill();
  ctx.fillStyle = PAL.qLight;
  ctx.fillRect(x + 6, y + 6, s - 12, 4);
  ctx.fillRect(x + 6, y + 6, 4, s - 12);
  ctx.fillStyle = PAL.qShade;
  ctx.fillRect(x + 6, y + s - 10, s - 12, 4);
  ctx.fillRect(x + s - 10, y + 6, 4, s - 12);
  ctx.fillStyle = PAL.qLight;
  for (const [rx, ry] of [[10, 10], [s - 14, 10], [10, s - 14], [s - 14, s - 14]]) ctx.fillRect(x + rx, y + ry, 4, 4);
  const pulse = 0.5 + Math.sin(now / 250) * 0.5;
  ctx.globalAlpha = 0.25 * pulse;
  roundRectPath(ctx, x + 4, y + 4, s - 8, s - 8, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.globalAlpha = 1;
  text('?', x + s / 2, y + s / 2 + 1, 30, '#ffffff');
}

// 아이템을 꺼낸 빈 블록
function drawUsedTile(x, y) {
  const s = TILE;
  roundRectPath(ctx, x + 1, y + 1, s - 2, s - 2, 7);
  ctx.fillStyle = PAL.usedLine;
  ctx.fill();
  roundRectPath(ctx, x + 4, y + 4, s - 8, s - 8, 4);
  ctx.fillStyle = PAL.used;
  ctx.fill();
  ctx.fillStyle = PAL.usedLine;
  for (const [rx, ry] of [[10, 10], [s - 14, 10], [10, s - 14], [s - 14, s - 14]]) ctx.fillRect(x + rx, y + ry, 4, 4);
}

function drawTiles(camX, now) {
  const c0 = Math.max(0, Math.floor(camX / TILE));
  const c1 = Math.min(map.cols - 1, Math.floor((camX + VIEW_W) / TILE));
  for (let r = 0; r < map.rows; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = map.get(c, r);
      if (t === TILE_EMPTY) continue;
      const x = c * TILE - camX;
      const y = r * TILE + Math.round(map.bumpOffset(c, r));
      if (t === TILE_GROUND) drawGroundTile(x, y, c, r);
      else if (t === TILE_BLOCK) drawBrickTile(x, y);
      else if (t === TILE_QBLOCK) drawQBlockTile(x, y, now);
      else drawUsedTile(x, y);
    }
  }
}

// 나무 표지판 (기둥 2개 + 판자)
function drawSign(x, label, w) {
  ctx.fillStyle = PAL.woodLine;
  ctx.fillRect(x + 9, GROUND_Y - 34, 7, 34);
  ctx.fillRect(x + w - 16, GROUND_Y - 34, 7, 34);
  roundRectPath(ctx, x, GROUND_Y - 62, w, 32, 6);
  ctx.fillStyle = PAL.wood;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PAL.woodLine;
  ctx.stroke();
  ctx.fillStyle = PAL.woodGrain;
  ctx.fillRect(x + 6, GROUND_Y - 38, w - 12, 2);
  text(label, x + w / 2, GROUND_Y - 47, 15, PAL.woodText, 'center', false);
}

function drawStartSign(camX) {
  const x = map.def.startX - camX;
  if (x < -100 || x > VIEW_W) return;
  drawSign(x, 'START ▶', 88);
}

// F-21: 100m 마다 거리 표지판. 구덩이 위라면 왼쪽 땅으로 옮긴다.
function drawDistanceSigns(camX) {
  for (let m = 100; m < GOAL_M; m += 100) {
    let col = Math.floor((m * PX_PER_M) / TILE);
    while (col > 0 && map.get(col, map.def.groundTopRow) === TILE_EMPTY) col--;
    const x = col * TILE - 4 - camX;
    if (x < -70 || x > VIEW_W) continue;
    drawSign(x, m + 'm', 58);
  }
}

function drawGoalFlag(camX, now) {
  const x = map.def.goalX - camX;
  if (x < -120 || x > VIEW_W + 120) return;
  const top = GROUND_Y - 210;
  // 받침돌
  roundRectPath(ctx, x - 14, GROUND_Y - 16, 34, 16, 4);
  ctx.fillStyle = '#9aa3b8'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = PAL.ink; ctx.stroke();
  // 깃대
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 1, top, 8, GROUND_Y - 16 - top);
  ctx.fillStyle = '#eef3f7';
  ctx.fillRect(x + 1, top, 4, GROUND_Y - 16 - top);
  // 깃발 (펄럭임)
  const wave = (i) => Math.sin(now / 180 + i * 0.7) * 4 * (i / 6);
  ctx.beginPath();
  ctx.moveTo(x + 6, top + 8);
  for (let i = 1; i <= 6; i++) ctx.lineTo(x + 6 + i * 12, top + 8 + wave(i));
  for (let i = 6; i >= 0; i--) ctx.lineTo(x + 6 + i * 12, top + 54 + wave(i));
  ctx.closePath();
  ctx.fillStyle = '#ff5a5f'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#7a1f2b'; ctx.stroke();
  starPath(ctx, x + 42, top + 31 + wave(3), 11, 4.5);
  ctx.fillStyle = '#fff'; ctx.fill();
  // 꼭대기 공
  ctx.beginPath(); ctx.arc(x + 3, top - 6, 8, 0, Math.PI * 2);
  ctx.fillStyle = PAL.gold; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = PAL.ink; ctx.stroke();
  text('GOAL', x + 3, top - 30, 22, PAL.gold);
}

function drawEffects(camX) {
  for (const f of effects) {
    const fade = f.t < 14 ? 1 : 1 - (f.t - 14) / (EFFECT_FRAMES - 14);
    ctx.globalAlpha = Math.max(0, fade);
    if (f.kind === 'power') {
      // 열매를 먹으면 주인공 주위로 청록색 반짝이가 퍼진다
      const cx = f.x + f.w / 2 - camX, cy = f.y + f.h / 2;
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2 + f.t * 0.05;
        const d = 14 + f.t * 1.6;
        starPath(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 6, 2.5);
        ctx.fillStyle = j % 2 ? '#9ff7e3' : PAL.gold;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      continue;
    }
    drawMushroom(ctx, f.x - camX, f.y, f.w, f.h, 0, f.dir, 0.35);
    // 반짝이 파티클
    const cx = f.x + f.w / 2 - camX;
    const cy = f.y + f.h * 0.7;
    for (let j = 0; j < 4; j++) {
      const a = -Math.PI / 2 + (j - 1.5) * 0.75;
      const d = 10 + f.t * 1.3;
      starPath(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 5, 2);
      ctx.fillStyle = PAL.gold;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawWorld(now) {
  const camX = Math.round(camera.x);
  drawBackground(camX, now);
  drawPits(camX, now);
  for (const it of items) it.draw(ctx, camX, now); // 블록보다 먼저: 솟아오를 때 블록 뒤에서 나오게
  drawTiles(camX, now);
  drawStartSign(camX);
  drawDistanceSigns(camX);
  drawGoalFlag(camX, now);
  for (const e of enemies) e.draw(ctx, camX);
  drawEffects(camX);
  // 시작/선택 화면에서는 주인공을 월드에 그리지 않는다 (아직 고르기 전)
  if (state !== 'title' && state !== 'select') player.draw(ctx, camX, now, map);
  drawFrontParticles(camX, now);
}

// ---- UI 도우미 ----
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

// 글자. outline 이 켜져 있으면 어두운 테두리로 어떤 배경에서도 읽히게 한다.
// 논리 글자 크기를 화면 최소 크기(MIN_CSS_FONT) 이상이 되게 보정한다.
function fontSize(size) {
  return Math.max(size, MIN_CSS_FONT / cssScale);
}

function text(str, x, y, size, color, align, outline) {
  size = fontSize(size);
  ctx.font = 'bold ' + size + 'px ' + FONT;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  if (outline !== false) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 5);
    ctx.strokeStyle = 'rgba(14, 16, 40, 0.9)';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color || '#fff';
  ctx.fillText(str, x, y);
}

function dim(alpha) {
  ctx.fillStyle = 'rgba(14, 16, 40, ' + alpha + ')';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function panel(x, y, w, h) {
  roundRectPath(ctx, x, y + 6, w, h, 16);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  roundRectPath(ctx, x, y, w, h, 16);
  ctx.fillStyle = PAL.panel;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = PAL.panelLine;
  ctx.stroke();
}

function drawButton(label, x, y, w, h, opt) {
  const enabled = opt.enabled !== false;
  const sel = enabled && opt.selected;
  roundRectPath(ctx, x, y + 4, w, h, 10);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fill();
  roundRectPath(ctx, x, y, w, h, 10);
  ctx.fillStyle = !enabled ? PAL.btnOff : sel ? PAL.btnSel : PAL.btn;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = sel ? '#fff' : PAL.btnLine;
  ctx.stroke();
  text((sel ? '▶ ' : '') + label, x + w / 2, y + h / 2 + 1, opt.size || 18,
    !enabled ? PAL.btnOffText : sel ? PAL.btnSelText : '#fff', 'center', false);
  addHit(x, y, w, h, enabled, opt.onClick, opt.onHover);
}

// 세로 메뉴 (키보드 ↑↓ Enter 와 마우스 모두)
function drawMenu(items, cx, y, w, h, gap) {
  items.forEach((item, i) => {
    drawButton(item.label, cx - w / 2, y + i * (h + gap), w, h, {
      enabled: item.enabled,
      selected: i === menuIndex,
      onHover: () => { menuIndex = i; },
      onClick: () => { menuIndex = i; item.run(); }
    });
  });
}

function hintPill(str, cx, y) {
  const fs = fontSize(14);
  ctx.font = 'bold ' + fs + 'px ' + FONT;
  const w = ctx.measureText(str).width + 28;
  const h = fs + 12;
  roundRectPath(ctx, Math.max(4, cx - w / 2), y - h / 2, w, h, h / 2);
  ctx.fillStyle = 'rgba(14, 16, 40, 0.7)';
  ctx.fill();
  text(str, Math.max(4, cx - w / 2) + w / 2, y + 1, 14, PAL.sub, 'center', false);
}

// ---- HUD (F-19, F-20) ----
function drawHUD() {
  roundRectPath(ctx, 8, 8, 672, 40, 12);
  ctx.fillStyle = 'rgba(14, 16, 40, 0.72)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.stroke();

  // 스테이지 번호 배지 (F-49)
  roundRectPath(ctx, 16, 15, 82, 26, 8);
  ctx.fillStyle = PAL.gold;
  ctx.fill();
  text('STAGE ' + (stageIndex + 1), 57, 29, 15, PAL.btnSelText, 'center', false);

  const d = distanceM();
  text(d + 'm / ' + GOAL_M + 'm', 110, 29, 18, '#fff', 'left', false);

  // 진행률 바: 시작 ~ GOAL 사이 캐릭터 위치
  const bx = 250, bw = 240, by = 23, bh = 12;
  roundRectPath(ctx, bx, by, bw, bh, 6);
  ctx.fillStyle = '#2b335e';
  ctx.fill();
  const ratio = d / GOAL_M;
  if (ratio > 0) {
    roundRectPath(ctx, bx, by, Math.max(bh, bw * ratio), bh, 6);
    ctx.fillStyle = PAL.gold;
    ctx.fill();
  }
  roundRectPath(ctx, bx, by, bw, bh, 6);
  ctx.lineWidth = 2;
  ctx.strokeStyle = PAL.ink;
  ctx.stroke();
  // 끝의 깃발 아이콘
  ctx.fillStyle = '#eef3f7';
  ctx.fillRect(bx + bw + 6, by - 8, 2, 22);
  ctx.fillStyle = '#ff5a5f';
  ctx.beginPath();
  ctx.moveTo(bx + bw + 8, by - 8); ctx.lineTo(bx + bw + 20, by - 3); ctx.lineTo(bx + bw + 8, by + 2);
  ctx.closePath(); ctx.fill();
  // 캐릭터 아이콘
  drawCharacterSprite(ctx, player.character, bx + bw * ratio, by + bh + 3, 26, 1);

  text('시간', 530, 29, 14, PAL.info, 'left', false);
  text(fmtTime(elapsed), 566, 29, 19, '#fff', 'left', false);

  if (touchMode) hintPill('◀ ▶ 이동 · 화면 터치 점프', 560, VIEW_H - 22);
  else hintPill('←→ 이동 · Space 점프 · S 저장 · P 일시정지', 210, VIEW_H - 22);
}

// 터치 조작 버튼 (F-56, F-58)
function drawTouchControls() {
  const b = touchButtons();
  for (const [key, c, dir] of [['left', b.left, -1], ['right', b.right, 1]]) {
    const on = touchHold[key];
    ctx.beginPath();
    ctx.arc(c.x, c.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = on ? 'rgba(255, 213, 79, 0.55)' : 'rgba(14, 16, 40, 0.45)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = on ? PAL.gold : 'rgba(255, 255, 255, 0.7)';
    ctx.stroke();
    const s = b.r * 0.45;
    ctx.beginPath();
    ctx.moveTo(c.x + dir * s, c.y);
    ctx.lineTo(c.x - dir * s * 0.7, c.y - s);
    ctx.lineTo(c.x - dir * s * 0.7, c.y + s);
    ctx.closePath();
    ctx.fillStyle = on ? PAL.btnSelText : 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
  }
  // 일시정지 버튼 (저장 버튼 아래)
  drawButton('Ⅱ', 742, 56, 50, 40, { onClick: () => { state = 'paused'; menuIndex = 0; releaseTouches(); }, size: 18 });
}

// 스테이지가 시작될 때 가운데에 스테이지 이름을 잠깐 보여준다 (F-49)
function drawStageIntro(now) {
  const t = now - stageIntroAt;
  if (t < 0 || t > STAGE_INTRO_MS) return;
  const a = t < 250 ? t / 250 : t > STAGE_INTRO_MS - 400 ? (STAGE_INTRO_MS - t) / 400 : 1;
  ctx.globalAlpha = Math.max(0, a);
  roundRectPath(ctx, VIEW_W / 2 - 170, 130, 340, 96, 18);
  ctx.fillStyle = 'rgba(14, 16, 40, 0.82)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PAL.gold;
  ctx.stroke();
  text('STAGE ' + (stageIndex + 1) + ' / ' + STAGE_COUNT, VIEW_W / 2, 160, 20, PAL.info, 'center', false);
  text(STAGES[stageIndex].name, VIEW_W / 2, 198, 34, PAL.gold);
  ctx.globalAlpha = 1;
}

function newRecordBadge(x, y, now) {
  const sc = 1 + Math.sin(now / 150) * 0.06;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.rotate(-0.15);
  roundRectPath(ctx, -40, -14, 80, 28, 14);
  ctx.fillStyle = PAL.danger; ctx.fill();
  text('신기록!', 0, 1, 15, '#fff', 'center', false);
  ctx.restore();
}

function celebrate(now) {
  const hop = Math.abs(Math.sin(now / 220)) * 18;
  drawCharacterSprite(ctx, player.character, 120, 330 - hop, 96, 1);
  drawCharacterSprite(ctx, player.character, 680, 330 - Math.abs(Math.sin(now / 220 + 1.2)) * 18, 96, -1);
}

// ---- 화면별 오버레이 (PRD 6장) ----
function drawTitle(now) {
  dim(0.25);
  text('마리오 스타일 게임', VIEW_W / 2, 70, 48, PAL.gold);
  text('5개 스테이지, 각 500m! 버섯을 피하고 밟으며 GOAL까지 달려라!', VIEW_W / 2, 114, 17, '#fff');

  panel(270, 140, 260, 182);
  drawMenu(titleItems(), VIEW_W / 2, 158, 220, 42, 12);

  // 정보 상자: 최고 기록 + 조작법 (4장 접근성)
  roundRectPath(ctx, 150, 340, 500, 92, 12);
  ctx.fillStyle = 'rgba(14, 16, 40, 0.78)';
  ctx.fill();
  text('전체 클리어 최고 기록  ' + (best.total !== null ? fmtTime(best.total) : '-'), VIEW_W / 2, 360, 17, PAL.gold, 'center', false);
  if (touchMode) {
    text('◀ ▶ 버튼으로 이동 · 버튼 밖 화면을 터치하면 점프', VIEW_W / 2, 386, 15, PAL.sub, 'center', false);
    text(innerHeight > innerWidth ? '휴대폰을 가로로 돌리면 화면이 더 크게 보여요' : '메뉴와 버튼은 탭해서 선택', VIEW_W / 2, 409, 15, innerHeight > innerWidth ? PAL.gold : PAL.sub, 'center', false);
  } else {
    text('←→ 이동 · Space 점프 · S 저장 · P/Esc 일시정지', VIEW_W / 2, 386, 15, PAL.sub, 'center', false);
    text('메뉴: ↑↓ 선택 · Enter 확인 · 마우스 클릭', VIEW_W / 2, 409, 15, PAL.sub, 'center', false);
  }
  if (!Store.available()) text('저장소를 사용할 수 없어 저장 기능이 꺼져 있습니다', VIEW_W / 2, 445 - 8, 13, PAL.danger);

  // 장식: 3종 캐릭터
  CHARACTERS.forEach((c, i) => {
    const hop = Math.abs(Math.sin(now / 300 + i * 1.1)) * 6;
    drawCharacterSprite(ctx, c.id, 690 + i * 44, GROUND_Y - hop, 46, -1);
  });
}

function drawSelect(now) {
  dim(0.55);
  text('캐릭터 선택', VIEW_W / 2, 58, 36, PAL.gold);
  text('모습만 다르고 조작과 판정은 모두 같아요', VIEW_W / 2, 94, 15, PAL.sub);

  CHARACTERS.forEach((c, i) => {
    const sel = i === selectIndex;
    const w = 180, h = 214;
    const x = VIEW_W / 2 + (i - 1) * 210 - w / 2;
    const y = 112 - (sel ? 6 : 0);
    roundRectPath(ctx, x, y + 6, w, h, 18);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fillStyle = '#14183a';
    ctx.fill();
    if (sel) { ctx.fillStyle = 'rgba(255, 213, 79, 0.2)'; ctx.fill(); }
    ctx.lineWidth = sel ? 5 : 3;
    ctx.strokeStyle = sel ? PAL.gold : '#4a5488';
    ctx.stroke();
    // 받침 그림자
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + 160, 44, 8, 0, 0, Math.PI * 2); ctx.fill();
    const hop = sel ? Math.abs(Math.sin(now / 220)) * 10 : 0;
    drawCharacterSprite(ctx, c.id, x + w / 2, y + 162 - hop, 128, 1);
    text(c.name, x + w / 2, y + 190, 21, sel ? PAL.gold : '#fff');
    // 클릭: 고르기, 이미 고른 카드를 한 번 더 누르면 시작
    addHit(x, y, w, h, true, () => { if (selectIndex === i) confirmSelect(); else selectIndex = i; });
  });

  drawButton('뒤로 (Esc)', 220, 352, 150, 44, { onClick: () => { state = 'title'; } });
  drawButton('시작하기 (Enter)', 400, 352, 190, 44, { selected: true, onClick: confirmSelect });
  hintPill(touchMode ? '카드를 탭해서 선택 · 선택한 카드를 한 번 더 탭하면 시작' : '←→ 또는 클릭으로 선택 · 선택한 카드를 한 번 더 클릭해도 시작', VIEW_W / 2, 424);
}

function drawPause() {
  dim(0.5);
  panel(250, 92, 300, 274);
  text('일시정지', VIEW_W / 2, 132, 34, PAL.gold);
  drawMenu(pauseItems(), VIEW_W / 2, 164, 220, 42, 12);
  text('P / Esc 계속하기 · ↑↓ Enter 선택', VIEW_W / 2, 342, 14, PAL.sub, 'center', false);
}

function drawGameOver() {
  dim(0.55);
  panel(230, 80, 340, 290);
  text('GAME OVER', VIEW_W / 2, 126, 46, PAL.danger);
  text('이동 거리 ' + distanceM() + 'm · 시간 ' + fmtTime(elapsed), VIEW_W / 2, 170, 16, PAL.sub, 'center', false);
  drawMenu(gameoverItems(), VIEW_W / 2, 196, 260, 42, 12);
}

// 스테이지 클리어: 축하 메시지 + 시간, 3초 뒤 다음 스테이지 (F-46)
function drawClear(now) {
  dim(0.5);
  panel(210, 50, 380, 340);
  text('축하합니다!', VIEW_W / 2, 92, 40, PAL.gold);
  text('STAGE ' + (stageIndex + 1) + ' · ' + STAGES[stageIndex].name + ' 클리어', VIEW_W / 2, 132, 18, '#fff', 'center', false);
  text('클리어 시간', VIEW_W / 2, 164, 15, PAL.info, 'center', false);
  text(fmtTime(runStageTimes[stageIndex] || 0), VIEW_W / 2, 194, 30, '#fff');
  if (newStageRecord) newRecordBadge(VIEW_W / 2 + 118, 188, now);
  const sb = best.stages[stageIndex];
  text('스테이지 최고 기록  ' + (sb !== null && sb !== undefined ? fmtTime(sb) : '-'), VIEW_W / 2, 228, 15, PAL.gold, 'center', false);
  drawMenu(clearItems(), VIEW_W / 2, 252, 260, 42, 12);
  const left = Math.max(0, Math.ceil((NEXT_STAGE_FRAMES - clearFrames) / 60));
  text(left + '초 뒤 STAGE ' + (stageIndex + 2) + ' · ' + STAGES[stageIndex + 1].name + ' 시작', VIEW_W / 2, 372, 14, PAL.sub, 'center', false);
  celebrate(now);
}

// 전체 클리어: 축하 메시지 + 총 시간, 6초 뒤 시작 화면 (F-47)
function drawAllClear(now) {
  dim(0.55);
  panel(200, 28, 400, 390);
  text('축하합니다!', VIEW_W / 2, 68, 42, PAL.gold);
  text('모든 스테이지를 클리어했어요!', VIEW_W / 2, 106, 19, '#fff', 'center', false);
  // 스테이지별 기록
  for (let i = 0; i < STAGE_COUNT; i++) {
    const y = 138 + i * 22;
    const t = runStageTimes[i];
    text((i + 1) + '. ' + STAGES[i].name, 270, y, 15, PAL.sub, 'left', false);
    text(t !== undefined ? fmtTime(t) : '(이어하기)', 530, y, 15, '#fff', 'right', false);
  }
  text('총 시간', VIEW_W / 2, 258, 15, PAL.info, 'center', false);
  text(fmtTime(totalBefore), VIEW_W / 2, 286, 30, '#fff');
  if (newTotalRecord) newRecordBadge(VIEW_W / 2 + 112, 280, now);
  text('전체 최고 기록  ' + (best.total !== null ? fmtTime(best.total) : '-'), VIEW_W / 2, 318, 15, PAL.gold, 'center', false);
  drawMenu(allClearItems(), VIEW_W / 2, 338, 260, 42, 12);
  const left = Math.max(0, Math.ceil((TO_TITLE_FRAMES - clearFrames) / 60));
  text(left + '초 뒤 시작 화면으로 돌아갑니다', VIEW_W / 2, 400, 14, PAL.sub, 'center', false);
  celebrate(now);
}

function drawToast() {
  if (performance.now() >= toast.until) return;
  ctx.font = 'bold ' + fontSize(17) + 'px ' + FONT;
  const w = ctx.measureText(toast.text).width + 40;
  roundRectPath(ctx, VIEW_W / 2 - w / 2, 58, w, 36, 18);
  ctx.fillStyle = 'rgba(14, 16, 40, 0.88)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PAL.gold;
  ctx.stroke();
  text(toast.text, VIEW_W / 2, 77, 17, '#fff', 'center', false);
}

function drawLoading() {
  dim(0.6);
  text('불러오는 중...', VIEW_W / 2, VIEW_H / 2, 28, '#fff');
}

function render(now) {
  fitCanvas();
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  hitAreas = [];
  hitState = state;

  drawWorld(now);
  if (!assetsReady) {
    drawLoading();
  } else {
    if (state === 'playing' || state === 'paused' || state === 'gameover' || state === 'clear') drawHUD();
    if (state === 'playing') drawStageIntro(now);
    if (state === 'playing' && touchMode) drawTouchControls();
    if (state === 'title') drawTitle(now);
    else if (state === 'select') drawSelect(now);
    else if (state === 'paused') drawPause();
    else if (state === 'gameover') drawGameOver();
    else if (state === 'clear') drawClear(now);
    else if (state === 'allclear') drawAllClear(now);
  }
  drawToast();
  saveBtn.style.display = assetsReady && (state === 'playing' || state === 'paused') ? 'block' : 'none';
}

// ---- 메인 루프 (고정 시간 단계) ----
let last = performance.now();
let acc = 0;
function frame(now) {
  // 탭 전환 등으로 시간이 크게 튀어도 한꺼번에 몰아서 업데이트하지 않는다.
  acc += Math.min(now - last, 250);
  last = now;
  while (acc >= STEP_MS) {
    update();
    acc -= STEP_MS;
  }
  render(now);
  requestAnimationFrame(frame);
}

goTitle();
requestAnimationFrame(frame);
// 캐릭터 이미지를 미리 불러온 뒤 시작 화면을 활성화한다. 실패해도 대체 도형으로 진행 (F-34)
preloadCharacterImages(() => { assetsReady = true; });

// 검증/디버깅용
window.__game = {
  map, camera, player, keys,
  get enemies() { return enemies; },
  get state() { return state; },
  get elapsed() { return elapsed; },
  get distance() { return distanceM(); },
  get selectIndex() { return selectIndex; },
  get items() { return items; },
  get touchMode() { return touchMode; },
  touchHold,
  get stage() { return stageIndex + 1; },
  get totalSec() { return totalBefore; },
  get theme() { return map.def.theme; },
  get assetsReady() { return assetsReady; },
  get images() { return Object.fromEntries(CHARACTERS.map((c) => [c.id, !!CHAR_IMAGES[c.id]])); }
};
