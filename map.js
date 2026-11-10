// 맵 데이터와 카메라. 10px = 1m, 스테이지마다 맵 길이 5000px = 500m.
const TILE = 50;
const MAP_COLS = 104;
const MAP_ROWS = 9;
const MAP_W = MAP_COLS * TILE; // 5200 (목표 500m + 여유)
const MAP_H = MAP_ROWS * TILE; // 450
const PX_PER_M = 10;

const BUMP_FRAMES = 12;  // 블록이 튀어 올랐다 돌아오는 데 걸리는 프레임
const BUMP_HEIGHT = 12;  // 최대로 올라가는 높이(px)

const TILE_EMPTY = 0;
const TILE_GROUND = 1;
const TILE_BLOCK = 2;   // 벽돌 블록 (F-37)
const TILE_QBLOCK = 3;  // 물음표 블록: 아래에서 치면 파워 열매가 나온다 (F-38)
const TILE_USED = 4;    // 아이템을 꺼낸 빈 블록 (단단하지만 튀지 않는다)

// 스테이지 정의 (F-43, PRD 14장). 수정하기 쉽도록 데이터로 분리한다.
// 모든 스테이지 공통: 바닥 윗면 행 7(y=350), START x=50, GOAL x=5000(500m), 시작 x=20.
//  pits:      [시작 열, 폭(열 수)]  ※ 폭은 최대 3칸 (점프 수평 거리 약 160px)
//  platforms: [시작 열, 행, 길이]   ※ 행 5 블록 아래 통로는 50px (커진 히트박스 48px)
//  qblocks:   [열, 행]              ※ platforms 위의 칸이어야 한다
//  enemies:   [열, 바닥 행]         ※ 7 = 지면, 5/4/3 = 그 행의 블록 위
//  enemySpeed: 버섯 속도(px/frame)   ※ 스테이지가 올라갈수록 빨라진다 (F-44)
//  theme:     game.js 의 THEMES 키 (F-45)
function stageDef(d) {
  return Object.assign({ groundTopRow: 7, startX: 50, goalX: 5000, playerSpawnX: 20 }, d);
}

const STAGES = [
  stageDef({
    name: '초록 들판', theme: 'meadow', enemySpeed: 1.0,
    pits: [[20, 2], [45, 3], [70, 2]],
    platforms: [
      [12, 5, 3], [30, 5, 4], [36, 5, 2], [38, 3, 3],
      [55, 6, 1], [56, 5, 1], [57, 4, 1], [62, 5, 4], [80, 5, 3]
    ],
    qblocks: [[13, 5], [32, 5], [39, 3], [63, 5], [81, 5]],
    enemies: [
      [8, 7], [17, 7], [26, 7], [31, 5], [40, 7], [52, 7],
      [60, 7], [63, 5], [75, 7], [84, 7], [90, 7], [96, 7]
    ]
  }),
  stageDef({
    name: '노을 사막', theme: 'desert', enemySpeed: 1.15,
    pits: [[16, 2], [33, 3], [50, 2], [66, 3], [84, 2]],
    platforms: [
      [10, 5, 4], [24, 5, 3], [38, 5, 4], [42, 3, 2],
      [60, 6, 1], [61, 5, 1], [62, 4, 1], [72, 5, 4], [88, 5, 3]
    ],
    qblocks: [[11, 5], [25, 5], [42, 3], [73, 5]],
    enemies: [
      [8, 7], [14, 7], [20, 7], [27, 7], [40, 5], [45, 7],
      [55, 7], [64, 7], [70, 7], [74, 5], [78, 7], [90, 7]
    ]
  }),
  stageDef({
    name: '눈꽃 설원', theme: 'snow', enemySpeed: 1.3,
    pits: [[14, 2], [27, 3], [41, 2], [55, 3], [69, 3], [86, 2]],
    platforms: [
      [8, 5, 3], [19, 5, 4], [23, 3, 2], [33, 5, 3], [46, 5, 4],
      [60, 6, 1], [61, 5, 1], [62, 4, 2], [74, 5, 4], [80, 4, 2], [91, 5, 3]
    ],
    qblocks: [[9, 5], [24, 3], [47, 5], [81, 4]],
    enemies: [
      [10, 7], [17, 7], [21, 5], [25, 7], [32, 7], [36, 7], [44, 7],
      [48, 5], [52, 7], [65, 7], [75, 5], [79, 7], [90, 7]
    ]
  }),
  stageDef({
    name: '달밤 숲', theme: 'night', enemySpeed: 1.45,
    pits: [[12, 3], [24, 2], [36, 3], [48, 2], [58, 3], [72, 3], [85, 3]],
    platforms: [
      [6, 5, 3], [16, 5, 3], [20, 4, 2], [29, 5, 4], [40, 5, 3], [44, 3, 2], [52, 5, 3],
      [62, 6, 1], [63, 5, 1], [64, 4, 1], [66, 4, 3], [76, 5, 4], [90, 5, 3]
    ],
    qblocks: [[17, 5], [45, 3], [77, 5]],
    enemies: [
      [8, 7], [7, 5], [18, 7], [22, 7], [30, 5], [33, 7], [41, 5],
      [46, 7], [54, 7], [65, 7], [70, 7], [78, 5], [82, 7], [93, 7]
    ]
  }),
  stageDef({
    name: '용암 성', theme: 'lava', enemySpeed: 1.6,
    pits: [[10, 3], [20, 3], [31, 2], [40, 3], [50, 3], [60, 2], [68, 3], [78, 3], [88, 3]],
    platforms: [
      [5, 5, 3], [15, 5, 3], [18, 3, 2], [25, 5, 4], [35, 5, 3], [44, 5, 2], [46, 4, 2],
      [55, 5, 3], [63, 6, 1], [64, 5, 1], [65, 4, 1], [72, 5, 3], [83, 5, 3], [93, 5, 3]
    ],
    qblocks: [[16, 5], [47, 4], [84, 5]],
    enemies: [
      [7, 7], [6, 5], [17, 5], [24, 7], [27, 5], [29, 7], [36, 5], [38, 7],
      [45, 7], [54, 7], [57, 5], [66, 7], [73, 5], [85, 7], [95, 7]
    ]
  })
];
const STAGE_COUNT = STAGES.length;

class GameMap {
  constructor(def) {
    this.def = def;
    this.cols = MAP_COLS;
    this.rows = MAP_ROWS;
    this.width = MAP_W;
    this.height = MAP_H;
    this.tiles = new Uint8Array(this.cols * this.rows);
    this.bumps = new Map(); // 튕기는 중인 블록: 타일 인덱스 -> 경과 프레임
    this.hitQBlocks = [];   // 이번 업데이트에서 처음 맞은 물음표 블록 [열, 행]. game.js 가 꺼내서 아이템을 만든다
    this.build();
  }

  // 다른 스테이지 맵으로 바꾼다 (F-43). 맵 크기는 모든 스테이지가 같다.
  load(def) {
    this.def = def;
    this.build();
  }

  // 맵을 처음 상태로 만든다. 새 게임/재시작 때마다 다시 불러 물음표 블록을 되살린다.
  build() {
    const d = this.def;
    this.tiles.fill(TILE_EMPTY);
    this.bumps.clear();
    this.hitQBlocks = [];
    for (let c = 0; c < this.cols; c++) {
      const inPit = d.pits.some(([s, w]) => c >= s && c < s + w);
      if (inPit) continue;
      for (let r = d.groundTopRow; r < this.rows; r++) this.set(c, r, TILE_GROUND);
    }
    for (const [c0, r, len] of d.platforms) {
      for (let c = c0; c < c0 + len; c++) this.set(c, r, TILE_BLOCK);
    }
    for (const [c, r] of d.qblocks) this.set(c, r, TILE_QBLOCK);
  }

  // 사용한 물음표 블록 목록 (저장용, F-42)
  usedBlocks() {
    return this.def.qblocks.filter(([c, r]) => this.get(c, r) === TILE_USED).map(([c, r]) => [c, r]);
  }

  // 저장 데이터의 사용한 블록을 되돌린다. 물음표 블록 자리가 아니면 무시한다.
  applyUsedBlocks(list) {
    for (const [c, r] of list) if (this.get(c, r) === TILE_QBLOCK) this.set(c, r, TILE_USED);
  }

  set(c, r, v) { this.tiles[r * this.cols + c] = v; }

  get(c, r) {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return TILE_EMPTY;
    return this.tiles[r * this.cols + c];
  }

  // F-36: 아래에서 머리로 친 블록을 위로 튕긴다. 바닥 지형과 빈 블록은 움직이지 않는다.
  // F-38: 물음표 블록은 빈 블록으로 바뀌고 아이템이 나올 자리로 기록된다.
  bump(c, r) {
    const t = this.get(c, r);
    if (t === TILE_QBLOCK) {
      this.set(c, r, TILE_USED);
      this.hitQBlocks.push([c, r]);
    } else if (t !== TILE_BLOCK) {
      return;
    }
    this.bumps.set(r * this.cols + c, 0);
  }

  // 주어진 사각형이 단단한 타일과 겹치는지 (커질 공간 확인용)
  boxHitsSolid(x, y, w, h) {
    const c0 = Math.floor(x / TILE), c1 = Math.floor((x + w - 0.01) / TILE);
    const r0 = Math.floor(y / TILE), r1 = Math.floor((y + h - 0.01) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (this.isSolid(c, r)) return true;
    return false;
  }

  // 매 업데이트(고정 시간 단계)마다 튕김 애니메이션을 진행한다.
  update() {
    for (const [key, t] of this.bumps) {
      if (t + 1 >= BUMP_FRAMES) this.bumps.delete(key);
      else this.bumps.set(key, t + 1);
    }
  }

  // 블록의 현재 y 오프셋(px, 위쪽이 음수). 튕기는 중이 아니면 0.
  bumpOffset(c, r) {
    const t = this.bumps.get(r * this.cols + c);
    if (t === undefined) return 0;
    return -Math.sin((t / BUMP_FRAMES) * Math.PI) * BUMP_HEIGHT;
  }

  // 맵 밖(위/아래)은 비어 있는 것으로 취급 (구덩이로 떨어질 수 있음). 좌우 경계는 플레이어에서 따로 막는다.
  isSolid(c, r) { return this.get(c, r) !== TILE_EMPTY; }
}

// ---- 공용 그리기 도우미 (map → player → enemy → game 이 함께 쓴다) ----
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx, cx, cy, outer, inner, points) {
  const n = points || 5;
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

class Camera {
  constructor(viewW, viewH) {
    this.x = 0;
    this.viewW = viewW;
    this.viewH = viewH;
  }

  // 대상을 화면 중앙에 두되 맵 경계를 넘지 않는다.
  follow(target, mapWidth) {
    const cx = target.x + target.w / 2;
    this.x = Math.max(0, Math.min(cx - this.viewW / 2, mapWidth - this.viewW));
  }
}
