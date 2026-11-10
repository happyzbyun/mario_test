// localStorage 저장/불러오기 (F-22 ~ F-27). 사용 불가/손상 데이터에서도 예외를 밖으로 던지지 않는다.
const SAVE_KEY = 'mario_save_v1';
const BEST_KEY = 'mario_best_v1';
const CHAR_KEY = 'mario_char_v1';
const SAVE_VERSION = 1;

const Store = {
  _ok: null,

  // localStorage 접근 자체가 예외를 던지는 환경(차단, 일부 프라이빗 모드)을 걸러낸다.
  available() {
    if (this._ok !== null) return this._ok;
    try {
      localStorage.setItem('__mario_test', '1');
      localStorage.removeItem('__mario_test');
      this._ok = true;
    } catch (e) {
      this._ok = false;
    }
    return this._ok;
  },

  read(key) {
    if (!this.available()) return null;
    try {
      const s = localStorage.getItem(key);
      return s === null ? null : JSON.parse(s);
    } catch (e) {
      return null; // 손상된 JSON
    }
  },

  write(key, value) {
    if (!this.available()) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  },

  remove(key) {
    if (!this.available()) return false;
    try { localStorage.removeItem(key); return true; } catch (e) { return false; }
  },

  // ---- 진행 상황 ----
  loadSave() {
    const d = this.read(SAVE_KEY);
    return isValidSave(d) ? d : null;
  },
  writeSave(data) { return this.write(SAVE_KEY, data); },
  clearSave() { return this.remove(SAVE_KEY); },

  // ---- 최고 기록 (F-26, PRD 7장) ----
  // total: 5개 스테이지 전체 최단 총 시간, stages: 스테이지별 최단 시간 (없으면 null)
  // v1.6 이전의 { bestTimeSec } 형식은 1개 스테이지 기록이라 무시한다.
  loadBest() {
    const d = this.read(BEST_KEY);
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    const stages = [];
    for (let i = 0; i < STAGE_COUNT; i++) {
      stages.push(d && Array.isArray(d.stageBestSec) && ok(d.stageBestSec[i]) ? d.stageBestSec[i] : null);
    }
    return { total: d && ok(d.bestTotalSec) ? d.bestTotalSec : null, stages };
  },
  writeBest(best) {
    return this.write(BEST_KEY, { bestTotalSec: best.total, stageBestSec: best.stages });
  },
  // 스테이지 기록 제출. 신기록이면 저장하고 true. (stageIdx 는 0부터)
  submitStageTime(stageIdx, sec) {
    const best = this.loadBest();
    const prev = best.stages[stageIdx];
    if (prev !== null && sec >= prev) return false;
    best.stages[stageIdx] = sec;
    return this.writeBest(best); // 저장하지 못했으면 신기록으로 표시하지 않는다 (F-53)
  },
  // 전체 클리어 총 시간 제출. 신기록이면 저장하고 true.
  submitTotalTime(sec) {
    const best = this.loadBest();
    if (best.total !== null && sec >= best.total) return false;
    best.total = sec;
    return this.writeBest(best); // F-53
  },

  // ---- 마지막으로 고른 캐릭터 ----
  loadChar() {
    const d = this.read(CHAR_KEY);
    return d && typeof d.lastCharacter === 'string' ? d.lastCharacter : null;
  },
  saveChar(id) { return this.write(CHAR_KEY, { lastCharacter: id }); }
};

function isValidSave(d) {
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!d || typeof d !== 'object' || d.version !== SAVE_VERSION) return false;
  if (!CHARACTERS.some((c) => c.id === d.character)) return false;
  if (!d.player || !num(d.player.x) || !num(d.player.y)) return false;
  if (d.player.x < 0 || d.player.x > MAP_W || d.player.y < -500 || d.player.y > MAP_H) return false;
  if (!num(d.distance) || !num(d.elapsedSec) || d.elapsedSec < 0) return false;
  // v1.7 항목 (F-50). 없으면 1 스테이지, 총 시간 0 으로 읽는다.
  if (d.stage !== undefined && !(Number.isInteger(d.stage) && d.stage >= 1 && d.stage <= STAGE_COUNT)) return false;
  if (d.totalSec !== undefined && !(num(d.totalSec) && d.totalSec >= 0)) return false;
  // v1.8 항목 (F-42): 아직 먹지 않은 파워 열매
  if (d.items !== undefined &&
    !(Array.isArray(d.items) && d.items.every((it) => it && num(it.x) && num(it.y) && (it.dir === 1 || it.dir === -1)))) return false;
  // v1.6 항목 (F-42). 예전 저장 데이터에는 없을 수 있으므로 있을 때만 형식을 검사한다.
  if (d.player.big !== undefined && typeof d.player.big !== 'boolean') return false;
  if (d.usedBlocks !== undefined &&
    !(Array.isArray(d.usedBlocks) && d.usedBlocks.every((b) => Array.isArray(b) && b.length === 2 && Number.isInteger(b[0]) && Number.isInteger(b[1])))) return false;
  if (!Array.isArray(d.enemies)) return false;
  return d.enemies.every((e) =>
    e && num(e.id) && num(e.x) && num(e.y) && (e.dir === 1 || e.dir === -1) && typeof e.alive === 'boolean');
}
