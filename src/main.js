// 入口：组装世界、模拟、渲染、界面与输入
import { World } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { seedStarter } from './scenario.js';
import { Bot } from './bot.js';
import { flowLinks } from './flow.js';
import { fengshuiPreview } from './fsview.js';
import { Tutorial } from './tutorial.js';
import { BUILDINGS, TOOL_ORDER, N, START_MONEY } from './config.js';

const SAVE_KEY = 'jiangshan-save-v2';

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.world = new World();
    this.sim = new Sim(this.world);
    this.renderer = new Renderer(this.canvas, this.world, this.sim);
    this.rig = new CameraRig(this.renderer.camera);
    this.rig.target.set(-9, 0, 1); this.rig.goal.copy(this.rig.target);
    this.tool = 'select';
    this.overlayUser = 0;
    this.drag = null;
    this.hover = null;
    this.pointers = new Map();
    this.ui = new UI(this);
    this.tutorial = new Tutorial(this);
    this.initialTrees = Array.from(this.world.tree).join('');
    const saved = this.readSave();
    if (saved) {
      this.applyState(saved);
      document.getElementById('intro-start').textContent = '继 续 营 城';
      document.getElementById('intro-new').hidden = false;
    } else this.seedStarter();
    this.sim.on('month', () => this.save(true));
    this.bindInput();
    this.setTool('select');
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    this.uiTimer = 0;
    requestAnimationFrame(t => this.frame(t));
  }

  seedStarter() { seedStarter(this.sim); }

  // ---------- 存档（存在本浏览器） ----------
  readSave() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  save(silent) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.sim.serialize()));
      if (!silent) this.ui.toast('已存档：' + this.sim.dateText(), 'good');
    } catch {
      if (!silent) this.ui.toast('这个浏览器不允许存档', 'warn');
    }
  }
  applyState(d) {
    this.sim.restore(d);
    this.renderer.rebuildAll();
    this.ui.showInfo(null);
    this.ui.renderGoals();
  }
  newCity() {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    this.sim.restore({ roads: [], trees: this.initialTrees, buildings: [], nextId: 1, money: START_MONEY, t: 2, stage: 0, goalsDone: [] });
    this.renderer.rebuildAll();
    this.seedStarter();
    this.ui.showInfo(null);
    this.ui.renderGoals();
    document.getElementById('intro-start').textContent = '开 始 营 城';
  }

  setTool(id) {
    this.tool = id;
    this.drag = null;
    this.ui.setActiveTool(id);
    this.renderer.tu.uGrid.value = id === 'select' ? 0 : 1;
    this.renderer.setGhost(null);
    this.applyOverlay();
    this.refreshPreview(true);
  }

  setSpeed(s) { this.sim.speed = s; this.ui.syncToggles(); }

  // 流向图层
  setFlow(on) {
    this.flowOn = on;
    this.renderer.flow.visible = on;
    if (on) { this.refreshFlow(); this.ui.showSide('flow'); }
    else document.getElementById('flow').hidden = true;
    this.ui.syncToggles();
  }
  refreshFlow() { this.renderer.flow.build(flowLinks(this.sim)); }

  startTutorial() {
    this.stopAutoplay?.call(this, true);
    this.newCity();
    this.setSpeed(1);
    this.tutorial.start();
  }

  // 点目标：高亮离目标最近、还差条件的民居，并说明差什么
  focusGoal(id) {
    const st = this.sim.stageInfo, g = st.goals.find(x => x.id === id);
    if (!g) return;
    if (!g.level) { this.ui.toast(`「${g.text}」：${st.hint}`, 'info'); return; }
    const hs = [...this.world.buildings.values()].filter(b => b.type === 'house' && b.level === g.level - 1);
    if (!hs.length) { this.ui.toast(`还没有${['', '', '', '瓦舍', '宅院', '府邸'][g.level]}可以升级：先让民居升到上一级`, 'info'); return; }
    const tally = {};
    for (const h of hs) for (const n of this.sim.houseNeeds(h)) { const key = n.replace(/（.*）/, ''); tally[key] = (tally[key] || 0) + 1; }
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}（${v} 户）`).join('；');
    this.renderer.setPreview([], [], hs.map(h => [h.i, h.j]));
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => this.refreshPreview(), 6000);
    let x = 0, z = 0; for (const h of hs) { x += h.i; z += h.j; }
    this.rig.goal.set(x / hs.length + 0.5 - N / 2, 0, z / hs.length + 0.5 - N / 2);
    this.ui.toast(`${hs.length} 户可升${['', '', '', '宅院', '府邸', '大宅'][g.level]}（已高亮）。还差：${top || '条件已满足，等一会儿就升'}`, 'good');
  }

  // AI 自动经营：每半个月让自动玩家看一眼、做决定
  startAutoplay() {
    this.bot = new Bot(this.sim, t => this.ui.toast('AI：' + t, 'info'));
    this.setSpeed(4);
    document.getElementById('ai-stop').hidden = false;
  }
  stopAutoplay(silent) {
    const was = !!this.bot;
    this.bot = null;
    document.getElementById('ai-stop').hidden = true;
    if (was && !silent) this.ui.toast('已由你接手经营', 'good');
  }

  toggleOverlay(n) { this.overlayUser = this.overlayUser === n ? 0 : n; this.applyOverlay(); this.ui.syncToggles(); }
  applyOverlay() {
    const auto = { well: 1, house: 2, garden: 2, temple: 2 }[this.tool] || 0;
    this.renderer.tu.uOverlay.value = this.overlayUser || auto;
  }

  // ---------- 输入 ----------
  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  }
  pickTile(e) { const p = this.ndc(e); return this.renderer.pick(p.x, p.y); }

  bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', e => this.onUp(e));
    window.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); this.drag = null; });
    c.addEventListener('wheel', e => { e.preventDefault(); this.rig.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.rig.keys.add(k); e.preventDefault(); }
      if (k === 'q') this.rig.rotate(-Math.PI / 4);
      if (k === 'e') this.rig.rotate(Math.PI / 4);
      if (k === 'r') this.rig.tilt(0.12);
      if (k === 'f') this.rig.tilt(-0.12);
      if (k === 'g') this.setFlow(!this.flowOn);
      if (k === 'escape') { this.setTool('select'); this.ui.showInfo(null); }
      if (k === ' ') { e.preventDefault(); this.setSpeed(this.sim.speed ? 0 : 1); }
      const tool = TOOL_ORDER.find(t => BUILDINGS[t].key === e.key);
      if (tool) this.setTool(tool);
    });
    window.addEventListener('keyup', e => this.rig.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.rig.keys.clear());
  }

  onDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType });
    if (this.pointers.size === 2) { this.drag = null; this.pinch = this.pinchState(); this.refreshPreview(true); return; }
    if (e.button === 2 || e.button === 1) return;
    const t = this.pickTile(e);
    if (!t) return;
    if (this.tool === 'select') return;
    this.drag = { start: t, end: t, moved: false };
    this.refreshPreview(true);
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 6) p.moved = true;
      if (this.pointers.size === 2) {
        const s = this.pinchState();
        if (this.pinch) {
          this.rig.zoom(this.pinch.d / Math.max(1, s.d));
          this.rig.panPixels(s.cx - this.pinch.cx, s.cy - this.pinch.cy, this.canvas.clientHeight);
        }
        this.pinch = s;
        return;
      }
      if (p.button === 2 || (p.type !== 'mouse' && this.tool === 'select' && p.moved)) {
        this.rig.panPixels(dx, dy, this.canvas.clientHeight);
      } else if (p.button === 1) {
        this.rig.rotate(dx * 0.008);
        this.rig.tilt(-dy * 0.004);
      }
    }
    if (e.target !== this.canvas && !p) { this.ui.cursorTip(0, 0, null); return; }
    const t = this.pickTile(e);
    this.mouse = { x: e.clientX, y: e.clientY };
    const ak = p => p ? this.anchor(p).join(',') : '';
    const changed = !this.hover || !t || t.i !== this.hover.i || t.j !== this.hover.j || ak(t) !== ak(this.hover);
    this.hover = t;
    if (this.drag && t) { this.drag.end = t; if (t.i !== this.drag.start.i || t.j !== this.drag.start.j) this.drag.moved = true; }
    if (changed) this.refreshPreview();
    else this.positionTip();
  }

  onUp(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!p) return;
    if (p.button === 2 || p.button === 1) return;
    if (this.tool === 'select') {
      if (!p.moved) {
        const t = this.pickTile(e);
        const b = t && this.world.buildingAt(t.i, t.j);
        this.ui.showInfo(b || null);
      }
      return;
    }
    if (!this.drag) return;
    const tiles = this.toolTiles(this.drag.start, this.drag.end);
    this.drag = null;
    if (tiles.length) this.sim.apply(this.tool, tiles);
    this.refreshPreview(true);
  }

  // 建筑以光标为中心：2×2、3×3 的建筑也落在光标正下方
  anchor(t) {
    const size = BUILDINGS[this.tool].size;
    if (size === 1 || t.x == null) return [t.i - Math.floor((size - 1) / 2), t.j - Math.floor((size - 1) / 2)];
    return [Math.round(t.x + N / 2 - size / 2), Math.round(t.z + N / 2 - size / 2)];
  }

  toolTiles(a, b) {
    const def = BUILDINGS[this.tool];
    if (def.drag === 'line') {
      // L 形路线：先走位移较大的方向，再拐弯
      const out = [[a.i, a.j]];
      const corner = Math.abs(b.i - a.i) >= Math.abs(b.j - a.j) ? { i: b.i, j: a.j } : { i: a.i, j: b.j };
      const walk = (p, q) => {
        const di = Math.sign(q.i - p.i), dj = Math.sign(q.j - p.j);
        let i = p.i, j = p.j;
        while (i !== q.i || j !== q.j) { i += di; j += dj; out.push([i, j]); }
      };
      walk(a, corner);
      walk(corner, b);
      return out;
    }
    if (def.drag === 'area') {
      const out = [];
      const i0 = Math.min(a.i, b.i), i1 = Math.max(a.i, b.i), j0 = Math.min(a.j, b.j), j1 = Math.max(a.j, b.j);
      for (let j = j0; j <= Math.min(j1, j0 + 30); j++) for (let i = i0; i <= Math.min(i1, i0 + 30); i++) out.push([i, j]);
      return out;
    }
    return [this.anchor(b)];
  }

  refreshPreview() {
    const R = this.renderer, W = this.world;
    const t = this.drag ? this.drag.end : this.hover;
    if (!t) { R.setPreview(); R.setGhost(null); R.setFsDelta(null); this.ui.cursorTip(0, 0, null); return; }
    if (this.tool === 'select') {
      const b = W.buildingAt(t.i, t.j);
      R.setPreview([], [], b ? W.footprint(b.i, b.j, b.size) : [[t.i, t.j]]);
      R.setGhost(null);
      R.setFsDelta(null);
      this.ui.cursorTip(0, 0, null);
      return;
    }
    const tiles = this.drag ? this.toolTiles(this.drag.start, this.drag.end) : this.toolTiles(t, t);
    const valid = [], invalid = [];
    const def = BUILDINGS[this.tool];
    if (this.tool === 'clear') {
      for (const [i, j] of tiles) {
        if (!W.inside(i, j)) continue;
        const k = W.idx(i, j);
        const b = W.buildingAt(i, j);
        if (b) invalid.push(...W.footprint(b.i, b.j, b.size));
        else if ((W.road[k] && !W.protectedRoad[k]) || W.tree[k]) invalid.push([i, j]);
        else valid.push([i, j]);
      }
      R.setPreview([], invalid, valid);
    } else {
      for (const [i, j] of tiles) {
        const ok = W.canPlace(this.tool, i, j).ok;
        (ok ? valid : invalid).push(...W.footprint(i, j, def.size));
      }
      R.setPreview(valid, invalid);
    }
    const single = !this.drag || tiles.length === 1;
    if (single && this.tool !== 'road' && this.tool !== 'clear') {
      const [i, j] = tiles[0];
      R.setGhost(this.tool, i, j, W.canPlace(this.tool, i, j).ok);
    } else R.setGhost(null);
    const c = this.sim.costOf(this.tool, tiles);
    this.tipText = c.ok ? `${c.cost} 文${c.ok > 1 ? ` · ${c.ok} 处` : ''}${c.cost > this.sim.money ? ' · 铜钱不足' : ''}` : c.reason;
    this.tipBad = !c.ok || c.cost > this.sim.money;
    // 风水预览：地面红绿着色 + 光标旁说明
    const [pi, pj] = tiles[0] || [t.i, t.j];
    if (this.tool !== 'road' && W.canPlace(this.tool, pi, pj).ok) {
      const fv = fengshuiPreview(W, this.sim, this.tool, pi, pj);
      R.setFsDelta(fv.cells);
      if (fv.lines.length) this.tipText += '\n' + fv.lines.join('\n');
      this.lastFsPreview = fv;
    } else R.setFsDelta(null);
    this.positionTip();
  }

  positionTip() {
    if (!this.mouse || this.tool === 'select') return;
    this.ui.cursorTip(this.mouse.x, this.mouse.y, this.tipText, this.tipBad);
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.resize(w, h);
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.sim.update(dt);
    this.rig.update(dt);
    this.renderer.render(dt, this.rig);
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.25;
      this.ui.update();
      if (this.flowOn && (this.flowTimer = (this.flowTimer || 0) + 1) % 4 === 0) this.refreshFlow();
      if (this.bot && this.sim.speed > 0 && (this.botTimer = (this.botTimer || 0) + 1) % 8 === 0) this.bot.step();
      if (this.hover && this.tool !== 'select') this.refreshPreview();
    }
    requestAnimationFrame(t => this.frame(t));
  }
}

window.game = new Game();
