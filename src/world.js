// 世界：地形生成、格子数据、建筑占位、道路寻路、风水与水源计算
import { N, BUILDINGS, FENGSHUI, T_GRASS, T_WATER, T_MOUNTAIN } from './config.js';
import { makeNoise, smoothstep } from './noise.js';

const EXT = 7; // 风水计算时向地图外延伸的格数（让边缘外的山也算数）

export class World {
  constructor(seed = 20261126) {
    this.N = N;
    this.seed = seed;
    const nz = makeNoise(seed);
    this.fbm = nz.fbm;
    this.rand = nz.rand;
    const S = N * N;
    this.type = new Uint8Array(S);
    this.road = new Uint8Array(S);
    this.occ = new Int32Array(S).fill(-1);
    this.tree = new Uint8Array(S);      // 0 无 1 松 2 阔叶
    this.fengshui = new Float32Array(S);
    this.water = new Uint8Array(S);     // 0 无 1 河 2 井
    this.reach = new Uint8Array(S);     // 与官道连通的道路
    this.protectedRoad = new Uint8Array(S);
    this.buildings = new Map();
    this.nextId = 1;
    this.listeners = {};
    this.entry = { i: 0, j: N / 2 };
    this.generate();
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach(fn => fn(data)); }

  idx(i, j) { return j * N + i; }
  inside(i, j) { return i >= 0 && j >= 0 && i < N && j < N; }

  // ---------- 连续地形函数（u, v 为格坐标，可超出地图） ----------
  riverCenter(v) { return N * 0.72 + Math.sin(v * 0.11) * 4 + Math.sin(v * 0.043 + 1.3) * 3; }
  riverHalf(v) { return 1.45 + 0.5 * Math.sin(v * 0.07 + 0.5); }
  mountainAt(u, v) {
    const n = this.fbm(u * 0.07, v * 0.07, 5);
    let bias = smoothstep(17, -3, v) * 0.6 + smoothstep(12, -5, N - v) * 0.32;
    bias += smoothstep(N - 4, N + 8, u) * 0.35;
    bias += smoothstep(6, -6, u) * 0.18 * smoothstep(4, 10, Math.abs(v - N / 2));
    const rd = Math.abs(u - this.riverCenter(v));
    bias *= smoothstep(1.5, 7, rd);
    return Math.max(0, n + bias - 0.8) * 7.5;
  }
  heightAt(u, v) {
    const d = Math.abs(u - this.riverCenter(v)), hw = this.riverHalf(v);
    const land = (this.fbm(u * 0.25 + 31, v * 0.25 + 11, 3) - 0.5) * 0.05;
    const m = this.mountainAt(u, v);
    const r = -0.95 * smoothstep(hw + 0.5, hw - 0.9, d);
    return land + m + r;
  }
  classify(u, v) {
    if (Math.abs(u - this.riverCenter(v)) < this.riverHalf(v)) return T_WATER;
    if (this.mountainAt(u, v) > 0.1) return T_MOUNTAIN;
    return T_GRASS;
  }

  generate() {
    const E = N + EXT * 2;
    this.extType = new Uint8Array(E * E);
    for (let j = 0; j < E; j++) for (let i = 0; i < E; i++) {
      this.extType[j * E + i] = this.classify(i - EXT + 0.5, j - EXT + 0.5);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      this.type[this.idx(i, j)] = this.extType[(j + EXT) * E + (i + EXT)];
    }
    // 官道：从西侧地图边缘向东延伸
    const ej = this.entry.j;
    for (let i = 0; i < 20; i++) {
      const k = this.idx(i, ej);
      this.type[k] = T_GRASS;
      this.road[k] = 1;
      this.protectedRoad[k] = 1;
    }
    // 树林
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = this.idx(i, j);
      if (this.type[k] !== T_GRASS || this.road[k]) continue;
      const forest = this.fbm(i * 0.11 + 50, j * 0.11 + 80, 4);
      const nearStart = i > 8 && i < 30 && Math.abs(j - ej) < 7;
      const r = this.rand();
      let t = false;
      if (nearStart) t = r < 0.012;
      else t = (forest > 0.58 && r < 0.8) || r < 0.03;
      if (t) this.tree[k] = this.rand() < 0.55 ? 1 : 2;
    }
    this.recomputeAll();
  }

  // ---------- 放置与拆除 ----------
  footprint(i, j, size) {
    const out = [];
    for (let dj = 0; dj < size; dj++) for (let di = 0; di < size; di++) out.push([i + di, j + dj]);
    return out;
  }

  canPlace(kind, i, j) {
    const def = BUILDINGS[kind];
    let trees = 0;
    for (const [x, y] of this.footprint(i, j, def.size)) {
      if (!this.inside(x, y)) return { ok: false, reason: '超出地图' };
      const k = this.idx(x, y);
      if (this.type[k] === T_WATER) return { ok: false, reason: '不能建在水上' };
      if (this.type[k] === T_MOUNTAIN) return { ok: false, reason: '山地无法建造' };
      if (this.road[k]) return { ok: false, reason: kind === 'road' ? '已有道路' : '此处有道路' };
      if (this.occ[k] >= 0) return { ok: false, reason: '已被占用' };
      if (this.tree[k]) trees++;
    }
    if (def.nearWater) {
      const R = def.nearWater;
      let near = false;
      for (let y = j - R; y < j + def.size + R && !near; y++) for (let x = i - R; x < i + def.size + R; x++) {
        if (this.inside(x, y) && this.type[this.idx(x, y)] === T_WATER) { near = true; break; }
      }
      if (!near) return { ok: false, reason: `须建在河边 ${R} 格内` };
    }
    return { ok: true, trees };
  }

  clearTrees(i, j, size) {
    let n = 0;
    for (const [x, y] of this.footprint(i, j, size)) {
      const k = this.idx(x, y);
      if (this.tree[k]) { this.tree[k] = 0; n++; }
    }
    if (n) this.emit('trees');
    return n;
  }

  placeRoad(i, j) {
    const k = this.idx(i, j);
    this.clearTrees(i, j, 1);
    this.road[k] = 1;
  }

  placeBuilding(kind, i, j, sizeOverride) {
    const def = BUILDINGS[kind];
    const size = sizeOverride || def.size;
    this.clearTrees(i, j, size);
    const b = { id: this.nextId++, type: kind, i, j, size };
    for (const [x, y] of this.footprint(i, j, size)) this.occ[this.idx(x, y)] = b.id;
    this.buildings.set(b.id, b);
    return b;
  }

  removeAt(i, j) {
    if (!this.inside(i, j)) return null;
    const k = this.idx(i, j);
    if (this.occ[k] >= 0) {
      const b = this.buildings.get(this.occ[k]);
      for (const [x, y] of this.footprint(b.i, b.j, b.size)) this.occ[this.idx(x, y)] = -1;
      this.buildings.delete(b.id);
      return { kind: 'building', b };
    }
    if (this.road[k] && !this.protectedRoad[k]) { this.road[k] = 0; return { kind: 'road' }; }
    if (this.tree[k]) { this.tree[k] = 0; this.emit('trees'); return { kind: 'tree' }; }
    return null;
  }

  buildingAt(i, j) {
    if (!this.inside(i, j)) return null;
    const id = this.occ[this.idx(i, j)];
    return id >= 0 ? this.buildings.get(id) : null;
  }

  // ---------- 道路连通与寻路 ----------
  computeReach() {
    this.reach.fill(0);
    const start = this.idx(this.entry.i, this.entry.j);
    if (!this.road[start]) return;
    const q = [start];
    this.reach[start] = 1;
    while (q.length) {
      const k = q.pop();
      const i = k % N, j = (k / N) | 0;
      for (const [x, y] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (!this.inside(x, y)) continue;
        const kk = this.idx(x, y);
        if (this.road[kk] && !this.reach[kk]) { this.reach[kk] = 1; q.push(kk); }
      }
    }
  }

  // 建筑周边的道路格：r=1 为四邻接（不含对角），r>1 为切比雪夫距离
  roadsNear(b, r = 1) {
    const out = [];
    for (let y = b.j - r; y < b.j + b.size + r; y++) for (let x = b.i - r; x < b.i + b.size + r; x++) {
      if (!this.inside(x, y)) continue;
      const inX = x >= b.i && x < b.i + b.size, inY = y >= b.j && y < b.j + b.size;
      if (inX && inY) continue;
      if (r === 1 && !inX && !inY) continue;
      const k = this.idx(x, y);
      if (this.road[k]) out.push(k);
    }
    return out;
  }

  hasAccess(b) {
    const r = b.type === 'house' ? 2 : 1;
    return this.roadsNear(b, r).length > 0;
  }
  isConnected(b) {
    const r = b.type === 'house' ? 2 : 1;
    return this.roadsNear(b, r).some(k => this.reach[k]);
  }

  // BFS：从起点集合沿道路找到任一目标格，返回格索引数组
  findPath(starts, goals) {
    const goalSet = goals instanceof Set ? goals : new Set(goals);
    if (!starts.length || !goalSet.size) return null;
    const prev = new Int32Array(N * N).fill(-2);
    const q = [];
    for (const s of starts) { if (this.road[s] && prev[s] === -2) { prev[s] = -1; q.push(s); } }
    let head = 0;
    while (head < q.length) {
      const k = q[head++];
      if (goalSet.has(k)) {
        const path = [];
        for (let c = k; c !== -1; c = prev[c]) path.push(c);
        return path.reverse();
      }
      const i = k % N, j = (k / N) | 0;
      for (const [x, y] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (!this.inside(x, y)) continue;
        const kk = this.idx(x, y);
        if (this.road[kk] && prev[kk] === -2) { prev[kk] = k; q.push(kk); }
      }
    }
    return null;
  }

  roadNeighbors(k) {
    const i = k % N, j = (k / N) | 0, out = [];
    for (const [x, y] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (this.inside(x, y) && this.road[this.idx(x, y)]) out.push(this.idx(x, y));
    }
    return out;
  }

  // ---------- 水源与风水 ----------
  computeWater() {
    this.water.fill(0);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (this.type[this.idx(i, j)] !== T_WATER) continue;
      for (let y = j - 1; y <= j + 1; y++) for (let x = i - 1; x <= i + 1; x++) {
        if (this.inside(x, y) && this.type[this.idx(x, y)] !== T_WATER) this.water[this.idx(x, y)] = 1;
      }
    }
    const R = BUILDINGS.well.radius;
    for (const b of this.buildings.values()) {
      if (b.type !== 'well') continue;
      for (let y = b.j - R; y <= b.j + R; y++) for (let x = b.i - R; x <= b.i + R; x++) {
        if (!this.inside(x, y)) continue;
        if ((x - b.i) ** 2 + (y - b.j) ** 2 <= (R + 0.5) ** 2) this.water[this.idx(x, y)] = 2;
      }
    }
  }

  computeFengshui() {
    const S = N * N, E = N + EXT * 2;
    const natW = new Float32Array(S), natM = new Float32Array(S), treeS = new Float32Array(S), sum = new Float32Array(S);
    const splat = (cx, cy, [s, r], arr, mode, w = 1) => {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r + 0.5) continue;
        const v = s * w * (1 - d / (r + 1));
        const k = y * N + x;
        if (mode === 'max') arr[k] = Math.max(arr[k], v); else arr[k] += v;
      }
    };
    for (let j = 0; j < E; j++) for (let i = 0; i < E; i++) {
      const t = this.extType[j * E + i];
      const cx = i - EXT + 0.5, cy = j - EXT + 0.5;
      if (t === T_WATER) splat(cx, cy, FENGSHUI.water, natW, 'max');
      else if (t === T_MOUNTAIN) splat(cx, cy, FENGSHUI.mountain, natM, 'max');
    }
    for (let k = 0; k < S; k++) {
      if (this.tree[k]) splat(k % N + 0.5, ((k / N) | 0) + 0.5, FENGSHUI.tree, treeS, 'sum');
      if (this.road[k]) splat(k % N + 0.5, ((k / N) | 0) + 0.5, FENGSHUI.road, sum, 'sum');
    }
    for (const b of this.buildings.values()) {
      if (b.type === 'ruin') { splat(b.i + b.size / 2, b.j + b.size / 2, [-1.5, 2], sum, 'sum'); continue; }
      const key = b.type === 'house' ? (b.level >= 5 ? 'house5' : b.level === 4 ? 'house4' : b.level === 3 ? 'house3' : null) : b.type;
      const src = key && FENGSHUI[key];
      if (src) splat(b.i + b.size / 2, b.j + b.size / 2, src, sum, 'sum');
    }
    for (let k = 0; k < S; k++) {
      this.fengshui[k] = natW[k] + natM[k] + Math.min(2, treeS[k]) + sum[k];
    }
  }

  // 汛险：离河 reach 格内的陆地，且不在河堤保护范围内
  computeFlood(reach = 3, leveeR = 3) {
    const S = N * N;
    const dist = new Uint8Array(S).fill(255);
    const q = [];
    for (let k = 0; k < S; k++) if (this.type[k] === T_WATER) { dist[k] = 0; q.push(k); }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % N, j = (k / N) | 0;
      if (dist[k] >= reach) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = i + dx, y = j + dy;
        if (!this.inside(x, y)) continue;
        const kk = this.idx(x, y);
        if (dist[kk] === 255 && this.type[kk] !== T_MOUNTAIN) { dist[kk] = dist[k] + 1; q.push(kk); }
      }
    }
    this.floodRisk = this.floodRisk || new Uint8Array(S);
    this.floodRisk.fill(0);
    for (let k = 0; k < S; k++) if (dist[k] > 0 && dist[k] <= reach && this.type[k] === T_GRASS) this.floodRisk[k] = 1;
    for (const b of this.buildings.values()) {
      if (b.type !== 'levee') continue;
      for (let y = b.j - leveeR; y <= b.j + leveeR; y++) for (let x = b.i - leveeR; x <= b.i + leveeR; x++) if (this.inside(x, y)) this.floodRisk[this.idx(x, y)] = 0;
    }
    this.flooded = this.flooded || new Uint8Array(S);
  }
  inFloodZone(b) { return this.footprint(b.i, b.j, b.size).some(([x, y]) => this.floodRisk[this.idx(x, y)]); }

  recomputeAll() {
    this.computeFlood();
    this.computeReach();
    this.computeWater();
    this.computeFengshui();
    this.emit('tiles');
  }
}
