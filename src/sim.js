// 城市模拟：建造花费、劳力、产业链（粮、蚕茧、丝绸、陶器）、步行者、移民、民居五级升降、阶段目标、存档
import {
  BUILDINGS, HOUSE_LEVELS, LOT_IMMIGRANTS, FOOD_PER_POP, FARM_MONTHS, FARM_YIELD,
  FAITH_MONTHS, FUN_MONTHS, FENGSHUI_L3, FENGSHUI_L4, FENGSHUI_L5, GOODS_PER_POP,
  MULBERRY_MONTHS, MULBERRY_YIELD, SILK_BATCH, SILK_MONTHS, KILN_MONTHS, KILN_YIELD,
  MONTH_SECONDS, MONTHS, START_MONEY, STAGES, WORK_SHARE, LABOR_PRIORITY, WAGE, UPKEEP, PRICE,
  FIRE_RATE, BURN_MONTHS, SPREAD_PER_MONTH, DECAY_RATE, FLOOD, TRADE, DEADLINE_YEARS, DEBT_LIMIT, DEBT_MONTHS,
} from './config.js';

const SPEED = { immigrant: 1.7, cart: 1.25, porter: 1.6, peddler: 1.5, priest: 1.3, teller: 1.35, fireman: 2.4, watchman: 1.35, mason: 1.3, caravan: 1.15 };
const STORE_OF = { food: 'granary', pottery: 'warehouse', silk: 'warehouse', cocoon: 'silk' };
const GOOD_NAME = { food: '粮食', cocoon: '蚕茧', pottery: '陶器', silk: '丝绸' };
const SILK_COCOON_CAP = 120, KILN_OUT_CAP = 60, SILK_OUT = 12;
const MARKET_WANT = { food: 240, pottery: 80, silk: 80 };

export class Sim {
  constructor(world) {
    this.w = world;
    this.money = START_MONEY;
    this.t = 2.0;          // 以月为单位的游戏时间，从第一年三月开始
    this.speed = 1;
    this.walkers = [];
    this.nextWalker = 1;
    this.population = 0;
    this.workforce = 0;
    this.demand = 0;
    this.eff = 1;
    this.immTimer = 2;
    this.stage = 0;
    this.goalsDone = new Set();
    this.lastTax = 0;
    this.listeners = {};
    this.fsDirty = false;
    this.employed = 0;
    this.idle = 0;
    this.cur = this.blankStats();
    this.last = this.blankStats();
    this.record = { fires: 0, firesOut: 0, burnt: 0, collapses: 0, floods: 0, floodHits: 0, trades: 0, tradeIncome: 0, tradeCost: 0, maxPop: 0 };
    this.trade = { food: { mode: 'none', keep: 300 }, pottery: { mode: 'none', keep: 60 }, silk: { mode: 'none', keep: 60 }, cocoon: { mode: 'none', keep: 40 } };
    this.nextCaravan = null;
    this.flood = null;
    this.floodComing = null;
    this.debtMonths = 0;
    this.won = false;
    this.over = false;
    this.lastTrade = null;
  }
  get deadlineT() { return DEADLINE_YEARS * 12; }

  // 近 n 个月的平均（产量、消耗按月平均）
  avgStats(n = 3) {
    const h = (this.history || []).slice(-n);
    const out = this.blankStats();
    if (!h.length) return out;
    for (const s of h) for (const g in out.prod) { out.prod[g] += s.prod[g] / h.length; out.cons[g] += s.cons[g] / h.length; }
    return out;
  }
  stockOf(g) {
    let n = 0;
    for (const b of this.w.buildings.values()) {
      if (g === 'food' && b.type === 'granary') n += b.food;
      if (g === 'cocoon' && b.type === 'silk') n += b.cocoon;
      if (b.type === 'warehouse' && b.goods[g] != null) n += b.goods[g];
      if (b.type === 'market' && b.stock[g] != null) n += b.stock[g];
      if (g === 'pottery' && b.type === 'kiln') n += b.out;
      if (g === 'silk' && b.type === 'silk') n += b.out;
    }
    return Math.round(n);
  }

  blankStats() {
    return { prod: { food: 0, cocoon: 0, pottery: 0, silk: 0 }, cons: { food: 0, cocoon: 0, pottery: 0, silk: 0 },
      tax: 0, commerce: 0, wages: 0, upkeep: 0, tradeIn: 0, tradeOut: 0, byType: {} };
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach(fn => fn(data)); }
  msg(text, kind = 'info') { this.emit('msg', { text, kind }); }

  get year() { return Math.floor(this.t / 12) + 1; }
  get monthName() { return MONTHS[Math.floor(this.t) % 12]; }
  dateText() { return `第${toCN(this.year)}年 ${this.monthName}`; }
  countHouses(level) { let n = 0; for (const b of this.w.buildings.values()) if (b.type === 'house' && b.level >= level) n++; return n; }
  countType(t) { let n = 0; for (const b of this.w.buildings.values()) if (b.type === t) n++; return n; }
  totalFood() { let f = 0; for (const b of this.w.buildings.values()) if (b.type === 'granary') f += b.food; return Math.round(f); }
  totalGoods(g) { let f = 0; for (const b of this.w.buildings.values()) if (b.type === 'warehouse') f += b.goods[g]; return Math.round(f); }
  get stageInfo() { return STAGES[Math.min(this.stage, STAGES.length - 1)]; }

  // ---------- 玩家指令 ----------
  costOf(kind, tiles) {
    const def = BUILDINGS[kind];
    let cost = 0, ok = 0, reason = null;
    if (kind === 'clear') {
      for (const [i, j] of tiles) {
        if (!this.w.inside(i, j)) continue;
        const k = this.w.idx(i, j);
        if (this.w.occ[k] >= 0 || (this.w.road[k] && !this.w.protectedRoad[k]) || this.w.tree[k]) { cost += def.cost; ok++; }
        else if (this.w.protectedRoad[k]) reason = '官道不可拆除';
      }
      return { cost, ok, reason: ok ? null : (reason || '没有可拆除的东西') };
    }
    for (const [i, j] of tiles) {
      const r = this.w.canPlace(kind, i, j);
      if (r.ok) { cost += def.cost + r.trees * 2; ok++; } else reason = reason || r.reason;
    }
    return { cost, ok, reason: ok ? null : reason };
  }

  apply(kind, tiles) {
    const def = BUILDINGS[kind];
    if (kind === 'clear') return this.demolish(tiles);
    let placed = 0, spent = 0, lastReason = null, broke = false, roads = false;
    for (const [i, j] of tiles) {
      const r = this.w.canPlace(kind, i, j);
      if (!r.ok) { lastReason = r.reason; continue; }
      const cost = def.cost + r.trees * 2;
      if (this.money < cost) { broke = true; break; }
      this.money -= cost; spent += cost; placed++;
      if (kind === 'road') { this.w.placeRoad(i, j); roads = true; }
      else {
        const b = this.w.placeBuilding(kind, i, j);
        this.initState(b);
        this.w.emit('build', b);
      }
    }
    if (placed) { this.w.recomputeAll(); if (roads) this.w.emit('roads'); }
    if (broke) this.msg('铜钱不足', 'warn');
    else if (!placed && lastReason) this.msg(lastReason, 'warn');
    return { placed, spent };
  }

  demolish(tiles) {
    const cost = BUILDINGS.clear.cost;
    let n = 0, roads = false, broke = false;
    for (const [i, j] of tiles) {
      if (this.money < cost) { broke = true; break; }
      const res = this.w.removeAt(i, j);
      if (!res) continue;
      this.money -= cost; n++;
      if (res.kind === 'building') this.onRemoved(res.b);
      if (res.kind === 'road') roads = true;
    }
    if (n) { this.w.recomputeAll(); if (roads) this.w.emit('roads'); }
    if (broke) this.msg('铜钱不足', 'warn');
    return { placed: n };
  }

  onRemoved(b) {
    for (const wk of this.walkers) if (wk.home === b.id || wk.target === b.id) this.kill(wk);
    this.w.emit('remove', b);
  }

  initState(b) {
    Object.assign(b, { cond: 100, fireRisk: 0, burning: false, burnT: 0, fireTeam: false });
    switch (b.type) {
      case 'house': Object.assign(b, { level: 0, pop: 0, incoming: 0, food: 0, pottery: 0, silk: 0, faithUntil: -1, funUntil: -1, evo: 0, down: 0 }); break;
      case 'farm': case 'mulberry': Object.assign(b, { growth: 0, cartOut: false }); break;
      case 'silk': Object.assign(b, { cocoon: 0, prog: 0, out: 0, cartOut: false }); break;
      case 'kiln': Object.assign(b, { prog: 0, out: 0, cartOut: false }); break;
      case 'granary': Object.assign(b, { food: 0 }); break;
      case 'warehouse': Object.assign(b, { goods: { pottery: 0, silk: 0 } }); break;
      case 'market': Object.assign(b, { stock: { food: 0, pottery: 0, silk: 0 }, porterOut: false, peddlers: 0, cd: 1 }); break;
      case 'temple': Object.assign(b, { priestOut: false, cd: 1 }); break;
      case 'teahouse': Object.assign(b, { tellerOut: false, cd: 1 }); break;
      case 'firehouse': Object.assign(b, { watchOut: false, teamOut: false, cd: 1 }); break;
      case 'repair': Object.assign(b, { masonOut: false, cd: 1 }); break;
      case 'tradepost': Object.assign(b, { out: { food: 0, cocoon: 0, pottery: 0, silk: 0 }, cartOut: false }); break;
    }
  }

  // ---------- 存档 ----------
  serialize() {
    const W = this.w;
    const roads = []; for (let k = 0; k < W.road.length; k++) if (W.road[k]) roads.push(k);
    return {
      v: 3, seed: W.seed, money: this.money, t: this.t, stage: this.stage, goalsDone: [...this.goalsDone],
      record: this.record, trade: this.trade, nextCaravan: this.nextCaravan, floodComing: this.floodComing, debtMonths: this.debtMonths, won: this.won, over: this.over,
      nextId: W.nextId, roads, trees: Array.from(W.tree).join(''),
      buildings: [...W.buildings.values()].map(b => { const o = { ...b }; delete o.status; return o; }),
    };
  }
  restore(d) {
    const W = this.w;
    W.road.fill(0);
    for (let k = 0; k < W.road.length; k++) if (W.protectedRoad[k]) W.road[k] = 1;
    for (const k of d.roads) W.road[k] = 1;
    for (let k = 0; k < W.tree.length; k++) W.tree[k] = +d.trees[k] || 0;
    W.occ.fill(-1);
    W.buildings.clear();
    for (const o of d.buildings) {
      const b = { ...o };
      const fresh = { id: b.id, type: b.type }; this.initState(fresh);
      const merged = Object.assign(fresh, b, { cartOut: false, porterOut: false, peddlers: 0, priestOut: false, tellerOut: false, watchOut: false, teamOut: false, masonOut: false, fireTeam: false, incoming: 0 });
      W.buildings.set(merged.id, merged);
      for (const [x, y] of W.footprint(merged.i, merged.j, merged.size)) W.occ[W.idx(x, y)] = merged.id;
    }
    W.nextId = d.nextId;
    this.money = d.money; this.t = d.t; this.stage = d.stage || 0;
    this.goalsDone = new Set(d.goalsDone || []);
    if (d.record) this.record = { ...this.record, ...d.record };
    if (d.trade) this.trade = d.trade;
    this.nextCaravan = d.nextCaravan ?? null; this.floodComing = d.floodComing ?? null; this.flood = null;
    this.debtMonths = d.debtMonths || 0; this.won = !!d.won; this.over = !!d.over;
    if (W.flooded) W.flooded.fill(0);
    this.walkers = [];
    W.recomputeAll();
  }

  // ---------- 主循环 ----------
  update(dtReal) {
    const dt = dtReal * this.speed;
    if (dt <= 0) return;
    const dm = dt / MONTH_SECONDS;
    const prev = Math.floor(this.t);
    this.t += dm;
    if (Math.floor(this.t) > prev) this.monthTick();

    this.allocateLabor();

    for (const b of this.w.buildings.values()) {
      switch (b.type) {
        case 'house': this.updateHouse(b, dt); break;
        case 'farm': this.updateGrower(b, dm, FARM_MONTHS, 'food', FARM_YIELD, '庄稼'); break;
        case 'mulberry': this.updateGrower(b, dm, MULBERRY_MONTHS, 'cocoon', MULBERRY_YIELD, '桑蚕'); break;
        case 'silk': this.updateSilk(b, dm); break;
        case 'kiln': this.updateKiln(b, dm); break;
        case 'market': this.updateMarket(b, dt); break;
        case 'temple': this.updateRoamer(b, dt, 'priest', 'priestOut', 5, 38, '祭司巡游中', '香火供奉中'); break;
        case 'teahouse': this.updateRoamer(b, dt, 'teller', 'tellerOut', 5, 36, '说书人上街了', '茶客满座'); break;
        case 'firehouse': this.updateRoamer(b, dt, 'watchman', 'watchOut', 4, 40, '巡更人上街了', '水龙待命'); this.dispatchFire(b); break;
        case 'repair': this.updateRoamer(b, dt, 'mason', 'masonOut', 4, 40, '匠人出门修缮', '匠人待命'); break;
        case 'tradepost': this.updateTradepost(b); break;
        case 'granary': case 'warehouse': {
          const full = b.type === 'granary' ? b.food >= BUILDINGS.granary.capacity - 1 : b.goods.pottery + b.goods.silk >= BUILDINGS.warehouse.capacity - 1;
          b.active = b.staff > 0;
          b.icon = !this.w.isConnected(b) ? '无路' : b.staff <= 0 ? '缺工' : full ? '满仓' : null;
          b.status = b.staff <= 0 ? '无人当值，不收货' : full ? '已满' : '收货中';
          break;
        }
      }
    }
    this.doomed = [];
    for (const b of this.w.buildings.values()) this.updateHazards(b, dm);
    for (const [b, why] of this.doomed) this.destroy(b, why);
    if (this.flood && this.t >= this.flood.until) this.endFlood();
    this.updateImmigration(dt);
    for (const wk of this.walkers) if (!wk.dead) this.advance(wk, dt);
    if (this.walkers.some(wk => wk.dead)) this.walkers = this.walkers.filter(wk => !wk.dead);
    if (this.fsDirty) { this.fsDirty = false; this.w.computeFengshui(); this.w.emit('tiles'); }
    this.checkGoals();
  }

  // 劳力：各户按等级出工，按优先级分到各作坊；每座建筑的产出按在岗比例计
  allocateLabor() {
    let pop = 0, pool = 0;
    const jobs = [];
    for (const b of this.w.buildings.values()) {
      if (b.type === 'house') { pop += b.pop; pool += b.pop * WORK_SHARE[b.level]; continue; }
      const need = BUILDINGS[b.type].workers || 0;
      b.need = need; b.staff = 0; b.eff = need ? 0 : 1;
      if (need && !b.burning && this.w.isConnected(b)) jobs.push(b);
    }
    pool = Math.floor(pool);
    jobs.sort((a, b) => (LABOR_PRIORITY[a.type] ?? 9) - (LABOR_PRIORITY[b.type] ?? 9) || a.id - b.id);
    let left = pool, demand = 0;
    for (const b of jobs) {
      demand += b.need;
      b.staff = Math.min(b.need, left);
      left -= b.staff;
      b.eff = b.staff / b.need;
    }
    this.population = pop;
    this.workforce = pool;
    this.demand = demand;
    this.employed = pool - left;
    this.idle = left;
    this.eff = demand ? Math.min(1, pool / demand) : 1;
  }

  monthTick() {
    let tax = 0, wages = 0, upkeep = 0;
    const c = this.cur;
    const eat = (b, f, amt) => { const n = Math.min(b[f], amt); b[f] -= n; c.cons[f] += n; };
    for (const b of this.w.buildings.values()) {
      if (b.type !== 'house') {
        wages += (b.staff || 0) * WAGE;
        upkeep += BUILDINGS[b.type].cost * UPKEEP;
        continue;
      }
      tax += b.pop * HOUSE_LEVELS[b.level].tax;
      eat(b, 'food', b.pop * FOOD_PER_POP);
      eat(b, 'pottery', b.pop * GOODS_PER_POP.pottery);
      eat(b, 'silk', b.pop * GOODS_PER_POP.silk);
    }
    tax = Math.round(tax); wages = Math.round(wages); upkeep = Math.round(upkeep);
    this.money += tax - wages - upkeep;
    c.tax = tax; c.wages = wages; c.upkeep = upkeep;
    c.tradeIn = Math.round(c.tradeIn); c.tradeOut = Math.round(c.tradeOut);
    c.commerce = Math.round(c.commerce);
    this.last = c;
    (this.history ||= []).push(c);
    if (this.history.length > 12) this.history.shift();
    this.cur = this.blankStats();
    const net = tax + c.commerce + c.tradeIn - c.tradeOut - wages - upkeep;
    this.lastTax = net;
    if (this.money < 0 && !this.inDebt) { this.inDebt = true; this.msg('国库亏空：工钱与维护入不敷出', 'warn'); }
    if (this.money >= 0) this.inDebt = false;
    this.emit('month', net);
    this.record.maxPop = Math.max(this.record.maxPop, this.population);
    this.monthEvents();
  }

  checkGoals() {
    if (this.stage >= STAGES.length || this.over) return;
    const st = STAGES[this.stage];
    for (const g of st.goals) {
      if (!this.goalsDone.has(g.id) && g.check(this)) {
        this.goalsDone.add(g.id);
        this.msg(`目标达成：${g.text}`, 'good');
      }
    }
    if (st.goals.every(g => this.goalsDone.has(g.id))) {
      this.stage++;
      if (this.stage >= STAGES.length) { this.won = true; this.emit('victory', this.summary()); }
      else this.emit('stage', st);
    }
  }

  nameOf(b) { return b.type === 'house' ? HOUSE_LEVELS[b.level].name : BUILDINGS[b.type].name; }

  // ---------- 灾害：火、年久失修、洪水 ----------
  updateHazards(b, dm) {
    if (b.type === 'ruin' || b.type === 'levee') return;
    const fr = b.type === 'house' ? FIRE_RATE.house[b.level] : (FIRE_RATE[b.type] || 0);
    if (fr && !b.burning) {
      b.fireRisk = Math.min(100, b.fireRisk + fr * dm * (0.6 + Math.random() * 0.8));
      // 火险越高越可能出意外：即使有巡更，偶尔也会走水
      const accident = Math.pow(b.fireRisk / 100, 2) * 0.12 * (fr / 4) * dm;
      if (b.fireRisk >= 100 || Math.random() < accident) this.ignite(b);
    }
    if (b.type !== 'well' && b.type !== 'garden' && !(b.type === 'house' && b.level === 0)) {
      b.cond -= (DECAY_RATE[b.type] ?? DECAY_RATE.default) * dm;
      if (b.cond <= 0) { this.doomed.push([b, 'collapse']); return; }
    }
    if (b.burning) {
      b.burnT += dm; b.active = false; b.icon = '火';
      if (Math.random() < SPREAD_PER_MONTH * dm) {
        const W = this.w, near = [];
        for (let y = b.j - 1; y <= b.j + b.size; y++) for (let x = b.i - 1; x <= b.i + b.size; x++) {
          const n = W.buildingAt(x, y);
          if (n && n !== b && !n.burning && !near.includes(n)) {
            const r = n.type === 'house' ? FIRE_RATE.house[n.level] : (FIRE_RATE[n.type] || 0);
            if (r) near.push(n);
          }
        }
        if (near.length) this.ignite(near[(Math.random() * near.length) | 0], true);
      }
      if (b.burnT >= BURN_MONTHS) this.doomed.push([b, 'burnt']);
      return;
    }
    if (b.cond < 30) b.icon = '危';
    else if (b.fireRisk > 80 && !b.icon) b.icon = '险';
  }

  ignite(b, spread = false) {
    if (b.burning) return;
    b.burning = true; b.burnT = 0; b.fireTeam = false; b.fireRisk = 100;
    this.record.fires++;
    this.msg(spread ? `火势蔓延到${this.nameOf(b)}！` : `${this.nameOf(b)}起火了！`, 'warn');
    this.emit('fire', b);
  }

  // 水龙局：把水龙队派往最近的火场
  dispatchFire(fh) {
    if (fh.teamOut || !fh.staff || !this.w.isConnected(fh)) return;
    let best = null;
    for (const b of this.w.buildings.values()) {
      if (!b.burning || b.fireTeam) continue;
      const path = this.w.findPath(this.w.roadsNear(fh), this.w.roadsNear(b, b.type === 'house' ? 2 : 1));
      if (path && (!best || path.length < best.path.length)) best = { b, path };
    }
    if (!best) return;
    fh.teamOut = true;
    best.b.fireTeam = true;
    this.spawn('fireman', fh, best.path, { target: best.b.id });
  }

  destroy(b, why) {
    const W = this.w;
    if (!W.buildings.has(b.id)) return;
    const name = this.nameOf(b);
    for (const [x, y] of W.footprint(b.i, b.j, b.size)) W.occ[W.idx(x, y)] = -1;
    W.buildings.delete(b.id);
    this.onRemoved(b);
    const r = W.placeBuilding('ruin', b.i, b.j, b.size);
    this.initState(r);
    W.emit('build', r);
    W.recomputeAll();
    if (why === 'burnt') { this.record.burnt++; this.msg(`${name}被大火烧成废墟`, 'warn'); }
    else if (why === 'flood') this.msg(`${name}被洪水冲毁`, 'warn');
    else { this.record.collapses++; this.msg(`${name}年久失修，倒塌了`, 'warn'); }
  }

  monthEvents() {
    const tm = Math.floor(this.t), m = tm % 12, W = this.w;
    if (m === FLOOD.warnMonth && this.year >= FLOOD.fromYear && !this.floodComing && Math.random() < FLOOD.chance) {
      this.floodComing = { at: tm + (FLOOD.month - FLOOD.warnMonth) };
      let n = 0; for (const b of W.buildings.values()) if (b.type !== 'ruin' && b.type !== 'levee' && W.inFloodZone(b)) n++;
      this.msg(`河水上涨：两个月后（六月）汛期将至，河边三格内有 ${n} 座建筑可能被淹。沿河筑堤可保护周围三格。`, 'warn');
      this.emit('floodWarn', n);
    }
    if (this.floodComing && tm >= this.floodComing.at) { this.floodComing = null; this.startFlood(); }
    // 商队
    const tps = [...W.buildings.values()].filter(b => b.type === 'tradepost' && b.staff > 0 && W.isConnected(b));
    if (tps.length) {
      if (this.nextCaravan == null) this.nextCaravan = tm + 1;
      if (tm >= this.nextCaravan && !this.walkers.some(w => w.kind === 'caravan')) { this.spawnCaravan(tps[0]); this.nextCaravan = tm + TRADE.every; }
    }
    // 亏空与期限
    if (this.money < DEBT_LIMIT) {
      this.debtMonths++;
      if (this.debtMonths < DEBT_MONTHS) this.msg(`国库亏空超过 ${-DEBT_LIMIT} 文已 ${this.debtMonths} 个月，连续 ${DEBT_MONTHS} 个月将被革职`, 'warn');
    } else this.debtMonths = 0;
    if (!this.won && !this.over) {
      if (this.debtMonths >= DEBT_MONTHS) this.lose('国库亏空太久，朝廷将你革职查办。');
      else if (this.t >= this.deadlineT) this.lose(`期限已到（第${toCN(DEADLINE_YEARS)}年腊月），城池未能如期兴盛。`);
    }
  }

  startFlood() {
    const W = this.w, S = W.N * W.N;
    for (let k = 0; k < S; k++) W.flooded[k] = W.floodRisk[k];
    let hits = 0;
    const doomed = [];
    for (const b of W.buildings.values()) {
      if (b.type === 'ruin' || b.type === 'levee' || !W.footprint(b.i, b.j, b.size).some(([x, y]) => W.flooded[W.idx(x, y)])) continue;
      hits++;
      b.cond -= FLOOD.damage;
      if (b.type === 'farm' || b.type === 'mulberry') b.growth = 0;
      if (b.type === 'house') b.food = 0;
      if (b.type === 'granary') b.food *= 0.6;
      if (b.type === 'warehouse') for (const g in b.goods) b.goods[g] *= 0.7;
      if (b.type === 'market') for (const g in b.stock) b.stock[g] *= 0.7;
      if (b.type === 'silk') b.cocoon *= 0.6;
      if (b.cond <= 0) doomed.push(b);
    }
    for (const b of doomed) this.destroy(b, 'flood');
    this.flood = { until: this.t + 1 };
    this.record.floods++; this.record.floodHits += hits;
    this.msg(hits ? `汛期到了：洪水淹了 ${hits} 座建筑` : '汛期到了：河堤挡住了洪水，城里无恙', hits ? 'warn' : 'good');
    W.emit('flood');
  }
  endFlood() {
    this.w.flooded.fill(0);
    this.flood = null;
    this.msg('洪水退去了');
    this.w.emit('flood');
  }

  // ---------- 商队 ----------
  storageStock(g) {
    let n = 0;
    for (const b of this.w.buildings.values()) {
      if (b.type !== STORE_OF[g]) continue;
      n += g === 'food' ? b.food : g === 'cocoon' ? b.cocoon : b.goods[g];
    }
    return n;
  }
  storageTake(g, amt) {
    for (const b of this.w.buildings.values()) {
      if (amt <= 0) break;
      if (b.type !== STORE_OF[g]) continue;
      const have = g === 'food' ? b.food : g === 'cocoon' ? b.cocoon : b.goods[g];
      const n = Math.min(have, amt);
      if (g === 'food') b.food -= n; else if (g === 'cocoon') b.cocoon -= n; else b.goods[g] -= n;
      amt -= n;
    }
  }
  spawnCaravan(tp) {
    const W = this.w;
    const path = W.findPath([W.idx(W.entry.i, W.entry.j)], W.roadsNear(tp));
    if (!path) return;
    const wk = this.spawn('caravan', null, path, { target: tp.id, load: { food: 0, pottery: 0, silk: 0, cocoon: 0 } });
    wk.approach = 8; // 先从地图外的官道走进来
    this.msg('西边官道来了一支商队', 'info');
  }
  doTrade(tp, wk) {
    let income = 0, cost = 0;
    const sold = {}, bought = {};
    for (const g of ['food', 'pottery', 'silk', 'cocoon']) {
      const set = this.trade[g], have = this.storageStock(g);
      if (set.mode === 'export') {
        const amt = Math.floor(Math.min(TRADE.cap[g], have - set.keep));
        if (amt > 0) { this.storageTake(g, amt); income += amt * TRADE.sell[g]; sold[g] = amt; wk.load[g] = (wk.load[g] || 0) + amt; }
      } else if (set.mode === 'import') {
        const amt = Math.floor(Math.min(TRADE.cap[g], set.keep - have - tp.out[g]));
        const c = amt * TRADE.buy[g];
        if (amt > 0 && this.money - c >= 0) { this.money -= c; cost += c; tp.out[g] += amt; bought[g] = amt; }
      }
    }
    income = Math.round(income); cost = Math.round(cost);
    this.money += income;
    this.cur.tradeIn += income; this.cur.tradeOut += cost;
    this.record.tradeIncome += income; this.record.tradeCost += cost;
    const names = o => Object.entries(o).map(([g, n]) => `${GOOD_NAME[g]} ${n}`).join('、');
    if (income || cost) {
      this.record.trades++;
      this.msg(`商队成交：${income ? `卖出 ${names(sold)}，得 ${income} 文` : ''}${income && cost ? '；' : ''}${cost ? `买进 ${names(bought)}，花 ${cost} 文` : ''}`, 'coin');
    } else this.msg('商队来了，但没有可买卖的货（在「商队」面板设定出口、进口）');
    this.lastTrade = { date: this.dateText(), sold, bought, income, cost };
  }
  updateTradepost(b) {
    if (!this.w.isConnected(b)) { b.status = '未与官道连通'; b.icon = '无路'; b.active = false; return; }
    b.active = b.staff > 0;
    b.icon = b.staff > 0 ? null : '缺工';
    const pending = Object.values(b.out).reduce((a, c) => a + c, 0);
    b.status = b.staff <= 0 ? '无人做工，商队不会来' : pending > 0 ? '正把进口的货送进仓库' : `等候商队（${this.nextCaravan != null ? Math.max(0, this.nextCaravan - Math.floor(this.t)) + ' 个月后' : '下月'}）`;
    if (!b.cartOut && b.staff > 0) for (const g of ['food', 'cocoon', 'pottery', 'silk']) {
      if (b.out[g] < 1) continue;
      const amt = Math.min(b.out[g], 100);
      if (this.sendCart(b, g, amt)) { b.out[g] -= amt; break; }
      else { b.icon = '满仓'; b.status = `进口的${GOOD_NAME[g]}没处放：需要可达的${BUILDINGS[STORE_OF[g]].name}`; }
    }
  }

  lose(reason) {
    this.over = true;
    this.speed = 0;
    this.emit('defeat', { reason, ...this.summary() });
  }
  summary() {
    this.record.maxPop = Math.max(this.record.maxPop, this.population);
    return {
      date: this.dateText(), years: Math.max(0, (this.t - 2) / 12), population: this.population, money: Math.round(this.money),
      record: { ...this.record }, levels: [1, 2, 3, 4, 5].map(l => this.countHouses(l) - this.countHouses(l + 1)),
    };
  }

  // ---------- 货物流转 ----------
  room(b, good) {
    if (b.need && !b.staff) return 0;
    if (good === 'food' && b.type === 'granary') return BUILDINGS.granary.capacity - b.food;
    if (good === 'cocoon' && b.type === 'silk') return SILK_COCOON_CAP - b.cocoon;
    if ((good === 'pottery' || good === 'silk') && b.type === 'warehouse') return BUILDINGS.warehouse.capacity - b.goods.pottery - b.goods.silk;
    return 0;
  }
  deposit(b, good, amt) {
    const n = Math.min(amt, Math.max(0, this.room(b, good)));
    if (good === 'food') b.food += n;
    else if (good === 'cocoon') b.cocoon += n;
    else b.goods[good] += n;
    return n;
  }
  // 从 from 出发沿路找最近的、满足 test 的建筑，返回 { path, target }
  route(from, test) {
    const goals = new Map();
    for (const g of this.w.buildings.values()) {
      if (g === from || !test(g)) continue;
      for (const k of this.w.roadsNear(g)) if (!goals.has(k)) goals.set(k, g.id);
    }
    const path = this.w.findPath(this.w.roadsNear(from), new Set(goals.keys()));
    return path ? { path, target: goals.get(path[path.length - 1]) } : null;
  }
  sendCart(b, good, amount) {
    const need = Math.min(amount, 40);
    const r = this.route(b, g => this.room(g, good) >= need);
    if (!r) return false;
    b.cartOut = true;
    this.spawn('cart', b, r.path, { target: r.target, carry: amount, good });
    return true;
  }

  updateGrower(b, dm, months, good, yieldAmt, label) {
    if (!this.w.isConnected(b)) { b.status = '未与官道连通'; b.icon = '无路'; b.active = false; return; }
    if (b.growth < 1) {
      b.growth = Math.min(1, b.growth + dm / months * b.eff);
      b.active = b.eff > 0;
      b.icon = b.eff <= 0 ? '缺工' : null;
      b.status = b.eff <= 0 ? '无人做工，庄稼停长' : b.eff < 1 ? '人手不足，生长缓慢' : `${label}生长中`;
      return;
    }
    b.active = false;
    if (b.cartOut) { b.status = '推车运送中'; b.icon = null; return; }
    if (this.sendCart(b, good, yieldAmt)) { b.growth = 0; b.status = '推车运送中'; b.icon = null; this.cur.prod[good] += yieldAmt; }
    else { b.status = good === 'food' ? '已收获，粮仓满了或到不了' : '已收获，丝坊满了或到不了'; b.icon = '满仓'; }
  }

  updateSilk(b, dm) {
    if (!this.w.isConnected(b)) { b.status = '未与官道连通'; b.icon = '无路'; b.active = false; return; }
    b.active = false; b.icon = null;
    if (b.eff <= 0) { b.status = '无人做工'; b.icon = '缺工'; }
    else if (b.cocoon >= SILK_BATCH && b.out < 40) {
      b.prog += dm / SILK_MONTHS * b.eff;
      b.active = true;
      if (b.prog >= 1) { b.prog = 0; b.cocoon -= SILK_BATCH; b.out += SILK_OUT; this.cur.cons.cocoon += SILK_BATCH; this.cur.prod.silk += SILK_OUT; }
      b.status = b.eff < 1 ? '人手不足，织得慢' : '缫丝织绸中';
    } else if (b.cocoon < SILK_BATCH) { b.status = '断料：等待桑园送来蚕茧'; b.icon = '断料'; }
    else { b.status = '丝绸堆满，等待运走'; b.icon = '满仓'; }
    if (b.out >= SILK_OUT && !b.cartOut) {
      if (this.sendCart(b, 'silk', b.out)) b.out = 0;
      else { b.status = '货栈满了或到不了'; b.icon = '满仓'; }
    }
  }

  updateKiln(b, dm) {
    if (!this.w.isConnected(b)) { b.status = '未与官道连通'; b.icon = '无路'; b.active = false; return; }
    b.active = false; b.icon = null;
    if (b.eff <= 0) { b.status = '无人做工，窑火已熄'; b.icon = '缺工'; }
    else if (b.out < KILN_OUT_CAP) {
      b.prog += dm / KILN_MONTHS * b.eff;
      b.active = true;
      if (b.prog >= 1) { b.prog = 0; b.out += KILN_YIELD; this.cur.prod.pottery += KILN_YIELD; }
      b.status = b.eff < 1 ? '人手不足，窑火不旺' : '烧制陶器中';
    } else { b.status = '陶器堆满，等待运走'; b.icon = '满仓'; }
    if (b.out >= KILN_YIELD && !b.cartOut) {
      if (this.sendCart(b, 'pottery', b.out)) b.out = 0;
      else { b.status = '货栈满了或到不了'; b.icon = '满仓'; }
    }
  }

  updateMarket(b, dt) {
    if (!this.w.isConnected(b)) { b.status = '未与官道连通'; b.icon = '无路'; b.active = false; return; }
    b.active = b.staff > 0;
    b.icon = b.staff > 0 ? null : '缺工';
    if (b.staff <= 0) { b.status = '无人做工'; return; }
    const s = b.stock;
    b.status = s.food > 0 ? '营业中' : '缺粮，等待挑夫';
    if (!b.porterOut) {
      const needFood = s.food < MARKET_WANT.food, needP = s.pottery < MARKET_WANT.pottery, needS = s.silk < MARKET_WANT.silk;
      // 粮食优先：缺粮时先去粮仓，其次轮流取货
      const toGranary = () => needFood ? this.route(b, g => g.type === 'granary' && g.food >= 1) : null;
      const toWarehouse = () => (needP || needS) ? this.route(b, g => g.type === 'warehouse' && ((needP && g.goods.pottery >= 1) || (needS && g.goods.silk >= 1))) : null;
      const foodFirst = s.food < MARKET_WANT.food * 0.6 || b.lastTrip === 'warehouse';
      const r = foodFirst ? (toGranary() || toWarehouse()) : (toWarehouse() || toGranary());
      if (r) b.lastTrip = this.w.buildings.get(r.target).type;
      if (r) { b.porterOut = true; this.spawn('porter', b, r.path, { target: r.target }); }
    }
    b.cd -= dt;
    if ((b.peddlers || 0) < 2 && b.cd <= 0 && (s.food > 0 || s.pottery > 0 || s.silk > 0)) {
      const starts = this.w.roadsNear(b);
      if (starts.length) {
        b.peddlers = (b.peddlers || 0) + 1;
        b.cd = 6 / b.eff;
        // 货郎真的挑货出门：从集市货存里分走一担
        const load = { food: Math.min(s.food, 200), pottery: Math.min(s.pottery, 40), silk: Math.min(s.silk, 40) };
        for (const g in load) s[g] -= load[g];
        const wk = this.spawn('peddler', b, [starts[(Math.random() * starts.length) | 0]], { roam: 40, load });
        void wk;
      }
    }
  }

  updateRoamer(b, dt, kind, flag, cd, steps, busy, idle) {
    if (!this.w.isConnected(b)) { b.status = '未与官道连通'; b.icon = '无路'; b.active = false; return; }
    b.active = b.staff > 0;
    b.icon = b.staff > 0 ? null : '缺工';
    if (b.staff <= 0) { b.status = '无人做工'; return; }
    b.status = b[flag] ? busy : idle;
    b.cd -= dt;
    if (!b[flag] && b.cd <= 0) {
      const starts = this.w.roadsNear(b);
      if (starts.length) {
        b[flag] = true;
        b.cd = cd / b.eff;
        this.spawn(kind, b, [starts[(Math.random() * starts.length) | 0]], { roam: steps });
      }
    }
  }

  // ---------- 民居 ----------
  // 返回 [可达等级, 下一级缺什么]
  houseEval(b) {
    const out = [];
    let lv = 1;
    const need = (ok, text) => { if (!ok) out.push(text); return ok; };
    const l2 = need(b.hasWater, '需要水源（水井或临河）') & need(b.food > 0, '需要集市货郎送粮');
    if (!l2) return [lv, out];
    lv = 2;
    const l3 = need(b.faith, '需要祭司巡游（祠庙）') & need(b.fs >= FENGSHUI_L3, `风水需达到 ${FENGSHUI_L3}（当前 ${b.fs.toFixed(1)}）`);
    if (!l3) return [lv, out];
    lv = 3;
    const l4 = need(b.pottery > 0, '需要陶器（陶窑 → 货栈 → 集市）') & need(b.fun, '需要说书人巡游（茶楼）') & need(b.fs >= FENGSHUI_L4, `风水需达到 ${FENGSHUI_L4}（当前 ${b.fs.toFixed(1)}）`);
    if (!l4) return [lv, out];
    lv = 4;
    const l5 = need(b.silk > 0, '需要丝绸（桑园 → 丝坊 → 货栈 → 集市）') & need(b.fs >= FENGSHUI_L5, `风水需达到 ${FENGSHUI_L5}（当前 ${b.fs.toFixed(1)}）`);
    if (!l5) return [lv, out];
    return [5, []];
  }

  houseNeeds(b) {
    if (!this.w.hasAccess(b)) return ['两格内需要道路'];
    if (!this.w.isConnected(b)) return ['道路未与官道连通'];
    if (b.level === 0) return ['等待移民入住'];
    return this.houseEval(b)[1];
  }

  updateHouse(b, dt) {
    const k = this.w.idx(b.i, b.j);
    b.hasWater = this.w.water[k] > 0;
    b.fs = this.w.fengshui[k];
    b.faith = b.faithUntil > this.t;
    b.fun = b.funUntil > this.t;
    let target;
    if (b.level === 0) target = 0;
    else if (!this.w.isConnected(b)) target = 1;
    else target = this.houseEval(b)[0];
    b.icon = b.level === 0 ? null : !b.hasWater ? '渴' : b.pop > 0 && b.food <= 0 ? '饥' : null;
    if (target > b.level) {
      b.down = 0; b.evo += dt;
      if (!b.icon) b.icon = '升';
      if (b.evo > 3) {
        b.evo = 0; b.level++;
        this.w.emit('update', b);
        if (b.level >= 3) { this.fsDirty = true; this.msg(`一座民居升为${HOUSE_LEVELS[b.level].name}`, 'good'); }
      }
    } else if (target < b.level) {
      b.evo = 0; b.down += dt;
      if (!b.icon || b.icon === '升') b.icon = '衰';
      if (b.down > 12) {
        b.down = 0;
        if (b.level >= 3) this.fsDirty = true;
        b.level--;
        const cap = HOUSE_LEVELS[b.level].cap;
        if (b.pop > cap) b.pop = cap;
        this.w.emit('update', b);
        if (this.t - (this.lastDownMsg ?? -9) > 0.5) {
          this.lastDownMsg = this.t;
          const why = this.houseEval(b)[1][0] || '需求未满足';
          this.msg(`${HOUSE_LEVELS[b.level + 1].name}衰败为${HOUSE_LEVELS[b.level].name}：${why}`, 'warn');
        }
      }
    } else { b.evo = 0; b.down = 0; }
  }

  updateImmigration(dt) {
    this.immTimer -= dt;
    if (this.immTimer > 0) return;
    this.immTimer = 1.0;
    if (this.walkers.filter(w => w.kind === 'immigrant').length >= 16) return;
    const entryK = this.w.idx(this.w.entry.i, this.w.entry.j);
    const cands = [];
    for (const b of this.w.buildings.values()) {
      if (b.type !== 'house') continue;
      const cap = b.level === 0 ? LOT_IMMIGRANTS : HOUSE_LEVELS[b.level].cap;
      const vac = cap - b.pop - b.incoming;
      if (vac > 0 && this.w.isConnected(b)) cands.push([b, vac]);
    }
    if (!cands.length) return;
    cands.sort((a, b) => (b[0].level > 0) - (a[0].level > 0) || b[1] - a[1]);
    const [house, vac] = cands[Math.floor(Math.random() * Math.min(4, cands.length))];
    const path = this.w.findPath([entryK], this.w.roadsNear(house, 2));
    if (!path) return;
    const n = Math.min(vac, 1 + Math.floor(Math.random() * 4));
    house.incoming += n;
    this.spawn('immigrant', null, path, { target: house.id, carry: n });
  }

  // ---------- 步行者 ----------
  spawn(kind, home, path, opt = {}) {
    const wk = {
      id: this.nextWalker++, kind, home: home ? home.id : -1, target: opt.target ?? -1,
      path, idx: 0, prog: 0, speed: SPEED[kind] * (0.9 + Math.random() * 0.2),
      carry: opt.carry || 0, good: opt.good || null, load: opt.load || { food: 0, pottery: 0, silk: 0 },
      phase: opt.roam ? 'roam' : 'out', steps: opt.roam || 0,
      served: new Set(), visited: new Set([path[0]]), dead: false,
    };
    this.walkers.push(wk);
    if (wk.phase === 'roam') this.serve(wk, path[0]);
    if (path.length === 1) this.reachEnd(wk);
    return wk;
  }

  advance(wk, dt) {
    if (wk.approach > 0) { wk.approach = Math.max(0, wk.approach - wk.speed * dt); return; }
    if (wk.phase === 'gone') { wk.depart += wk.speed * dt; if (wk.depart > 8) wk.dead = true; return; }
    wk.prog += wk.speed * dt;
    let guard = 0;
    while (wk.prog >= 1 && !wk.dead && guard++ < 8) {
      if (wk.idx >= wk.path.length - 1) { this.reachEnd(wk); continue; }
      wk.prog -= 1;
      wk.idx++;
      const k = wk.path[wk.idx];
      if (!this.w.road[k]) { this.kill(wk); return; }
      if (wk.phase === 'roam') { wk.visited.add(k); this.serve(wk, k); }
      if (wk.idx >= wk.path.length - 1) this.reachEnd(wk);
    }
  }

  current(wk) { return wk.path[Math.min(wk.idx, wk.path.length - 1)]; }
  setPath(wk, path) { wk.path = path; wk.idx = 0; if (path.length === 1) this.reachEnd(wk); }

  goHome(wk) {
    const home = this.w.buildings.get(wk.home);
    if (!home) { this.kill(wk); return; }
    const path = this.w.findPath([this.current(wk)], this.w.roadsNear(home));
    if (!path) { this.kill(wk); return; }
    wk.phase = 'back';
    this.setPath(wk, path);
  }

  reachEnd(wk) {
    if (wk.dead) return;
    const W = this.w;
    if (wk.phase === 'roam') {
      if (wk.steps-- > 0) {
        const cur = this.current(wk);
        const prev = wk.idx > 0 ? wk.path[wk.idx - 1] : -1;
        const nb = W.roadNeighbors(cur);
        let opts = nb.filter(k => k !== prev && !wk.visited.has(k));
        if (!opts.length) opts = nb.filter(k => k !== prev);
        if (!opts.length) opts = nb;
        if (!opts.length) { this.goHome(wk); return; }
        wk.path.push(this.pickRoam(wk, opts));
        if (wk.idx > 64) { wk.path = wk.path.slice(wk.idx - 1); wk.idx = 1; }
        return;
      }
      this.goHome(wk);
      return;
    }
    if (wk.phase === 'leave') { wk.phase = 'gone'; wk.depart = 0; return; }
    if (wk.phase === 'out' && wk.kind === 'caravan') {
      const tp = W.buildings.get(wk.target);
      if (tp) this.doTrade(tp, wk);
      const back = W.findPath([this.current(wk)], [W.idx(W.entry.i, W.entry.j)]);
      if (!back) { wk.dead = true; return; }
      wk.phase = 'leave';
      this.setPath(wk, back);
      return;
    }
    if (wk.phase === 'out' && wk.kind === 'fireman') {
      const tgt = W.buildings.get(wk.target);
      if (tgt && tgt.burning) {
        tgt.burning = false; tgt.fireRisk = 0; tgt.burnT = 0; tgt.fireTeam = false;
        tgt.cond = Math.max(5, tgt.cond - 15);
        this.record.firesOut++;
        this.msg(`水龙队扑灭了${this.nameOf(tgt)}的大火`, 'good');
      }
      this.goHome(wk);
      return;
    }
    if (wk.phase === 'out') {
      const tgt = W.buildings.get(wk.target);
      if (wk.kind === 'immigrant') {
        if (tgt) {
          tgt.incoming = Math.max(0, tgt.incoming - wk.carry);
          const cap = tgt.level === 0 ? LOT_IMMIGRANTS : HOUSE_LEVELS[tgt.level].cap;
          tgt.pop = Math.min(cap, tgt.pop + wk.carry);
          if (tgt.level === 0) { tgt.level = 1; W.emit('update', tgt); }
        }
        wk.carry = 0; wk.dead = true;
        return;
      }
      if (wk.kind === 'cart') {
        if (tgt) wk.carry -= this.deposit(tgt, wk.good, wk.carry);
        // 没卸完：改送下一处有空位的仓库
        if (wk.carry >= 1 && (wk.reroutes = (wk.reroutes || 0) + 1) <= 3) {
          const goals = new Map();
          for (const g of W.buildings.values()) if (g !== tgt && this.room(g, wk.good) >= 1) for (const k of W.roadsNear(g)) if (!goals.has(k)) goals.set(k, g.id);
          const path = W.findPath([this.current(wk)], new Set(goals.keys()));
          if (path) { wk.target = goals.get(path[path.length - 1]); this.setPath(wk, path); return; }
        }
      } else if (wk.kind === 'porter' && tgt) {
        const home = W.buildings.get(wk.home);
        const s = home ? home.stock : { food: 0, pottery: 0, silk: 0 };
        if (tgt.type === 'granary') { const n = Math.min(160, tgt.food, Math.max(0, MARKET_WANT.food + 60 - s.food)); tgt.food -= n; wk.load.food = n; }
        if (tgt.type === 'warehouse') for (const g of ['pottery', 'silk']) {
          const n = Math.min(60, tgt.goods[g], Math.max(0, MARKET_WANT[g] + 20 - s[g]));
          tgt.goods[g] -= n; wk.load[g] = n;
        }
      }
      this.goHome(wk);
      return;
    }
    const home = W.buildings.get(wk.home);
    if (home && (wk.kind === 'porter' || wk.kind === 'peddler')) for (const g of ['food', 'pottery', 'silk']) { home.stock[g] += wk.load[g]; wk.load[g] = 0; }
    if (home && wk.kind === 'cart' && wk.carry >= 1) {
      if (home.out && typeof home.out === 'object') home.out[wk.good] = (home.out[wk.good] || 0) + wk.carry;
      else if (typeof home.out === 'number') home.out += wk.carry;
      wk.carry = 0;
    }
    this.kill(wk);
  }

  // 路口选择：偏向附近有需要的民居的那条路（按需求加权随机）
  houseWants(wk, b) {
    if (wk.served.has(b.id)) return false;
    if (wk.kind === 'watchman') return b.fireRisk > 40;
    if (wk.kind === 'mason') return b.cond < 75 && b.type !== 'ruin';
    if (b.type !== 'house' || b.pop <= 0) return false;
    if (wk.kind === 'peddler') return b.food < b.pop * 1.2 || (b.level >= 3 && b.pottery < b.pop * 0.1) || (b.level >= 4 && b.silk < b.pop * 0.08);
    if (wk.kind === 'priest') return b.faithUntil - this.t < 3;
    if (wk.kind === 'teller') return b.level >= 3 && b.funUntil - this.t < 3;
    return false;
  }
  pickRoam(wk, opts) {
    if (opts.length === 1) return opts[0];
    const W = this.w;
    const w = opts.map(k => {
      const i = k % W.N, j = (k / W.N) | 0;
      let score = 1;
      for (let y = j - 3; y <= j + 3; y++) for (let x = i - 3; x <= i + 3; x++) {
        const b = W.buildingAt(x, y);
        if (b && this.houseWants(wk, b)) score += 3;
      }
      return score;
    });
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let n = 0; n < opts.length; n++) { r -= w[n]; if (r <= 0) return opts[n]; }
    return opts[opts.length - 1];
  }

  serve(wk, k) {
    const W = this.w, i = k % W.N, j = (k / W.N) | 0;
    const home = W.buildings.get(wk.home);
    if (!home) return;
    for (let y = j - 2; y <= j + 2; y++) for (let x = i - 2; x <= i + 2; x++) {
      const b = W.buildingAt(x, y);
      if (!b || wk.served.has(b.id)) continue;
      if (wk.kind === 'watchman') { wk.served.add(b.id); b.fireRisk = 0; continue; }
      if (wk.kind === 'mason') { wk.served.add(b.id); if (b.type !== 'ruin') b.cond = 100; continue; }
      if (b.type !== 'house') continue;
      wk.served.add(b.id);
      if (wk.kind === 'peddler') {
        const s = wk.load;
        const give = (field, want) => {
          const n = Math.min(Math.max(0, want - b[field]), s[field]);
          if (n <= 0) return;
          b[field] += n; s[field] -= n;
          const coin = n * PRICE[field];
          this.money += coin; this.cur.commerce += coin;
        };
        give('food', b.pop * 2.2);
        if (b.level >= 3) give('pottery', b.pop * 0.35);
        if (b.level >= 4) give('silk', b.pop * 0.3);
      } else if (wk.kind === 'priest') b.faithUntil = this.t + FAITH_MONTHS;
      else if (wk.kind === 'teller') b.funUntil = this.t + FUN_MONTHS;
    }
  }

  kill(wk) {
    if (wk.dead) return;
    wk.dead = true;
    const home = this.w.buildings.get(wk.home);
    if (home) {
      if (wk.kind === 'cart') home.cartOut = false;
      if (wk.kind === 'porter') home.porterOut = false;
      if (wk.kind === 'peddler') home.peddlers = Math.max(0, (home.peddlers || 1) - 1);
      if (wk.kind === 'priest') home.priestOut = false;
      if (wk.kind === 'teller') home.tellerOut = false;
      if (wk.kind === 'watchman') home.watchOut = false;
      if (wk.kind === 'mason') home.masonOut = false;
      if (wk.kind === 'fireman') home.teamOut = false;
    }
    if (wk.kind === 'fireman') { const t = this.w.buildings.get(wk.target); if (t) t.fireTeam = false; }
    if (wk.kind === 'immigrant') {
      const t = this.w.buildings.get(wk.target);
      if (t) t.incoming = Math.max(0, t.incoming - wk.carry);
    }
  }

  walkerPose(wk) {
    const N = this.w.N;
    const a = wk.path[Math.min(wk.idx, wk.path.length - 1)];
    const b = wk.path[Math.min(wk.idx + 1, wk.path.length - 1)];
    const t = Math.min(1, wk.prog);
    if (wk.approach > 0 || wk.phase === 'gone') {
      const e = this.w.entry, off = wk.approach > 0 ? wk.approach : wk.depart;
      return { x: e.i + 0.5 - off, z: e.j + 0.5, dx: wk.approach > 0 ? 1 : -1, dz: 0 };
    }
    const ax = a % N + 0.5, az = ((a / N) | 0) + 0.5;
    const bx = b % N + 0.5, bz = ((b / N) | 0) + 0.5;
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: bx - ax, dz: bz - az };
  }
}

export { GOOD_NAME };

function toCN(n) {
  const d = '〇一二三四五六七八九';
  if (n < 10) return d[n];
  if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
  if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
  return String(n);
}
