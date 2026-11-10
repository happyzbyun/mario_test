// 물리 상수는 여기 한 곳에서 튜닝한다. 단위: px/frame (고정 60Hz 기준)
const PHYSICS = {
  accel: 0.5,        // 이동 가속
  maxSpeed: 4,       // 최대 이동 속도
  friction: 0.8,     // 키를 뗐을 때 감속 배율
  gravity: 0.6,      // 중력
  jumpSpeed: -12,    // 점프 초기 속도
  maxFall: 15,       // 낙하 속도 상한 (터널링 방지, TILE보다 충분히 작게)
  stompBounce: -7,   // 밟기 반동
  enemySpeed: 1,     // 버섯 기본 이동 속도 (스테이지별 값은 map.js STAGES.enemySpeed)
  coyoteFrames: 6,   // F-52: 발판에서 걸어 떨어진 뒤에도 점프할 수 있는 프레임
  jumpBufferFrames: 6 // F-52: 착지 직전에 누른 점프를 기억하는 프레임
};

const PLAYER_W = 32;
const PLAYER_H = 44;
// 커진 상태 히트박스 (F-40). 공중 블록 아래 통로가 50px 이므로 높이는 50 미만이어야 한다.
const PLAYER_BIG_W = 38;
const PLAYER_BIG_H = 48;
const HURT_INVINCIBLE_FRAMES = 90; // 커진 상태에서 맞은 뒤 무적 시간 (F-41, 약 1.5초)
const GROW_ANIM_MS = 500;          // 커지거나 작아질 때 깜빡이는 연출 시간

// 선택 가능한 주인공. 외형만 다르고 히트박스와 물리는 모두 같다. (F-33)
// 이미지가 없을 때(F-34)는 color 로 칠한 사각형으로 대체한다.
const CHARACTERS = [
  { id: 'armor', name: '아머 히어로', color: '#d63031', img: 'assets/armor.png' },
  { id: 'bunny', name: '핑크 토끼',  color: '#ff96be', img: 'assets/bunny.png' },
  { id: 'puppy', name: '구름 강아지', color: '#c48c5c', img: 'assets/puppy.png' }
];
function characterIndex(id) {
  const i = CHARACTERS.findIndex((c) => c.id === id);
  return i === -1 ? 0 : i;
}

// ---- 캐릭터 이미지 (13.4) ----
// 게임 시작 전에 미리 불러온다. 실패한 이미지는 null 로 두고 대체 도형으로 그린다 (F-34).
const CHAR_IMAGES = {};
const PRELOAD_TIMEOUT_MS = 3000;
function preloadCharacterImages(done) {
  let left = CHARACTERS.length;
  let finished = false;
  const finish = () => { if (!finished) { finished = true; done(); } };
  CHARACTERS.forEach((c) => {
    const img = new Image();
    img.onload = () => { CHAR_IMAGES[c.id] = img; if (--left === 0) finish(); };
    img.onerror = () => { CHAR_IMAGES[c.id] = null; if (--left === 0) finish(); };
    img.src = c.img;
  });
  setTimeout(finish, PRELOAD_TIMEOUT_MS); // 너무 오래 걸리면 대체 도형으로 시작
}

// 화면에 그리는 캐릭터 크기(px). 히트박스(PLAYER_W x PLAYER_H)와는 별개인 순수 외형 값.
const SPRITE_SIZE = 52;
const SPRITE_BIG_SIZE = 68; // 커진 상태 외형 (약 1.3배)

// 캐릭터를 발밑 중앙(cx, bottom) 기준으로 그린다. 이미지(64x64, 오른쪽 바라봄)는 facing 이 -1 이면 좌우 반전.
// sx, sy: 늘리기/누르기 배율, tilt: 기울기(라디안)
function drawCharacterSprite(ctx, id, cx, bottom, size, facing, sx, sy, tilt) {
  const img = CHAR_IMAGES[id];
  ctx.save();
  ctx.translate(cx, bottom);
  if (tilt) ctx.rotate(tilt);
  ctx.scale((facing === -1 ? -1 : 1) * (sx || 1), sy || 1);
  if (img) {
    ctx.drawImage(img, -size / 2, -size, size, size);
  } else {
    // 대체 도형: 히트박스 비율의 단색 사각형 + 바라보는 쪽 눈
    const w = size * (PLAYER_W / SPRITE_SIZE);
    const h = size * (PLAYER_H / SPRITE_SIZE);
    ctx.fillStyle = CHARACTERS[characterIndex(id)].color;
    ctx.fillRect(-w / 2, -h, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(w / 2 - w * 0.38, -h + h * 0.22, w * 0.25, w * 0.25);
  }
  ctx.restore();
}

class Player {
  constructor(x, y) {
    this.w = PLAYER_W;
    this.h = PLAYER_H;
    this.character = 'armor';
    this.spawnX = x;
    this.spawnY = y;
    this.reset();
  }

  reset() {
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.facing = 1; // 1: 오른쪽, -1: 왼쪽
    this.fallSpeed = 0; // 이번 프레임 충돌 처리 직전의 vy (밟기 판정용)
    this.coyote = 0;     // F-52: 남은 코요테 타임 프레임
    this.jumpBuffer = 0; // F-52: 남은 점프 입력 버퍼 프레임
    // 크기 상태 (F-40, F-41)
    this.big = false;
    this.w = PLAYER_W;
    this.h = PLAYER_H;
    this.pendingGrow = false; // 열매를 먹었지만 머리 위가 막혀 아직 못 커진 상태
    this.invincible = 0;      // 남은 무적 프레임
    this.sizeChangedAt = -Infinity;
    // 그리기 전용 상태 (물리에는 쓰지 않는다)
    this.wasOnGround = true;
    this.landAt = -Infinity;
  }

  // input: { left, right, jumpPressed }
  update(input, map) {
    const P = PHYSICS;

    if (this.invincible > 0) this.invincible--;
    if (this.pendingGrow) this.setBig(true, map);

    // 좌우 이동 (가속 / 마찰)
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      this.vx += dir * P.accel;
      this.vx = Math.max(-P.maxSpeed, Math.min(P.maxSpeed, this.vx));
      this.facing = dir;
    } else {
      this.vx *= P.friction;
      if (Math.abs(this.vx) < 0.05) this.vx = 0;
    }

    // 점프 (1단 점프, F-2) + 조작 보정 (F-52)
    //  코요테 타임: 바닥에 있으면 충전, 공중에서는 줄어든다. 점프하면 0 이 되므로 공중 재점프는 불가.
    //  입력 버퍼: Space 를 누르면 몇 프레임 동안 기억했다가 바닥(또는 코요테 타임)에서 실행한다.
    if (this.onGround) this.coyote = P.coyoteFrames;
    else if (this.coyote > 0) this.coyote--;
    if (input.jumpPressed) this.jumpBuffer = P.jumpBufferFrames;
    else if (this.jumpBuffer > 0) this.jumpBuffer--;
    if (this.jumpBuffer > 0 && (this.onGround || this.coyote > 0)) {
      this.vy = P.jumpSpeed;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }

    // 중력
    this.vy = Math.min(this.vy + P.gravity, P.maxFall);
    this.fallSpeed = this.vy;

    // 축별 분리 충돌 처리: x 먼저, 그다음 y
    this.moveX(map);
    this.moveY(map);
  }

  moveX(map) {
    this.x += this.vx;

    // F-5: 맵 좌측 경계 밖으로 나갈 수 없다. 우측도 맵 끝에서 막는다.
    if (this.x < 0) { this.x = 0; this.vx = 0; }
    if (this.x + this.w > map.width) { this.x = map.width - this.w; this.vx = 0; }

    const top = Math.floor(this.y / TILE);
    const bottom = Math.floor((this.y + this.h - 0.01) / TILE);
    if (this.vx > 0) {
      const col = Math.floor((this.x + this.w) / TILE);
      for (let r = top; r <= bottom; r++) {
        if (map.isSolid(col, r)) { this.x = col * TILE - this.w; this.vx = 0; break; }
      }
    } else if (this.vx < 0) {
      const col = Math.floor(this.x / TILE);
      for (let r = top; r <= bottom; r++) {
        if (map.isSolid(col, r)) { this.x = (col + 1) * TILE; this.vx = 0; break; }
      }
    }
  }

  moveY(map) {
    this.y += this.vy;
    this.onGround = false;

    const left = Math.floor(this.x / TILE);
    const right = Math.floor((this.x + this.w - 0.01) / TILE);
    if (this.vy > 0) {
      const row = Math.floor((this.y + this.h) / TILE);
      for (let c = left; c <= right; c++) {
        if (map.isSolid(c, row)) {
          this.y = row * TILE - this.h;
          this.vy = 0;
          this.onGround = true;
          break;
        }
      }
    } else if (this.vy < 0) {
      const row = Math.floor(this.y / TILE);
      const center = Math.floor((this.x + this.w / 2) / TILE);
      let hit = -1;
      for (let c = left; c <= right; c++) {
        if (!map.isSolid(c, row)) continue;
        // 머리가 두 칸에 걸치면 몸 중심에 가까운 칸을 친 것으로 본다.
        if (hit === -1 || Math.abs(c - center) < Math.abs(hit - center)) hit = c;
      }
      if (hit !== -1) {
        this.y = (row + 1) * TILE;
        this.vy = 0;
        map.bump(hit, row); // F-36
      }
    }
  }

  // 크기를 바꾼다. 발밑 중앙을 기준으로 커지거나 작아진다.
  // 커질 공간이 없으면 pendingGrow 로 남겨 두고 다음 업데이트에서 다시 시도한다. 바꿨으면 true.
  setBig(big, map) {
    const nw = big ? PLAYER_BIG_W : PLAYER_W;
    const nh = big ? PLAYER_BIG_H : PLAYER_H;
    const nx = Math.max(0, this.x + (this.w - nw) / 2);
    const ny = this.y + this.h - nh;
    if (big && map && map.boxHitsSolid(nx, ny, nw, nh)) { this.pendingGrow = true; return false; }
    this.pendingGrow = false;
    if (this.big !== big) this.sizeChangedAt = performance.now();
    this.big = big;
    this.x = nx; this.y = ny; this.w = nw; this.h = nh;
    return true;
  }

  // 파워 열매를 먹음 (F-40)
  powerUp(map) {
    if (!this.big) this.setBig(true, map);
  }

  // 버섯에 옆으로 닿음. 커진 상태면 작아지고 무적, 작은 상태면 true(사망)를 돌려준다. (F-41)
  hurt() {
    if (this.invincible > 0) return false;
    if (this.big || this.pendingGrow) {
      this.setBig(false);
      this.invincible = HURT_INVINCIBLE_FRAMES;
      return false;
    }
    return true;
  }

  // 구덩이로 떨어졌는지 (맵 아래로 완전히 벗어남)
  isBelowMap(map) { return this.y > map.height + 100; }

  // 선택한 캐릭터 이미지를 히트박스 발밑에 맞춰 그린다. (F-30)
  // 달리기: 살짝 통통 튐 / 공중: 세로로 늘어남 / 착지: 잠깐 납작해짐. 모두 외형만 바꾸고 히트박스는 그대로다.
  draw(ctx, camX, now, map) {
    if (this.onGround && !this.wasOnGround) this.landAt = now;
    this.wasOnGround = this.onGround;

    // 무적 중에는 깜빡인다
    if (this.invincible > 0 && Math.floor(now / 70) % 2 === 0) return;

    // 크기 바뀌는 중에는 작은/큰 모습을 번갈아 보여준다
    let size = this.big ? SPRITE_BIG_SIZE : SPRITE_SIZE;
    const changeT = now - this.sizeChangedAt;
    if (changeT < GROW_ANIM_MS && Math.floor(changeT / 80) % 2 === 1) size = this.big ? SPRITE_SIZE : SPRITE_BIG_SIZE;
    // 머리 위가 낮으면 그릴 때만 줄인다 (히트박스는 그대로)
    if (map) size = Math.min(size, Math.max(SPRITE_SIZE, this.headroom(map) * 1.04));

    let sx = 1, sy = 1, tilt = 0, bob = 0;
    const landT = (now - this.landAt) / 150;
    if (!this.onGround) {
      sx = 0.93; sy = 1.08;
      tilt = this.facing * (this.vy < 0 ? -0.06 : 0.05);
    } else if (landT < 1) {
      const k = 1 - landT;
      sx = 1 + 0.16 * k; sy = 1 - 0.14 * k;
    } else if (Math.abs(this.vx) > 0.3) {
      bob = -Math.abs(Math.sin(now / 65)) * 3;
      tilt = this.facing * 0.05;
    }
    const cx = this.x - camX + this.w / 2;
    const bottom = this.y + this.h + 1 + bob; // 이미지 아래쪽 투명 여백만큼 내려 발을 바닥에 붙인다
    drawCharacterSprite(ctx, this.character, cx, bottom, size, this.facing, sx, sy, tilt);
  }

  // 발밑에서 바로 위 단단한 타일 아랫면까지의 거리 (최대 2칸까지만 본다)
  headroom(map) {
    const c0 = Math.floor(this.x / TILE), c1 = Math.floor((this.x + this.w - 0.01) / TILE);
    const feet = this.y + this.h;
    let ceil = -Infinity;
    const rTop = Math.floor(this.y / TILE);
    for (let r = rTop; r >= rTop - 2; r--) {
      for (let c = c0; c <= c1; c++) if (map.isSolid(c, r)) ceil = Math.max(ceil, (r + 1) * TILE);
      if (ceil > -Infinity) break;
    }
    return ceil === -Infinity ? Infinity : feet - ceil;
  }
}
