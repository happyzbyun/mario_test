// 버섯 적 (F-9 ~ F-11, F-51)
const ENEMY_W = 34;
const ENEMY_H = 34;
const ENEMY_ACTIVE_MARGIN = 150; // 화면 좌우로 이만큼 벗어난 버섯은 멈춰 있는다 (플레이어가 오기 전에 사라지지 않게)

class Enemy {
  // speed: 스테이지별 버섯 속도 (F-44). 생략하면 PHYSICS.enemySpeed
  constructor(id, x, y, dir, speed) {
    this.id = id;
    this.speed = speed || PHYSICS.enemySpeed;
    this.w = ENEMY_W;
    this.h = ENEMY_H;
    this.x = x;
    this.y = y;
    this.dir = dir === 1 ? 1 : -1;
    this.vy = 0;
    this.onGround = false; // 바닥을 딛고 있는지 (낭떠러지 판정은 바닥 위에서만)
    this.alive = true;
  }

  // 맵 데이터의 [열, 바닥 행]으로 버섯을 만든다.
  static fromSpawn(id, col, floorRow, speed) {
    return new Enemy(id, col * TILE + (TILE - ENEMY_W) / 2, floorRow * TILE - ENEMY_H, -1, speed);
  }

  static fromSave(s, speed) {
    const e = new Enemy(s.id, s.x, s.y, s.dir, speed);
    e.alive = s.alive !== false;
    return e;
  }

  toJSON() {
    return { id: this.id, x: this.x, y: this.y, dir: this.dir, alive: this.alive };
  }

  isActive(camX) {
    return this.x + this.w > camX - ENEMY_ACTIVE_MARGIN && this.x < camX + VIEW_W + ENEMY_ACTIVE_MARGIN;
  }

  update(map) {
    // F-10: 낭떠러지에서 방향 전환. 다음 위치의 앞쪽 발밑에 땅이 없으면 돌아선다.
    if (this.onGround) {
      const nx = this.x + this.dir * this.speed;
      const frontX = this.dir > 0 ? nx + this.w - 1 : nx + 1;
      const footRow = Math.floor((this.y + this.h + 1) / TILE);
      if (!map.isSolid(Math.floor(frontX / TILE), footRow)) this.dir = -this.dir;
    }

    // 좌우 이동: 벽/블록/맵 가장자리에 부딪히면 방향 전환
    this.x += this.dir * this.speed;
    if (this.x < 0) { this.x = 0; this.dir = 1; }
    if (this.x + this.w > map.width) { this.x = map.width - this.w; this.dir = -1; }

    const top = Math.floor(this.y / TILE);
    const bottom = Math.floor((this.y + this.h - 0.01) / TILE);
    if (this.dir > 0) {
      const col = Math.floor((this.x + this.w) / TILE);
      for (let r = top; r <= bottom; r++) {
        if (map.isSolid(col, r)) { this.x = col * TILE - this.w; this.dir = -1; break; }
      }
    } else {
      const col = Math.floor(this.x / TILE);
      for (let r = top; r <= bottom; r++) {
        if (map.isSolid(col, r)) { this.x = (col + 1) * TILE; this.dir = 1; break; }
      }
    }

    // 중력 + 착지 (F-11)
    this.vy = Math.min(this.vy + PHYSICS.gravity, PHYSICS.maxFall);
    this.y += this.vy;
    this.onGround = false;
    if (this.vy > 0) {
      const left = Math.floor(this.x / TILE);
      const right = Math.floor((this.x + this.w - 0.01) / TILE);
      const row = Math.floor((this.y + this.h) / TILE);
      for (let c = left; c <= right; c++) {
        if (map.isSolid(c, row)) { this.y = row * TILE - this.h; this.vy = 0; this.onGround = true; break; }
      }
    }

    // 어떤 이유로든 맵 아래로 벗어나면 제거
    if (this.y > map.height + 100) this.alive = false;
  }

  draw(ctx, camX) {
    drawMushroom(ctx, this.x - camX, this.y, this.w, this.h, this.x, this.dir, 1);
  }
}

// F-51: 버섯끼리 겹치면 서로 반대 방향으로 돌려보내고, 겹친 만큼 반씩 밀어낸다.
function resolveEnemyCollisions(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)) continue;
      const left = a.x <= b.x ? a : b;
      const right = left === a ? b : a;
      left.dir = -1;
      right.dir = 1;
      const push = (left.x + left.w - right.x) / 2;
      left.x -= push;
      right.x += push;
    }
  }
}

// 버섯 모양 (코드로 그린 오리지널 디자인: 보라색 갓 + 크림색 몸통).
// walk: 발 애니메이션 위상(보통 x 좌표), squash: 1 이면 보통, 작을수록 납작 (밟힌 연출)
const MUSHROOM_COLORS = {
  outline: '#3a2142', cap: '#9b5de5', spot: '#fff1d6',
  body: '#ffe9c9', eye: '#2a1830', cheek: 'rgba(255,120,160,0.55)', foot: '#6b3b2a'
};
function drawMushroom(ctx, x, y, w, h, walk, dir, squash) {
  const C = MUSHROOM_COLORS;
  const flat = squash < 1;
  ctx.save();
  ctx.translate(Math.round(x + w / 2), Math.round(y + h));
  if (flat) ctx.scale(1 + (1 - squash) * 0.5, squash);
  ctx.translate(-w / 2, -h);
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = C.outline;

  // 발 (걸을 때 번갈아 들림)
  const step = Math.floor(Math.abs(walk) / 6) % 2;
  ctx.fillStyle = C.foot;
  for (const [fx, up] of [[10, step === 0], [w - 10, step === 1]]) {
    ctx.beginPath();
    ctx.ellipse(fx, h - 3.5 - (up && !flat ? 1.5 : 0), 6.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 몸통
  roundRectPath(ctx, 7, 12, w - 14, h - 17, 6);
  ctx.fillStyle = C.body;
  ctx.fill();
  ctx.stroke();

  // 얼굴 (진행 방향을 바라봄)
  const ex = dir * 1.5;
  if (flat) {
    ctx.lineWidth = 2;
    for (const cx of [13 + ex, w - 13 + ex]) {
      ctx.beginPath();
      ctx.moveTo(cx - 2.5, 19); ctx.lineTo(cx + 2.5, 24);
      ctx.moveTo(cx + 2.5, 19); ctx.lineTo(cx - 2.5, 24);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = C.eye;
    for (const cx of [13 + ex, w - 13 + ex]) {
      ctx.beginPath(); ctx.ellipse(cx, 21, 2.3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fff';
    for (const cx of [13.8 + ex, w - 12.2 + ex]) {
      ctx.beginPath(); ctx.arc(cx, 19.6, 0.9, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = C.cheek;
  for (const cx of [9.5 + ex, w - 9.5 + ex]) {
    ctx.beginPath(); ctx.ellipse(cx, 25.5, 2.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  }

  // 갓
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(w / 2, 15, w / 2 - 1, 14, 0, Math.PI, 0);
  ctx.quadraticCurveTo(w / 2, 20, 1, 15);
  ctx.closePath();
  ctx.fillStyle = C.cap;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.spot;
  for (const [sx, sy, r] of [[9, 9.5, 3.2], [19, 5, 2.6], [26, 12, 2.3]]) {
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
