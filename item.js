// 파워 열매 (F-38 ~ F-40). 물음표 블록에서 솟아 나와 좌우로 움직이고, 주인공이 먹으면 커진다.
const ITEM_W = 30;
const ITEM_H = 30;
const ITEM_SPEED = 1.5;
const ITEM_RISE_FRAMES = 30; // 블록 위로 다 솟아 나오는 데 걸리는 프레임

class Item {
  // 물음표 블록 [열, 행] 위치에서 생긴다. 처음에는 블록 안에 있다가 위로 솟아오른다.
  constructor(col, row) {
    this.w = ITEM_W;
    this.h = ITEM_H;
    this.x = col * TILE + (TILE - ITEM_W) / 2;
    this.startY = row * TILE;          // 블록 윗면과 같은 높이에서 시작 (블록 뒤에 가려짐)
    this.endY = row * TILE - ITEM_H;   // 블록 바로 위
    this.y = this.startY;
    this.vy = 0;
    this.dir = 1;
    this.rise = 0;
    this.alive = true;
  }

  get rising() { return this.rise < ITEM_RISE_FRAMES; }

  // 저장용 (F-42). 솟아오르는 중이던 열매는 다 솟아 나온 위치로 저장한다.
  toJSON() {
    return { x: this.x, y: this.rising ? this.endY : this.y, dir: this.dir };
  }

  static fromSave(s) {
    const it = new Item(0, 0);
    it.x = s.x;
    it.y = s.y;
    it.dir = s.dir === -1 ? -1 : 1;
    it.rise = ITEM_RISE_FRAMES;
    return it;
  }

  update(map) {
    if (this.rising) {
      this.rise++;
      this.y = this.startY + (this.endY - this.startY) * (this.rise / ITEM_RISE_FRAMES);
      return;
    }

    // 좌우 이동: 벽/블록/맵 가장자리에서 방향 전환 (버섯과 같은 방식)
    this.x += this.dir * ITEM_SPEED;
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

    // 중력 + 착지. 구덩이에 빠지면 사라진다 (F-39)
    this.vy = Math.min(this.vy + PHYSICS.gravity, PHYSICS.maxFall);
    this.y += this.vy;
    if (this.vy > 0) {
      const left = Math.floor(this.x / TILE);
      const right = Math.floor((this.x + this.w - 0.01) / TILE);
      const row = Math.floor((this.y + this.h) / TILE);
      for (let c = left; c <= right; c++) {
        if (map.isSolid(c, row)) { this.y = row * TILE - this.h; this.vy = 0; break; }
      }
    }
    if (this.y > map.height + 100) this.alive = false;
  }

  // 솟아오르는 동안은 블록 윗면 아래 부분을 잘라서 블록 안에서 나오는 것처럼 보이게 한다.
  draw(ctx, camX, now) {
    ctx.save();
    if (this.rising) {
      ctx.beginPath();
      ctx.rect(this.x - camX - 10, this.endY - 40, this.w + 20, this.startY - this.endY + 40);
      ctx.clip();
    }
    drawPowerFruit(ctx, this.x - camX + this.w / 2, this.y + this.h, this.w, now);
    ctx.restore();
  }
}

// 파워 열매 모양 (오리지널 디자인: 잎 달린 청록색 열매). (cx, bottom) 기준, size 는 지름 정도.
function drawPowerFruit(ctx, cx, bottom, size, now) {
  const r = size * 0.42;
  const cy = bottom - r - 1;
  const glow = 0.5 + Math.sin((now || 0) / 160) * 0.2;
  ctx.save();
  // 은은한 빛
  ctx.fillStyle = 'rgba(120, 255, 220, ' + (glow * 0.45) + ')';
  ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.fill();
  // 열매
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#0f3d3a';
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, 1, cx, cy, r);
  g.addColorStop(0, '#9ff7e3');
  g.addColorStop(0.55, '#2ec4a6');
  g.addColorStop(1, '#14897a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // 줄기와 잎
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy - r + 1); ctx.lineTo(cx + 1, cy - r - 5); ctx.stroke();
  ctx.fillStyle = '#7ad94a';
  ctx.strokeStyle = '#2f6b1f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx + 7, cy - r - 4, 7, 3.5, -0.4, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // 반짝임
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath(); ctx.ellipse(cx - r * 0.38, cy - r * 0.35, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
