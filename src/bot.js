// 自动玩家：只用玩家能用的指令（建造 / 拆除 / 商队设定），按看得到的信息做决定。用于自动验收和「AI 自动经营」演示。
import { BUILDINGS, HOUSE_LEVELS, FENGSHUI_L3, FENGSHUI_L4, FENGSHUI_L5, N, T_WATER } from './config.js';

const line = (i0, j0, i1, j1) => {
  const out = [];
  const di = Math.sign(i1 - i0), dj = Math.sign(j1 - j0);
  for (let i = i0, j = j0; ; i += di, j += dj) { out.push([i, j]); if (i === i1 && j === j1) break; }
  return out;
};

// 街道规划：住宅沿东西向街道两侧，中间隔行留给水井与园林；作坊区在东边河岸
const STREETS = [
  { name: '官道西段', tiles: line(7, 24, 13, 24), housing: true },
  { name: '北街', tiles: line(6, 20, 21, 20), housing: true },
  { name: '西巷', tiles: line(6, 19, 6, 33), housing: false },
  { name: '南街', tiles: line(6, 28, 21, 28), housing: true },
  { name: '中巷', tiles: line(22, 19, 22, 33), housing: false },
  { name: '南二街', tiles: line(7, 32, 21, 32), housing: true },
  { name: '东大街', tiles: line(27, 24, 35, 24), housing: false },
  { name: '作坊巷', tiles: line(29, 18, 29, 30), housing: false },
  { name: '北二街', tiles: line(7, 16, 21, 16), housing: true },
  { name: '北巷', tiles: line(14, 16, 14, 18), housing: false },
];

export class Bot {
  constructor(sim, log = () => {}) {
    this.s = sim; this.w = sim.w; this.log = log;
    this.hungry = new Map();     // 民居 id → 连续缺粮的次数
    this.faithless = new Map();
    this.funless = new Map();
    this.builtStreets = new Set();
    this.steps = 0;
  }

  // ---------- 基础 ----------
  can(cost, reserve = 250) { return this.s.money - cost >= reserve; }
  place(kind, i, j, why) {
    const r = this.s.apply(kind, [[i, j]]);
    if (r.placed) this.log(`建${BUILDINGS[kind].name}（${i},${j}）${why ? '：' + why : ''}`);
    return r.placed > 0;
  }
  B(type) { return [...this.w.buildings.values()].filter(b => b.type === type); }
  get houses() { return this.B('house'); }
  fits(kind, i, j) { return this.w.canPlace(kind, i, j).ok; }
  roadOK(kind, i, j) {
    if (kind === 'well' || kind === 'garden' || kind === 'levee') return true;
    const b = { i, j, size: BUILDINGS[kind].size, type: kind };
    return this.w.roadsNear(b, kind === 'house' ? 2 : 1).some(k => this.w.reach[k]);
  }
  // 以 (ai,aj) 为中心一圈圈往外找空地
  findSpot(kind, ai, aj, maxR, pred = () => true) {
    const size = BUILDINGS[kind].size, off = Math.floor((size - 1) / 2);
    for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const i = ai + dx - off, j = aj + dy - off;
      if (this.fits(kind, i, j) && this.roadOK(kind, i, j) && pred(i, j)) return [i, j];
    }
    return null;
  }
  build(kind, ai, aj, maxR, why, pred) {
    if (!this.can(BUILDINGS[kind].cost)) return false;
    const spot = this.findSpot(kind, ai, aj, maxR, pred);
    return spot ? this.place(kind, spot[0], spot[1], why) : false;
  }
  centroid(list) {
    if (!list.length) return [12, 24];
    let x = 0, y = 0; for (const b of list) { x += b.i; y += b.j; }
    return [Math.round(x / list.length), Math.round(y / list.length)];
  }
  isFrontage(i, j) { // 紧挨街道的格子留给民居与作坊
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = i + dx, y = j + dy; if (this.w.inside(x, y) && this.w.road[this.w.idx(x, y)]) return true; }
    return false;
  }

  ensureStreet(st) {
    const todo = st.tiles.filter(([i, j]) => this.w.inside(i, j) && !this.w.road[this.w.idx(i, j)] && this.fits('road', i, j));
    if (!todo.length) { this.builtStreets.add(st.name); return true; }
    const cost = todo.length * 6;
    if (!this.can(cost, 300)) return false;
    this.s.apply('road', todo);
    this.builtStreets.add(st.name);
    this.log(`修${st.name}（${todo.length} 格）`);
    return true;
  }

  // ---------- 各项决策 ----------
  step() {
    const s = this.s;
    if (s.over || s.won) return;
    this.steps++;
    const savingForGoal = s.stage >= 2 && s.goalsDone.has('pop3') && s.goalsDone.has('l5') && s.money > 6000;
    this.clearRuins();
    this.levees();
    this.trade();
    if (savingForGoal) return; // 只差攒钱：不再花钱
    this.food();
    this.water();
    this.housing();
    this.markets();
    this.religionAndFun();
    this.fengshui();
    this.industry();
    this.safety();
  }

  clearRuins() {
    for (const r of this.B('ruin')) {
      if (!this.can(2 * r.size * r.size, 150)) return;
      this.s.apply('clear', this.w.footprint(r.i, r.j, r.size));
      this.log(`清理废墟（${r.i},${r.j}）`);
    }
  }

  levees() {
    const s = this.s;
    if (!s.floodComing) return;
    const threatened = [...this.w.buildings.values()].filter(b => b.type !== 'ruin' && b.type !== 'levee' && this.w.inFloodZone(b));
    for (const b of threatened.slice(0, 6)) {
      if (!this.w.inFloodZone(b)) continue; // 前面修的堤可能已经护住了
      const spot = this.findSpot('levee', b.i, b.j, 4);
      if (spot && this.can(BUILDINGS.levee.cost, 100)) { this.place('levee', spot[0], spot[1], '汛期将至'); this.w.recomputeAll(); }
    }
  }

  food() {
    const s = this.s, A = s.avgStats(3);
    const farms = this.B('farm');
    const need = s.population * 0.35 * 1.25 + 25;
    const supply = farms.length * 60;
    if (supply < need && farms.length < 8) {
      const [gi, gj] = this.granaryAnchor();
      if (!this.build('farm', gi, gj - 4, 16, `粮食不够（月产约 ${Math.round(A.prod.food)}，月耗约 ${Math.round(A.cons.food)}）`)) {
        this.ensureStreet(STREETS.find(t => t.name === '北街'));
      }
    }
    const granaries = this.B('granary');
    const fullOrStuck = granaries.every(g => g.food > 700) || farms.some(f => f.icon === '满仓');
    if (granaries.length < Math.ceil(farms.length / 3) || (fullOrStuck && granaries.length < 4)) {
      const [ci, cj] = this.centroid(farms);
      this.build('granary', ci, cj + 2, 10, '粮仓不够');
    }
  }
  granaryAnchor() { const g = this.B('granary')[0]; return g ? [g.i, g.j] : [15, 25]; }

  water() {
    let n = 0;
    for (const h of this.houses) {
      if (n >= 3) break;
      const k = this.w.idx(h.i, h.j);
      if (this.w.water[k]) continue;
      if (this.build('well', h.i, h.j, 2, '民居缺水', (i, j) => !this.isFrontage(i, j))
        || this.build('well', h.i, h.j, 2, '民居缺水')) n++;
    }
  }

  housing() {
    const s = this.s, hs = this.houses;
    const lots = hs.filter(h => h.level === 0).length;
    const vacancy = hs.reduce((a, h) => a + (h.level ? HOUSE_LEVELS[h.level].cap - h.pop : 0), 0);
    const short = s.demand > s.employed;
    const wantPop = s.stage >= 2 ? 700 : s.stage >= 1 ? 420 : 190;
    if (lots >= 4 || (vacancy > 20 && !short)) return;
    if (s.population > wantPop && !short) return;
    this.addLots(6);
  }
  addLots(n) {
    for (const st of STREETS) {
      if (!st.housing) continue;
      if (!this.builtStreets.has(st.name) && !this.ensureStreet(st)) return;
      const spots = [];
      for (const [i, j] of st.tiles) for (const d of [-1, 1]) {
        const x = st.tiles[0][1] === st.tiles[1][1] ? i : i + d, y = st.tiles[0][1] === st.tiles[1][1] ? j + d : j;
        if (x > 24) continue; // 东边留给作坊
        if (this.fits('house', x, y) && this.roadOK('house', x, y)) spots.push([x, y]);
      }
      if (!spots.length) continue;
      const take = spots.slice(0, n);
      if (!this.can(take.length * 12, 200)) return;
      const r = this.s.apply('house', take);
      if (r.placed) { this.log(`在${st.name}划出 ${r.placed} 块宅地`); return; }
    }
  }

  markets() {
    const s = this.s, hs = this.houses.filter(h => h.level > 0);
    for (const h of hs) this.hungry.set(h.id, h.food <= 0 ? (this.hungry.get(h.id) || 0) + 1 : 0);
    const starving = hs.filter(h => (this.hungry.get(h.id) || 0) >= 4);
    const markets = this.B('market');
    const want = Math.max(1, Math.ceil(hs.length / 16));
    const anyStock = markets.some(m => m.stock.food > 40);
    if (markets.length < want || (starving.length >= 3 && anyStock && markets.length < 5)) {
      const [ci, cj] = this.centroid(starving.length >= 3 ? starving : hs);
      if (this.build('market', ci, cj, 8, starving.length >= 3 ? `${starving.length} 户久未买到粮` : '民居多了')) starving.forEach(h => this.hungry.set(h.id, 0));
    }
  }

  religionAndFun() {
    const s = this.s, hs = this.houses;
    const temples = this.B('temple'), teas = this.B('teahouse');
    if (!temples.length && hs.length >= 8) { const [ci, cj] = this.centroid(hs); this.build('temple', ci, cj + 3, 10, '百姓需要祭祀'); return; }
    for (const h of hs) {
      this.faithless.set(h.id, h.level >= 2 && !h.faith ? (this.faithless.get(h.id) || 0) + 1 : 0);
      this.funless.set(h.id, h.level >= 3 && !h.fun ? (this.funless.get(h.id) || 0) + 1 : 0);
    }
    const noFaith = hs.filter(h => (this.faithless.get(h.id) || 0) >= 6);
    if (noFaith.length >= 4 && temples.length < Math.ceil(hs.length / 18) + 1) {
      const [ci, cj] = this.centroid(noFaith);
      if (this.build('temple', ci, cj, 8, `${noFaith.length} 户缺祭祀`)) noFaith.forEach(h => this.faithless.set(h.id, 0));
    }
    const l3 = hs.filter(h => h.level >= 3);
    if (s.stage >= 1 && l3.length >= 2) {
      const noFun = hs.filter(h => (this.funless.get(h.id) || 0) >= 6);
      if (!teas.length || (noFun.length >= 4 && teas.length < Math.ceil(hs.length / 18) + 1)) {
        const [ci, cj] = this.centroid(teas.length ? noFun : l3);
        if (this.build('teahouse', ci, cj, 8, teas.length ? `${noFun.length} 户缺娱乐` : '宅院要听书')) noFun.forEach(h => this.funless.set(h.id, 0));
      }
    }
  }

  fengshui() {
    let n = 0;
    for (const h of this.houses) {
      if (n >= 2) break;
      if (h.level < 2) continue;
      const need = h.level === 2 ? FENGSHUI_L3 : h.level === 3 ? FENGSHUI_L4 : h.level === 4 ? FENGSHUI_L5 : 0;
      if (!need || h.fs >= need + 0.2) continue;
      if (h.level >= 3 && this.s.stage < 1) continue;
      if (this.build('garden', h.i, h.j, 2, `风水不足（${h.fs.toFixed(1)} < ${need}）`, (i, j) => !this.isFrontage(i, j))) { n++; this.w.recomputeAll(); }
    }
  }

  industry() {
    const s = this.s;
    if (s.stage < 1 && s.population < 130) return;
    if (!this.builtStreets.has('东大街') && !this.ensureStreet(STREETS.find(t => t.name === '东大街'))) return;
    if (!this.B('kiln').length && this.build('kiln', 33, 25, 8, '烧陶')) return;
    if (!this.B('warehouse').length && this.build('warehouse', 27, 22, 10, '存放陶器丝绸')) return;
    if (!this.builtStreets.has('作坊巷') && !this.ensureStreet(STREETS.find(t => t.name === '作坊巷'))) return;
    if (!this.B('mulberry').length && this.build('mulberry', 30, 19, 10, '种桑养蚕')) return;
    if (!this.B('silk').length && this.build('silk', 30, 27, 10, '缫丝织绸')) return;
    // 按目标与消耗定产能：一座窑约 13 陶/月，一座丝坊约 11 丝/月（配一片桑园）
    const A = s.avgStats(3);
    const rich3 = this.houses.filter(h => h.level >= 3).reduce((a, h) => a + h.pop, 0);
    const rich4 = this.houses.filter(h => h.level >= 4).reduce((a, h) => a + h.pop, 0);
    const exportPush = s.stage === 2 && !s.goalsDone.has('trade') ? 22 : 0; // 为商队多烧一窑
    const potTarget = Math.max(s.stage === 1 ? 28 : 0, rich3 * 0.05 * 1.3 + 4) + exportPush;
    const silkTarget = Math.max(s.stage === 1 ? 18 : 0, rich4 * 0.04 * 1.3 + 4);
    const kilns = this.B('kiln').length, silks = this.B('silk').length, muls = this.B('mulberry').length;
    if (kilns < Math.min(6, Math.ceil(potTarget / 12)) && (this.build('kiln', 32, 22 + kilns * 2, 10, `陶器目标 ${Math.round(potTarget)}/月`) || this.build('kiln', 30, 29, 12, `陶器目标 ${Math.round(potTarget)}/月`))) return;
    if (muls < silks && (this.build('mulberry', 30, 19, 10, '给丝坊供蚕茧') || this.build('mulberry', 25, 18, 14, '给丝坊供蚕茧'))) return;
    if (silks < Math.min(4, Math.ceil(silkTarget / 10)) && (this.build('silk', 30, 27, 10, `丝绸目标 ${Math.round(silkTarget)}/月`) || this.build('silk', 24, 30, 14, `丝绸目标 ${Math.round(silkTarget)}/月`))) return;
    const whs = this.B('warehouse');
    if (whs.length < 3 && whs.every(w => w.goods.pottery + w.goods.silk > 300)) this.build('warehouse', 27, 26, 10, '货栈快满了');
  }

  safety() {
    const all = [...this.w.buildings.values()].filter(b => b.type !== 'ruin' && b.type !== 'levee');
    const fh = this.B('firehouse'), rp = this.B('repair');
    const risky = all.filter(b => b.fireRisk > 55 || b.burning);
    if ((all.length >= 15 && fh.length < Math.ceil(all.length / 24)) || (risky.length >= 4 && fh.length < Math.ceil(all.length / 14))) {
      const [ci, cj] = this.centroid(risky.length ? risky : all);
      this.build('firehouse', ci, cj, 8, risky.length ? `${risky.length} 处火险高` : '防火');
    }
    const shaky = all.filter(b => b.cond < 55);
    if ((all.length >= 20 && rp.length < Math.ceil(all.length / 26)) || (shaky.length >= 4 && rp.length < Math.ceil(all.length / 15))) {
      const [ci, cj] = this.centroid(shaky.length ? shaky : all);
      this.build('repair', ci, cj, 8, shaky.length ? `${shaky.length} 座房子失修` : '修缮');
    }
  }

  trade() {
    const s = this.s;
    if (s.stage < 1) return;
    if (!this.B('tradepost').length) {
      for (const [ai, aj] of [[3, 22], [3, 26], [16, 21], [24, 27]]) if (this.build('tradepost', ai, aj, 10, '与商队往来')) break;
      return;
    }
    // 出口多余的，进口缺的；贸易目标没完成时卖得更积极
    const T = s.trade, push = !s.goalsDone.has('trade');
    const pot = s.storageStock('pottery'), silk = s.storageStock('silk'), food = s.storageStock('food');
    T.pottery = pot > (push ? 50 : 140) ? { mode: 'export', keep: push ? 30 : 80 } : { mode: 'none', keep: 80 };
    const rich4 = this.houses.filter(h => h.level >= 4).length;
    T.silk = silk > (push ? 50 : 140) ? { mode: 'export', keep: push ? 30 : 80 } : rich4 >= 2 && s.avgStats(3).prod.silk < 8 ? { mode: 'import', keep: 40 } : { mode: 'none', keep: 60 };
    T.food = food > (push ? 500 : 900) ? { mode: 'export', keep: push ? 350 : 500 } : { mode: 'none', keep: 300 };
  }
}

export { STREETS };
void N; void T_WATER;
