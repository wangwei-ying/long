// 自动验收：让自动玩家从开局玩到结局（通关或失败），打印时间线与结算。
// 用法：node tools/autoplay.mjs [随机种子] [--quiet]
import { World } from '../src/world.js';
import { Sim } from '../src/sim.js';
import { Bot } from '../src/bot.js';
import { seedStarter } from '../src/scenario.js';
import { STAGES, HOUSE_LEVELS } from '../src/config.js';

const seed = Number(process.argv[2] || 1);
const quiet = process.argv.includes('--quiet');

// 可复现：替换 Math.random
let a = seed >>> 0;
Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const world = new World();
const sim = new Sim(world);
seedStarter(sim);
const timeline = [];
const note = (text) => timeline.push(`${sim.dateText().padEnd(9, '　')} ${text}`);
const botLog = [];
const bot = new Bot(sim, t => botLog.push(`${sim.dateText()} ${t}`));

let result = null;
sim.on('stage', st => note(`★ 阶段完成：${st.title}（${st.done}）`));
sim.on('victory', sum => { result = { ok: true, ...sum }; note('★★ 通关：' + STAGES[STAGES.length - 1].done); });
sim.on('defeat', sum => { result = { ok: false, ...sum }; note('✗ 失败：' + sum.reason); });
const KEEP = /起火|扑灭|烧成|倒塌|冲毁|汛期|洪水|河水上涨|商队成交|商队来了|亏空|升为府邸|升为大宅|目标达成/;
sim.on('msg', m => { if (KEEP.test(m.text)) note(m.text); });

const DT = 0.1;                 // 每步 0.1 游戏秒
const MONTH = 20;               // 一月 = 20 秒
const maxMonths = 16 * 12;
let lastReport = -1;
const t0 = Date.now();
for (let step = 0; !result && sim.t < 2 + maxMonths; step++) {
  sim.update(DT);
  if (step % Math.round(MONTH / 2 / DT) === 0) bot.step();
  const m = Math.floor(sim.t);
  if (!quiet && m % 6 === 0 && m !== lastReport) {
    lastReport = m;
    const lv = [1, 2, 3, 4, 5].map(l => sim.countHouses(l) - sim.countHouses(l + 1));
    const A = sim.avgStats(3);
    console.log(`${sim.dateText().padEnd(9, '　')} 人口 ${String(sim.population).padStart(4)} 钱 ${String(Math.round(sim.money)).padStart(6)} 阶段 ${sim.stage + 1}/${STAGES.length} 民居[茅瓦院府宅] ${lv.join('/')} 劳力 ${sim.employed}/${sim.demand} 粮 产${Math.round(A.prod.food)}耗${Math.round(A.cons.food)} 陶${Math.round(A.prod.pottery)} 丝${Math.round(A.prod.silk)} 建筑 ${world.buildings.size}`);
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log('\n——— 关键事件 ———');
for (const t of timeline) console.log(t);
if (!quiet) { console.log('\n——— 自动玩家最后 15 条操作 ———'); for (const t of botLog.slice(-15)) console.log(t); }
const r = sim.record;
console.log('\n——— 结算 ———');
console.log(`结果：${result ? (result.ok ? '通关' : '失败：' + result.reason) : '未分胜负（超出模拟时长）'}`);
console.log(`日期 ${sim.dateText()}  用时 ${((sim.t - 2) / 12).toFixed(1)} 年  人口 ${sim.population}（最高 ${r.maxPop}）  铜钱 ${Math.round(sim.money)}`);
console.log(`民居：${HOUSE_LEVELS.slice(1).map((L, i) => `${L.name} ${sim.countHouses(i + 1) - sim.countHouses(i + 2)}`).join('、')}`);
console.log(`火灾 ${r.fires} 起，扑灭 ${r.firesOut}，烧毁 ${r.burnt}；倒塌 ${r.collapses}；汛期 ${r.floods} 次，受淹 ${r.floodHits} 座；商队成交 ${r.trades} 次（收入 ${r.tradeIncome}，支出 ${r.tradeCost}）`);
if (!result?.ok && sim.stage < STAGES.length) console.log(`卡在「${STAGES[sim.stage].title}」：` + STAGES[sim.stage].goals.map(g => `${g.text} ${sim.goalsDone.has(g.id) ? '✓' : '✗ ' + g.progress(sim)}`).join('；'));
console.log(`商栈 ${[...world.buildings.values()].filter(b => b.type === 'tradepost').map(b => `${b.i},${b.j} 在岗${b.staff}/${b.need} ${b.status}`).join(' | ') || '无'}；商队设定 ${JSON.stringify(sim.trade)}；货栈 陶${sim.storageStock('pottery')} 丝${sim.storageStock('silk')} 粮${Math.round(sim.storageStock('food'))}`);
console.log(`丝坊 ${[...world.buildings.values()].filter(b => b.type === "silk" || b.type === "mulberry" || b.type === "warehouse").map(b => `${b.type}@${b.i},${b.j} ${b.staff}/${b.need} ${b.status} ${b.icon || ""}`).join(" | ")}`);
console.log(`自动玩家操作 ${botLog.length} 次，模拟耗时 ${secs} 秒`);
process.exitCode = result && result.ok ? 0 : 1;
