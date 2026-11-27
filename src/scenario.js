// 关卡开局：送一座小村落（游戏与自动玩家共用）
export function seedStarter(sim) {
  const money = sim.money;
  const roads = [];
  for (let i = 20; i <= 26; i++) roads.push([i, 24]);
  for (let j = 19; j <= 30; j++) if (j !== 24) roads.push([14, j]);
  sim.apply('road', roads);
  const lots = [];
  for (let i = 7; i <= 12; i++) { lots.push([i, 23]); lots.push([i, 25]); }
  sim.apply('house', lots);
  sim.apply('well', [[9, 22]]);
  sim.apply('well', [[10, 26]]);
  sim.apply('farm', [[15, 21]]);
  sim.apply('granary', [[15, 25]]);
  sim.apply('market', [[18, 25]]);
  sim.apply('garden', [[13, 22]]);
  sim.money = money;
}
