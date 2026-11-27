// 灾害与商队专项验收：逐项制造情境，检查每个分支确实发生。用法：node tools/hazards.mjs
import { World } from '../src/world.js';
import { Sim } from '../src/sim.js';
import { seedStarter } from '../src/scenario.js';

let a = 7;
Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

let pass = 0, fail = 0;
const check = (ok, text) => { console.log(`${ok ? '✓' : '✗'} ${text}`); ok ? pass++ : fail++; };
const fresh = () => { const w = new World(), s = new Sim(w); seedStarter(s); s.money = 99999; return { w, s }; };
const run = (s, months) => { const end = s.t + months; while (s.t < end && !s.over) s.update(0.1); };
const B = (w, t) => [...w.buildings.values()].filter(b => b.type === t);

// 1. 无水龙局：起火 → 蔓延 → 烧成废墟
{
  const { w, s } = fresh();
  run(s, 3);
  const house = B(w, 'house').find(h => h.i === 9 && h.j === 23);
  house.fireRisk = 100;
  run(s, 0.2);
  check(house.burning, '火险满 100 的民居起火');
  run(s, 2);
  check(!w.buildings.has(house.id), '无人扑救，一个半月后烧毁');
  check(B(w, 'ruin').length >= 1, '原地留下废墟');
  check(s.record.fires >= 1 && s.record.burnt >= 1, `记录：起火 ${s.record.fires}，烧毁 ${s.record.burnt}`);
  const ruin = B(w, 'ruin')[0];
  s.apply('clear', w.footprint(ruin.i, ruin.j, ruin.size));
  check(!w.buildings.has(ruin.id), '拆除可以清理废墟');
}
// 2. 有水龙局：派队扑灭
{
  const { w, s } = fresh();
  s.apply('firehouse', [[13, 26]]);
  run(s, 2);
  const kiln = (s.apply('road', [[27, 24], [28, 24], [29, 24], [30, 24], [31, 24], [32, 24], [33, 24], [34, 24], [35, 24]]), s.apply('kiln', [[33, 25]]), B(w, 'kiln')[0]);
  const fh = B(w, 'firehouse')[0];
  check(fh && fh.staff > 0, `水龙局有人当值（${fh?.staff}/${fh?.need}）`);
  const target = B(w, 'market')[0];
  s.ignite(target);
  run(s, 0.05);
  check(s.walkers.some(x => x.kind === 'fireman'), '起火后水龙队出动');
  run(s, 1.2);
  check(w.buildings.has(target.id) && !target.burning, '水龙队赶到，火被扑灭，建筑保住');
  check(s.record.firesOut >= 1, `记录：扑灭 ${s.record.firesOut}`);
  void kiln;
}
// 3. 巡更清火险
{
  const { w, s } = fresh();
  s.apply('firehouse', [[13, 26]]);
  run(s, 1);
  for (const h of B(w, 'house')) h.fireRisk = 70;
  run(s, 2);
  const lowered = B(w, 'house').filter(h => h.fireRisk < 40).length;
  check(lowered >= 6, `巡更人经过后火险下降（${lowered}/12 户降到 40 以下）`);
}
// 4. 年久失修倒塌；营缮所修缮
{
  const { w, s } = fresh();
  run(s, 2);
  const g = B(w, 'granary')[0];
  g.cond = 0.5;
  run(s, 1);
  check(!w.buildings.has(g.id) && s.record.collapses >= 1, '坚固度归零的粮仓倒塌成废墟');
  const { w: w2, s: s2 } = fresh();
  s2.apply('repair', [[13, 26]]);
  run(s2, 1);
  for (const h of B(w2, 'house')) h.cond = 40;
  run(s2, 2.5);
  const fixed = B(w2, 'house').filter(h => h.cond > 90).length;
  check(fixed >= 6, `营缮所匠人修缮了民居（${fixed}/12 户恢复到 90 以上）`);
}
// 5. 洪水：无堤受损；有堤保护
{
  const { w, s } = fresh();
  const road = []; for (let i = 27; i <= 35; i++) road.push([i, 24]);
  s.apply('road', road); s.apply('kiln', [[33, 25]]);
  const kiln = B(w, 'kiln')[0];
  check(w.inFloodZone(kiln), '河边的陶窑在汛险区内');
  const before = kiln.cond;
  s.startFlood();
  check(kiln.cond <= before - 40, `洪水使陶窑受损（坚固 ${Math.round(before)} → ${Math.round(kiln.cond)}）`);
  check(w.flooded.some(v => v), '地图上有被淹的格子（供画面显示）');
  run(s, 1.2);
  check(!s.flood && !w.flooded.some(v => v), '一个月后洪水退去');
  const { w: w2, s: s2 } = fresh();
  s2.apply('road', road); s2.apply('kiln', [[33, 25]]);
  const k2 = B(w2, 'kiln')[0];
  const bank = [];
  for (let j = 22; j <= 29; j++) for (let i = 30; i <= 38; i++) if (w2.canPlace('levee', i, j).ok && w2.type[w2.idx(i + 1, j)] === 1) { bank.push([i, j]); break; }
  s2.apply('levee', bank);
  check(!w2.inFloodZone(k2), `沿河修 ${B(w2, 'levee').length} 段堤后，陶窑不在汛险区`);
  const c2 = k2.cond; s2.startFlood();
  check(k2.cond === c2, '有堤保护的陶窑没有受损');
}
// 6. 汛期预告
{
  const { s } = fresh();
  let warned = false; s.on('floodWarn', () => { warned = true; });
  s.t = 12 * 2 + 2.9; // 第三年三月底
  for (let k = 0; k < 6 && !warned; k++) { s.floodComing = null; s.t = 12 * (2 + k) + 2.99; s.update(0.5); }
  check(warned && s.floodComing, '四月发布汛期预告，并排定六月汛期');
}
// 7. 商队：出口与进口
{
  const { w, s } = fresh();
  s.apply('road', [[27, 24], [28, 24]]);
  s.apply('warehouse', [[22, 25]]);
  s.apply('tradepost', [[3, 22]]);
  run(s, 2);
  const wh = B(w, 'warehouse')[0];
  wh.goods.pottery = 200;
  s.trade.pottery = { mode: 'export', keep: 50 };
  s.trade.silk = { mode: 'import', keep: 40 };
  const money0 = s.money;
  s.nextCaravan = Math.floor(s.t) + 1;
  let traded = false; s.on('msg', m => { if (m.text.startsWith('商队成交')) traded = true; });
  let n = 0; while (!s.walkers.some(x => x.kind === 'caravan') && n++ < 400) s.update(0.1);
  check(s.walkers.some(x => x.kind === 'caravan'), '商队从西边官道出发前往商栈');
  wh.goods.pottery = 300; // 集市挑夫也会来取货：商队到前补足库存
  run(s, 2);
  check(traded && s.record.trades >= 1, `商队成交（${s.record.trades} 次）`);
  check(Math.round(wh.goods.pottery) === 300 - 80, `每队最多收 80 件陶器：300 → ${Math.round(wh.goods.pottery)}`);
  check(s.record.tradeIncome === 80 * 4 && s.record.tradeCost === 40 * 13, `出口收入 ${s.record.tradeIncome} 文（80×4），进口花费 ${s.record.tradeCost} 文（40×13）`);
  run(s, 3);
  const tp = B(w, "tradepost")[0];
  const onRoad = s.walkers.reduce((n, x) => n + (x.good === 'silk' ? x.carry : 0) + (x.load?.silk || 0), 0);
  check(tp.out.silk < 1 && s.stockOf('silk') + onRoad >= 30, `进口的丝绸已运出商栈：货栈与集市 ${s.stockOf('silk')}，货郎担上 ${Math.round(onRoad)}`);
  void money0;
}
// 8. 关卡失败条件
{
  const { s } = fresh();
  let lost = null; s.on('defeat', d => { lost = d.reason; });
  s.money = -5000;
  for (let m = 0; m < 6 && !lost; m++) run(s, 1);
  check(lost && lost.includes('亏空'), `国库连续亏空被革职：「${lost}」`);
  const { s: s2 } = fresh();
  let lost2 = null; s2.on('defeat', d => { lost2 = d.reason; });
  s2.t = s2.deadlineT - 0.05; run(s2, 0.2);
  check(lost2 && lost2.includes('期限'), `超过期限失败：「${lost2}」`);
}
// 9. 存档：废墟、商队设定、记录都能恢复
{
  const { w, s } = fresh();
  const h = B(w, 'house')[0]; s.destroy(h, 'burnt');
  s.trade.silk = { mode: 'export', keep: 33 };
  const data = JSON.parse(JSON.stringify(s.serialize()));
  const w2 = new World(), s2 = new Sim(w2); s2.restore(data);
  check(B(w2, 'ruin').length === 1 && s2.trade.silk.keep === 33 && s2.record.burnt === 1, '存档后读档：废墟、商队设定、灾害记录都在');
}
console.log(`\n${pass} 项通过，${fail} 项未通过`);
process.exitCode = fail ? 1 : 0;
