// 新手引导：一步步带着做，地图上标出建议位置，工具按钮闪烁，做完自动进入下一步
import { Bot } from './bot.js';

const $ = s => document.querySelector(s);

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.i = 0;
    this.helper = null;
    // 一建好就把箭头挪到下一个建议位置
    game.world.on('build', () => { if (this.active && !this.done) setTimeout(() => this.updateSpot(), 0); });
    const g = game, s = () => g.sim, W = () => g.world;
    const houses = () => [...W().buildings.values()].filter(b => b.type === 'house');
    const count = t => [...W().buildings.values()].filter(b => b.type === t).length;
    const near = (kind, ai, aj, r, pred) => {
      this.helper ||= new Bot(s());
      const spot = this.helper.findSpot(kind, ai, aj, r, pred);
      return spot ? { i: spot[0], j: spot[1], size: kind === 'farm' ? 3 : kind === 'temple' ? 2 : 1 } : null;
    };
    this.steps = [
      { title: '欢迎来到河谷', manual: true,
        text: '这是朝廷拨给你的小村落：西边官道会带来移民，已有十二块宅地、两口水井、一块农田、粮仓和集市。\n· 右键拖动或 W A S D 平移，滚轮缩放，Q / E 旋转。\n· 顶栏「停 1× 2× 4×」控制时间，空格暂停。' },
      { title: '看懂一户人家',
        text: '点一座茅屋或瓦舍（箭头处）。右侧面板会列出居民、存粮、水源、风水；最下面的「升级所需」告诉你它还差什么。',
        spot: () => { const h = houses().find(b => b.level >= 1) || houses()[0]; return h ? { i: h.i, j: h.j, size: 1 } : null; },
        check: () => { const b = W().buildings.get(g.ui.infoId); return !!b && b.type === 'house'; } },
      { title: '民居五级', manual: true,
        text: '「宅院」不是一个按钮，而是民居升级的第三级：\n宅地 →（移民入住）茅屋 →（水、粮）瓦舍 →（祭祀、风水 2.5）宅院 →（陶器、茶楼、风水 3.5）府邸 →（丝绸、风水 4.5）大宅。\n缺了条件会慢慢退级，人也会搬走。' },
      { title: '修一座祠庙', tool: 'temple',
        text: '选工具栏的「庙」（150 文），放在箭头处——要挨着道路。祭司会沿街巡游，路过的人家就有了信仰，这是升宅院的条件之一。',
        spot: () => { const hs = houses(); const [ci, cj] = this.helper?.centroid(hs) || [10, 24]; return near('temple', ci, cj + 4, 10); },
        check: () => count('temple') >= 1 },
      { title: '看风水', button: '#ov-fs',
        text: '点顶栏「风水」：地面绿色为吉、红色为凶。\n加分：靠山、临水、园林、祠庙、茶楼。扣分：粮仓、陶窑、货栈、集市、农田。\n民居的风水要到 2.5 才能升宅院，3.5 府邸，4.5 大宅。',
        check: () => g.overlayUser === 2 },
      { title: '种园林：先看再放', tool: 'garden',
        text: '选「园」（25 文），先别点——把光标移到民居旁的空地上：\n· 地面绿色斜纹是它让风水上升的范围；\n· 光标旁写着「周边 N 户民居风水 +x，几户因此够升级」。\n在箭头处种两座。',
        onEnter: () => { this.base = count('garden'); },
        spot: () => {
          const hs = houses().filter(h => h.level >= 1).sort((a, b) => (a.fs ?? 0) - (b.fs ?? 0));
          for (const h of hs) { const sp = near('garden', h.i, h.j, 1, (i, j) => !this.helper.isFrontage(i, j)); if (sp) return sp; }
          return null;
        },
        check: () => count('garden') >= (this.base ?? 1) + 2 },
      { title: '五行生克', button: '#ov-wx',
        text: '点顶栏「五行」：青木、赤火、黄土、白金、黑水。\n· 宅子朝向道路：朝南属火、朝东属木、朝西属金、朝北属水。\n· 周边主导的五行「生」它 +1（如木生火），同属 +0.5，「克」它 −1（如水克火），被它泄、耗 −0.3。\n· 园林、树属木；河、井属水；窑、茶楼、祠庙属火；山、粮仓属土；集市、货栈属金。\n点一户民居，面板里有它的「五行」一行。',
        check: () => g.overlayUser === 4 },
      { title: '再开一块田', tool: 'farm',
        text: '人口会越来越多，粮食要跟上。选「田」（60 文，3×3），放在箭头处——要挨着道路。农田会扣一点风水，别贴着住宅。',
        spot: () => { const gr = [...W().buildings.values()].find(b => b.type === 'granary'); return near('farm', gr ? gr.i : 15, gr ? gr.j - 4 : 20, 12); },
        check: () => count('farm') >= 2 },
      { title: '看账簿', button: '#opt-ledger',
        text: '点顶栏「账簿」：上月收支、每种货物的月产与月耗、劳力缺口都在这里。粮食的「盈亏」为负，就该再开田了。',
        check: () => !$('#ledger').hidden },
      { title: '让时间流动', button: '#sp-4',
        text: '点顶栏「4×」加快时间，等第一座宅院出现。\n民居头上：绿色「升」表示正在升级；红色「饥」「渴」「衰」表示缺粮、缺水、正在退级。\n点左上角的目标，会高亮还差条件的民居。',
        check: () => s().countHouses(3) >= 1 },
      { title: '出师', manual: true, final: true,
        text: '接下来照左上角的目标走，三个阶段要在第十二年腊月前完成。\n· 按 G 看产业链流向，红色闪烁处就是卡住的环节。\n· 城大了要建水龙局防火、营缮所修房，河边筑堤防汛。\n· 顶栏「说明」里有完整的手册。' },
    ];
  }

  start() {
    this.active = true;
    this.i = 0;
    this.helper = new Bot(this.game.sim);
    $('#tut').hidden = false;
    this.enter();
  }
  stop() {
    this.active = false;
    $('#tut').hidden = true;
    this.clearPulse();
    this.game.renderer.clearMarker();
  }
  go(d) {
    this.i = Math.max(0, Math.min(this.steps.length - 1, this.i + d));
    this.enter();
  }
  enter() {
    const st = this.steps[this.i];
    this.done = false;
    this.doneAt = null;
    st.onEnter?.();
    this.clearPulse();
    const target = st.tool ? `#tool-${st.tool}` : st.button;
    if (target) $(target)?.classList.add('tut-pulse');
    this.spotTimer = 0;
    this.updateSpot();
    this.render();
  }
  clearPulse() { document.querySelectorAll('.tut-pulse').forEach(e => e.classList.remove('tut-pulse')); }
  updateSpot() {
    const st = this.steps[this.i];
    const sp = st.spot && !this.done ? st.spot() : null;
    if (sp) this.game.renderer.setMarker(sp.i, sp.j, sp.size); else this.game.renderer.clearMarker();
  }
  render() {
    const st = this.steps[this.i];
    $('#tut-step').textContent = `新手教程 · ${this.i + 1}/${this.steps.length}`;
    $('#tut-title').textContent = st.title;
    $('#tut-text').textContent = st.text;
    $('#tut-status').textContent = st.manual ? '' : this.done ? '✓ 做到了' : '等你动手……';
    $('#tut-status').classList.toggle('ok', this.done);
    $('#tut-prev').disabled = this.i === 0;
    $('#tut-next').disabled = !st.manual && !this.done;
    $('#tut-next').textContent = st.final ? '完成教程' : '下一步';
  }
  // 由界面每 0.25 秒调用
  tick() {
    if (!this.active) return;
    const st = this.steps[this.i];
    if (!st.manual && !this.done && st.check && st.check()) {
      this.done = true;
      this.doneAt = performance.now();
      this.clearPulse();
      this.game.renderer.clearMarker();
      this.render();
    }
    if (this.done && this.doneAt && performance.now() - this.doneAt > 1200) { this.doneAt = null; this.go(1); return; }
    if (!this.done && (this.spotTimer = (this.spotTimer || 0) + 1) % 8 === 0) this.updateSpot();
  }
  next() { const st = this.steps[this.i]; if (st.final) this.stop(); else this.go(1); }
}
