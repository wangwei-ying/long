// 界面：顶栏数据、工具栏、建筑详情、目标、消息
import { BUILDINGS, TOOL_GROUPS, HOUSE_LEVELS, STAGES, FENGSHUI_L3, TRADE, DEADLINE_YEARS } from './config.js';
import { flowLinks, CHAINS } from './flow.js';
import { describeWx } from './fsview.js';

const GOODS = [['food', '粮食', 20], ['pottery', '陶器', 10], ['silk', '丝绸', 10], ['cocoon', '蚕茧', 10]];

const $ = s => document.querySelector(s);

export class UI {
  constructor(game) {
    this.game = game;
    this.sim = game.sim;
    this.world = game.world;
    this.infoId = null;
    this.buildToolbar();
    this.bindTop();
    this.sim.on('msg', m => this.toast(m.text, m.kind));
    this.sim.on('stage', st => {
      this.showModal({ seal: '成', title: st.done, tag: `${st.title}均已达成`, text: st.doneText, close: '继 续 经 营' });
      if (this.game.bot) setTimeout(() => { if ($('#won-title').textContent === st.done) $('#won').hidden = true; }, 4000);
      this.renderGoals();
    });
    this.sim.on('victory', sum => this.showModal({ seal: '胜', title: '通关 · 郡城繁华', tag: `${sum.date}，用时 ${sum.years.toFixed(1)} 年`, text: STAGES[STAGES.length - 1].doneText, stats: sum, close: '继续自由经营', restart: true }));
    this.sim.on('defeat', sum => this.showModal({ seal: '败', title: '营城失败', tag: sum.date, text: sum.reason, stats: sum, close: '看 看 城 池', restart: true }));
    this.sim.on('month', tax => {
      const el = $('#st-income');
      el.textContent = `+${tax}/月`;
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 900);
    });
    $('#won-close').addEventListener('click', () => { $('#won').hidden = true; });
    $('#won-restart').addEventListener('click', () => { this.game.newCity(); $('#won').hidden = true; });
    $('#intro-ai').addEventListener('click', () => { $('#intro').hidden = true; this.game.startAutoplay(); });
    $('#intro-tut').addEventListener('click', () => { $('#intro').hidden = true; this.game.startTutorial(); });
    $('#tut-prev').addEventListener('click', () => this.game.tutorial.go(-1));
    $('#tut-next').addEventListener('click', () => this.game.tutorial.next());
    $('#tut-skip').addEventListener('click', () => this.game.tutorial.stop());
    $('#help-close').addEventListener('click', () => { $('#help').hidden = true; });
    document.querySelectorAll('#help [data-tab]').forEach(b => b.addEventListener('click', () => this.helpTab(b.dataset.tab)));
    $('#goal-list').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) this.game.focusGoal(li.dataset.id); });
    $('#ai-stop').addEventListener('click', () => this.game.stopAutoplay());
    $('#trade-close').addEventListener('click', () => this.showSide(null));
    $('#flow-close').addEventListener('click', () => this.game.setFlow(false));
    $('#intro-start').addEventListener('click', () => { $('#intro').hidden = true; });
    $('#intro-new').addEventListener('click', () => { this.game.newCity(); $('#intro').hidden = true; });
    $('#info-close').addEventListener('click', () => this.showInfo(null));
    this.renderGoals();
    const top = $('#top');
    const syncTop = () => document.documentElement.style.setProperty('--top-h', `${top.offsetHeight}px`);
    if (window.ResizeObserver) new ResizeObserver(syncTop).observe(top);
    syncTop();
  }

  buildToolbar() {
    const bar = $('#tools');
    TOOL_GROUPS.forEach((group, gi) => {
      if (gi) { const sep = document.createElement('span'); sep.className = 'tsep'; bar.appendChild(sep); }
      for (const id of group) this.toolButton(bar, id);
    });
  }

  toolButton(bar, id) {
    {
      const d = BUILDINGS[id];
      const b = document.createElement('button');
      b.className = 'tool';
      b.id = `tool-${id}`;
      b.dataset.tool = id;
      b.innerHTML = `<span class="glyph">${d.glyph}</span><span class="tname">${d.name}</span><span class="tcost">${d.cost ? d.cost + ' 文' : '&nbsp;'}</span>${d.key ? `<kbd>${d.key}</kbd>` : ''}`;
      b.title = d.desc;
      b.addEventListener('click', () => this.game.setTool(id));
      b.addEventListener('mouseenter', () => this.showHint(id));
      b.addEventListener('mouseleave', () => this.showHint(this.game.tool));
      bar.appendChild(b);
    }
  }

  bindTop() {
    document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => this.game.setSpeed(+b.dataset.speed)));
    $('#ov-water').addEventListener('click', () => this.game.toggleOverlay(1));
    $('#ov-fs').addEventListener('click', () => this.game.toggleOverlay(2));
    $('#ov-flood').addEventListener('click', () => this.game.toggleOverlay(3));
    $('#ov-wx').addEventListener('click', () => this.game.toggleOverlay(4));
    $('#ov-flow').addEventListener('click', () => this.game.setFlow(!this.game.flowOn));
    $('#opt-trade').addEventListener('click', () => this.showSide($('#trade').hidden ? 'trade' : null));
    $('#opt-day').addEventListener('click', () => { const r = this.game.renderer; r.dayCycle = !r.dayCycle; if (!r.dayCycle) r.dayTime = 0.36; this.syncToggles(); });
    $('#opt-paint').addEventListener('click', () => { const r = this.game.renderer; r.paint = !r.paint; this.syncToggles(); });
    $('#opt-ink').addEventListener('click', () => { const r = this.game.renderer; r.ink = !r.ink; this.syncToggles(); });
    $('#opt-help').addEventListener('click', () => this.openHelp());
    $('#opt-save').addEventListener('click', () => this.game.save(false));
    $('#opt-ledger').addEventListener('click', () => this.showLedger($('#ledger').hidden));
    $('#ledger-close').addEventListener('click', () => this.showLedger(false));
    this.syncToggles();
  }

  syncToggles() {
    const g = this.game, r = g.renderer;
    $('#ov-water').setAttribute('aria-pressed', g.overlayUser === 1);
    $('#ov-fs').setAttribute('aria-pressed', g.overlayUser === 2);
    $('#ov-flood').setAttribute('aria-pressed', g.overlayUser === 3);
    $('#ov-wx').setAttribute('aria-pressed', g.overlayUser === 4);
    $('#wxlegend').hidden = g.overlayUser !== 4;
    $('#ov-flow').setAttribute('aria-pressed', !!g.flowOn);
    $('#opt-trade').setAttribute('aria-pressed', !$('#trade').hidden);
    $('#opt-day').setAttribute('aria-pressed', r.dayCycle);
    $('#opt-ink').setAttribute('aria-pressed', r.ink);
    $('#opt-paint').setAttribute('aria-pressed', r.paint);
    document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.speed === this.sim.speed));
  }

  setActiveTool(id) {
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
    this.showHint(id);
  }

  showHint(id) {
    const d = BUILDINGS[id];
    $('#hint').innerHTML = `<b>${d.name}</b>${d.cost ? `<span class="hcost">${d.cost} 文</span>` : ''}<span>${d.desc}</span>`;
  }

  toast(text, kind = 'info') {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  cursorTip(x, y, text, bad) {
    const t = $('#ctip');
    if (!text) { t.hidden = true; return; }
    t.hidden = false;
    t.textContent = text;
    t.classList.toggle('bad', !!bad);
    t.style.transform = `translate(${x + 16}px, ${y + 14}px)`;
  }

  // 右侧面板互斥：详情 / 账簿 / 商队 / 流向
  showSide(which) {
    $('#trade').hidden = which !== 'trade';
    if (which !== 'flow' && this.game.flowOn && which) this.game.setFlow(false);
    $('#flow').hidden = which !== 'flow';
    if (which && which !== 'ledger') $('#ledger').hidden = true;
    if (which && which !== 'info') { this.infoId = null; $('#info').hidden = true; }
    if (which === 'trade') this.renderTrade();
    if (which === 'flow') this.renderFlow();
    this.syncToggles();
  }

  openHelp(tab = 'h-basic') { $('#help').hidden = false; this.helpTab(tab); }
  helpTab(id) {
    document.querySelectorAll('#help .hsec').forEach(s => { s.hidden = s.id !== id; });
    document.querySelectorAll('#help [data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === id));
  }

  showModal(o) {
    $('#won').querySelector('.seal').textContent = o.seal;
    $('#won-title').textContent = o.title;
    $('#won-tag').textContent = o.tag;
    $('#won-text').textContent = o.text;
    const st = o.stats;
    $('#won-stats').innerHTML = st ? [
      ['人口', `${st.population}（最高 ${st.record.maxPop}）`], ['铜钱', st.money.toLocaleString('zh-CN')],
      ['民居', HOUSE_LEVELS.slice(1).map((L, i) => `${L.name} ${st.levels[i]}`).join(' · ')],
      ['火灾', `${st.record.fires} 起，扑灭 ${st.record.firesOut}，烧毁 ${st.record.burnt}`],
      ['汛期', `${st.record.floods} 次，受淹 ${st.record.floodHits} 座`], ['倒塌', `${st.record.collapses} 座`],
      ['商队', `成交 ${st.record.trades} 次，收入 ${st.record.tradeIncome} 文，支出 ${st.record.tradeCost} 文`],
    ].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('') : '';
    $('#won-close').textContent = o.close;
    $('#won-restart').hidden = !o.restart;
    $('#won').hidden = false;
  }

  renderTrade() {
    const s = this.sim, tp = [...this.world.buildings.values()].find(b => b.type === 'tradepost');
    const head = !tp ? '<p>还没有商栈：先在官道附近建一座「商栈」，商队才会来。</p>'
      : tp.staff <= 0 ? '<p>商栈没有工人，商队不会来。</p>'
      : `<p>下一支商队：${s.nextCaravan != null ? `${Math.max(0, s.nextCaravan - Math.floor(s.t))} 个月后` : '下个月'}。每队每种货最多买卖：粮 ${TRADE.cap.food}、其他 ${TRADE.cap.pottery}～${TRADE.cap.cocoon}。</p>`;
    const rows = GOODS.map(([g, name, step]) => {
      const set = s.trade[g];
      const keepLabel = set.mode === 'import' ? '补足到' : '至少留';
      return `<div class="trow"><span class="gname">${name}</span><span class="tinfo">仓里 ${Math.round(s.storageStock(g))} · 卖 ${TRADE.sell[g]} 文 / 买 ${TRADE.buy[g]} 文</span>
        <div class="tctl">
          <button class="mini" data-g="${g}" data-mode="none" aria-pressed="${set.mode === 'none'}">不买卖</button>
          <button class="mini exp" data-g="${g}" data-mode="export" aria-pressed="${set.mode === 'export'}">出口</button>
          <button class="mini imp" data-g="${g}" data-mode="import" aria-pressed="${set.mode === 'import'}">进口</button>
          <span style="margin-left:auto;color:var(--muted);font-size:12px">${keepLabel}</span>
          <button class="mini" data-g="${g}" data-d="-${step}">−</button><span class="keep">${set.keep}</span><button class="mini" data-g="${g}" data-d="${step}">＋</button>
        </div></div>`;
    }).join('');
    const lt = s.lastTrade;
    const last = lt ? `<p>上次（${lt.date}）：${lt.income ? `卖出得 ${lt.income} 文` : '没卖货'}，${lt.cost ? `买进花 ${lt.cost} 文` : '没买货'}。累计收入 ${s.record.tradeIncome} 文。</p>` : '';
    $('#trade-body').innerHTML = head + rows + last + '<p>出口：仓库里超过「至少留」的部分卖给商队。进口：不足「补足到」的部分向商队买，再由推车送进仓库。</p>';
    $('#trade-body').querySelectorAll('button[data-g]').forEach(btn => btn.addEventListener('click', () => {
      const set = s.trade[btn.dataset.g];
      if (btn.dataset.mode) set.mode = btn.dataset.mode;
      if (btn.dataset.d) set.keep = Math.max(0, set.keep + Number(btn.dataset.d));
      this.renderTrade();
    }));
  }

  renderFlow() {
    const s = this.sim, A = s.avgStats(3), all = [...this.world.buildings.values()];
    const n = t => all.filter(b => b.type === t).length;
    const f = v => Math.round(v);
    const probs = all.filter(b => ['缺工', '断料', '满仓', '无路'].includes(b.icon)).slice(0, 8)
      .map(b => `<li>${BUILDINGS[b.type].name}（${b.i},${b.j}）${b.icon}：${b.status || ''}</li>`).join('');
    const hungry = all.filter(b => b.type === 'house' && b.icon === '饥').length;
    const row = (key, path, nums, bad) => `<div class="chainrow ${bad ? 'bad' : ''}"><span class="cdot" style="background:#${CHAINS[key].color.toString(16).padStart(6, '0')}"></span><span class="path">${path}</span><div class="nums">${nums}</div></div>`;
    const filter = this.game.renderer.flow.filter;
    $('#flow-body').innerHTML = `
      <div class="tctl" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">${[['all', '全部'], ['food', '粮'], ['silk', '丝'], ['pottery', '陶'], ['trade', '商'], ['service', '集市→民居']].map(([k, t]) => `<button class="mini" data-f="${k}" aria-pressed="${filter === k}">${t}</button>`).join('')}</div>
      ${row('food', `农田 ${n('farm')} → 粮仓 ${n('granary')} → 集市 ${n('market')} → 民居`, `粮食 月产 ${f(A.prod.food)} · 月耗 ${f(A.cons.food)} · 存 ${s.stockOf('food')}${hungry ? ` · ${hungry} 户缺粮` : ''}`, A.prod.food < A.cons.food || hungry > 2)}
      ${row('silk', `桑园 ${n('mulberry')} → 丝坊 ${n('silk')} → 货栈 ${n('warehouse')} → 集市`, `蚕茧 月产 ${f(A.prod.cocoon)} / 用 ${f(A.cons.cocoon)} · 丝绸 月产 ${f(A.prod.silk)} / 耗 ${f(A.cons.silk)}`, A.prod.silk < A.cons.silk)}
      ${row('pottery', `陶窑 ${n('kiln')} → 货栈 ${n('warehouse')} → 集市`, `陶器 月产 ${f(A.prod.pottery)} · 月耗 ${f(A.cons.pottery)} · 存 ${s.stockOf('pottery')}`, A.prod.pottery < A.cons.pottery)}
      ${row('trade', `官道 → 商栈 ${n('tradepost')} → 仓库`, `商队累计收入 ${s.record.tradeIncome} 文 · 支出 ${s.record.tradeCost} 文`, false)}
      ${probs ? `<p style="margin-top:8px;color:var(--paper)">卡住的环节（地图上标红闪烁）</p><ul class="problems">${probs}</ul>` : '<p>各条链都在运转。</p>'}`;
    $('#flow-body').querySelectorAll('button[data-f]').forEach(btn => btn.addEventListener('click', () => {
      this.game.renderer.flow.filter = btn.dataset.f;
      this.game.refreshFlow();
      this.renderFlow();
    }));
  }

  showLedger(on) {
    if (on) this.showSide('ledger');
    $('#ledger').hidden = !on;
    $('#opt-ledger').setAttribute('aria-pressed', !!on);
    if (on) { this.showInfo(null); this.renderLedger(); }
  }

  renderLedger() {
    const s = this.sim, L = s.last, A = s.avgStats(3);
    const f = n => Math.round(n).toLocaleString('zh-CN');
    const net = L.tax + L.commerce + (L.tradeIn || 0) - (L.tradeOut || 0) - L.wages - L.upkeep;
    const sign = n => `<span class="${n >= 0 ? 'pos' : 'neg'}">${n >= 0 ? '+' : '−'}${f(Math.abs(n))}</span>`;
    const goods = [['food', '粮食'], ['cocoon', '蚕茧'], ['pottery', '陶器'], ['silk', '丝绸']];
    const gRows = goods.map(([k, name]) => {
      const bal = A.prod[k] - A.cons[k];
      return `<tr><td>${name}</td><td>${f(A.prod[k])}</td><td>${f(A.cons[k])}</td><td>${sign(bal)}</td><td>${f(s.stockOf(k))}</td></tr>`;
    }).join('');
    // 劳力按行业
    const cats = [['粮食', ['farm', 'granary']], ['集市', ['market']], ['手工', ['mulberry', 'silk', 'kiln', 'warehouse']], ['祠庙茶楼', ['temple', 'teahouse']]];
    const lab = cats.map(([name, types]) => {
      let have = 0, need = 0;
      for (const b of this.world.buildings.values()) if (types.includes(b.type)) { have += b.staff || 0; need += b.need || 0; }
      return need ? `<tr><td>${name}</td><td>${have}</td><td>${need}</td><td>${have < need ? `<span class="neg">缺 ${need - have}</span>` : '<span class="pos">满</span>'}</td></tr>` : '';
    }).join('');
    const noData = !(s.history || []).length;
    $('#ledger-body').innerHTML = `
      <h3>上月收支</h3>
      <table>
        <tr><td>赋税（按户等级）</td><td>${sign(L.tax)}</td></tr>
        <tr><td>市税（货郎卖货）</td><td>${sign(L.commerce)}</td></tr>
        <tr><td>工钱（在岗工人）</td><td>${sign(-L.wages)}</td></tr>
        <tr><td>建筑维护</td><td>${sign(-L.upkeep)}</td></tr>
        <tr><td>商队卖货</td><td>${sign(L.tradeIn || 0)}</td></tr>
        <tr><td>商队买货</td><td>${sign(-(L.tradeOut || 0))}</td></tr>
        <tr class="total"><td>结余</td><td>${sign(net)}</td></tr>
      </table>
      ${noData ? '<p class="note">第一个月结算后才有数据。</p>' : ''}
      <h3>货物产销（近三月，每月）</h3>
      <table>
        <tr><th>货物</th><th>产</th><th>耗</th><th>盈亏</th><th>库存</th></tr>${gRows}
      </table>
      <p class="note">“耗”是百姓用掉的，蚕茧是丝坊用掉的。盈亏为负时，库存会越来越少。</p>
      <h3>劳力</h3>
      <table>
        <tr><th>行业</th><th>在岗</th><th>需要</th><th></th></tr>${lab}
      </table>
      <p class="note">可出工 ${s.workforce} 人 · 在岗 ${s.employed} · 闲置 ${s.idle}。茅屋瓦舍出工多，府邸大宅出工少；人不够时先保粮食，再到集市、作坊、祠庙茶楼。</p>`;
  }

  renderGoals() {
    const st = STAGES[Math.min(this.sim.stage, STAGES.length - 1)];
    $('#goals-title').textContent = st.title;
    // 列表只在换阶段时重建，平时原地更新文字（否则点击会因元素被替换而失效）
    const ul = $('#goal-list');
    if (ul.dataset.stage !== st.title) {
      ul.dataset.stage = st.title;
      ul.innerHTML = st.goals.map(g => `<li data-id="${g.id}" title="点一下：看看该怎么做"><span class="tick"></span>${g.text}<span class="gp"></span></li>`).join('');
    }
    for (const g of st.goals) {
      const li = ul.querySelector(`li[data-id="${g.id}"]`);
      if (!li) continue;
      const done = this.sim.goalsDone.has(g.id);
      li.classList.toggle('done', done);
      li.querySelector('.tick').textContent = done ? '✓' : '○';
      li.querySelector('.gp').textContent = g.progress(this.sim);
    }
    const s = this.sim;
    $('#goal-hint').textContent = s.won ? '全部完成，可以继续自由经营。' : st.hint || '';
    const left = Math.max(0, Math.ceil(s.deadlineT - s.t));
    $('#goal-deadline').textContent = s.won ? '已通关' : s.over ? '本局已结束' : `期限：第${'〇一二三四五六七八九十'[DEADLINE_YEARS] || DEADLINE_YEARS}年腊月 · 还剩 ${Math.floor(left / 12)} 年 ${left % 12} 个月`;
    $('#goal-deadline').classList.toggle('urgent', !s.won && left < 18);
  }

  showInfo(b) {
    if (b) this.showSide('info');
    this.infoId = b ? b.id : null;
    $('#info').hidden = !b;
    if (b) this.renderInfo();
  }

  renderInfo() {
    const b = this.world.buildings.get(this.infoId);
    if (!b) { this.showInfo(null); return; }
    const d = BUILDINGS[b.type];
    const rows = [];
    let title = d.name, sub = '';
    const fs = this.world.fengshui[this.world.idx(b.i, b.j)];
    const row = (k, v, cls = '') => rows.push(`<div class="row ${cls}"><span>${k}</span><b>${v}</b></div>`);
    if (b.type === 'house') {
      const L = HOUSE_LEVELS[b.level];
      title = L.name;
      sub = ['划定的宅地，等候移民', '简陋茅屋', '粉墙瓦舍', '体面宅院', '两层楼的府邸', '有园有池的大宅'][b.level];
      row('居民', `${b.pop} / ${b.level ? L.cap : 6}`);
      if (b.incoming) row('正在迁入', `${b.incoming} 人`);
      row('存粮', `${Math.floor(b.food)}`, b.food > 0 ? 'ok' : 'bad');
      row('水源', b.hasWater ? (this.world.water[this.world.idx(b.i, b.j)] === 2 ? '水井' : '河水') : '无', b.hasWater ? 'ok' : 'bad');
      row('信仰', b.faith ? '已满足' : '无', b.faith ? 'ok' : 'bad');
      if (b.level >= 3) {
        row('陶器', `${Math.floor(b.pottery)}`, b.pottery > 0 ? 'ok' : 'bad');
        row('娱乐', b.fun ? '已满足' : '无', b.fun ? 'ok' : 'bad');
      }
      if (b.level >= 4) row('丝绸', `${Math.floor(b.silk)}`, b.silk > 0 ? 'ok' : 'bad');
      const tot = b.fs ?? fs, wx = b.wxInfo;
      row('风水', `${tot.toFixed(1)}（形势 ${fs.toFixed(1)} · 五行 ${wx ? (wx.delta >= 0 ? '+' : '') + wx.delta : 0}）`, tot >= FENGSHUI_L3 ? 'ok' : tot < 0 ? 'bad' : '');
      if (wx) row('五行', describeWx(wx), wx.delta > 0 ? 'ok' : wx.delta < 0 ? 'bad' : '');
      row('每月赋税', `${Math.round(b.pop * L.tax)} 文`);
      const needs = this.sim.houseNeeds(b);
      if (b.level < 5 && needs.length) rows.push(`<div class="needs"><span>升级所需</span><ul>${needs.map(n => `<li>${n}</li>`).join('')}</ul></div>`);
      if (b.level === 5) rows.push(`<div class="needs ok">已达最高等级</div>`);
    } else if (b.type === 'ruin') {
      sub = d.desc;
      row('原址大小', `${b.size}×${b.size}`);
    } else {
      sub = d.desc;
      if (d.workers) row('在岗', `${b.staff || 0} / ${d.workers} 人`, (b.staff || 0) >= d.workers ? 'ok' : 'bad');
      if (d.workers && (b.staff || 0) < d.workers) rows.push(`<div class="needs"><span>${b.staff ? '人手不足，产出按在岗比例打折' : '没有工人：城里可出工的人不够，或被优先级更高的作坊分走'}</span></div>`);
      if (b.status) row('状态', b.status);
      if (b.type === 'farm') row('长势', `${Math.round((b.growth || 0) * 100)}%`);
      if (b.type === 'granary') row('存粮', `${Math.floor(b.food)} / ${d.capacity}`);
      if (b.type === 'market') { row('粮食', `${Math.floor(b.stock.food)}`); row('陶器', `${Math.floor(b.stock.pottery)}`); row('丝绸', `${Math.floor(b.stock.silk)}`); }
      if (b.type === 'mulberry') row('长势', `${Math.round((b.growth || 0) * 100)}%`);
      if (b.type === 'silk') { row('蚕茧', `${Math.floor(b.cocoon)}`); row('织造进度', `${Math.round(b.prog * 100)}%`); row('待运丝绸', `${Math.floor(b.out)}`); }
      if (b.type === 'kiln') { row('烧制进度', `${Math.round(b.prog * 100)}%`); row('待运陶器', `${Math.floor(b.out)}`); }
      if (b.type === 'warehouse') { row('陶器', `${Math.floor(b.goods.pottery)}`); row('丝绸', `${Math.floor(b.goods.silk)}`); row('容量', `${Math.floor(b.goods.pottery + b.goods.silk)} / ${d.capacity}`); }
      row('风水', fs.toFixed(1));
    }
    if (b.type !== 'ruin') {
      if (b.burning) rows.unshift(`<div class="needs"><span>正在燃烧！${b.fireTeam ? '水龙队正在赶来' : '附近没有可达的水龙局，将被烧毁'}</span></div>`);
      if (b.type !== 'levee') {
        row('坚固', `${Math.round(b.cond)}%`, b.cond < 40 ? 'bad' : 'ok');
        row('火险', `${Math.round(b.fireRisk)}%`, b.fireRisk > 70 ? 'bad' : '');
      }
      if (this.world.inFloodZone(b)) row('汛险', '汛期会被淹', 'bad');
    }
    $('#info-title').textContent = title;
    $('#info-sub').textContent = sub;
    $('#info-body').innerHTML = rows.join('');
  }

  update() {
    const s = this.sim;
    $('#st-money').textContent = Math.floor(s.money).toLocaleString('zh-CN');
    $('#st-pop').textContent = s.population;
    $('#st-food').textContent = s.totalFood();
    $('#st-goods').textContent = `${s.totalGoods('pottery')} · ${s.totalGoods('silk')}`;
    $('#st-labor').textContent = `${s.employed}/${s.demand}`;
    $('#st-idle').textContent = s.idle ? `闲 ${s.idle}` : '';
    $('#st-labor').parentElement.classList.toggle('warn', s.demand > s.workforce);
    if (!$('#ledger').hidden) this.renderLedger();
    if (!$('#trade').hidden) this.renderTrade();
    if (!$('#flow').hidden) this.renderFlow();
    // 教程面板放在目标面板下面
    if (!$('#tut').hidden && innerWidth > 760) { const gp = $('#goals'); $('#tut').style.top = `${gp.offsetTop + gp.offsetHeight + 8}px`; }
    this.game.tutorial?.tick();
    $('#st-date').textContent = s.dateText();
    let fsSum = 0, n = 0;
    for (const b of this.world.buildings.values()) if (b.type === 'house') { fsSum += this.world.fengshui[this.world.idx(b.i, b.j)]; n++; }
    $('#st-fs').textContent = n ? (fsSum / n).toFixed(1) : '—';
    this.renderGoals();
    if (this.infoId != null) this.renderInfo();
    // 昼夜指示
    const t = this.game.renderer.dayTime;
    $('#st-clock').textContent = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'][Math.floor(((t * 24 + 1) % 24) / 2)] + '时';
  }
}
