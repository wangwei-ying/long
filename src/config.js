// 游戏数据定义：地图、建筑、民居等级、风水来源
export const N = 48;              // 可建造区域边长（格）
export const MARGIN = 18;         // 地图外围装饰地形宽度
export const WATER_Y = -0.22;     // 水面高度
export const MONTH_SECONDS = 20;  // 1 倍速下一个月的现实秒数
export const DAY_SECONDS = 150;   // 昼夜循环一圈的现实秒数（1 倍速）
export const START_MONEY = 3000;

export const T_GRASS = 0, T_WATER = 1, T_MOUNTAIN = 2;

export const BUILDINGS = {
  select:  { name: '查看', glyph: '览', cost: 0, size: 1, key: '`',
             desc: '点击建筑查看详情。右键拖动平移，滚轮缩放，Q / E 旋转。' },
  road:    { name: '道路', glyph: '路', cost: 4, size: 1, key: '1', drag: 'line',
             desc: '按住拖动铺路。步行者只沿道路行走，道路须与西侧官道相连。' },
  house:   { name: '民居', glyph: '宅', cost: 12, size: 1, key: '2', drag: 'area',
             desc: '划出宅地，须在道路两格内。移民入住成茅屋 →（水、粮）瓦舍 →（祭祀、风水 2.5）宅院 →（陶器、茶楼、风水 3.5）府邸 →（丝绸、风水 4.5）大宅。宅子朝向道路，坐向决定它的五行。' },
  well:    { name: '水井', glyph: '井', cost: 30, size: 1, key: '3', radius: 3,
             desc: '为半径 3 格内的民居供水。紧邻河流的民居也能取水。' },
  farm:    { name: '农田', glyph: '田', cost: 60, size: 3, key: '4', workers: 6,
             desc: '种植粟米，约两个半月收获一次，由推车送往粮仓。须临路。' },
  granary: { name: '粮仓', glyph: '仓', cost: 120, size: 2, key: '5', workers: 5, capacity: 800,
             desc: '储存粮食，供集市挑夫来取。须临路。' },
  market:  { name: '集市', glyph: '市', cost: 80, size: 2, key: '6', workers: 4,
             desc: '挑夫从粮仓取粮、从货栈取货，货郎沿街卖给两格内的民居。' },
  mulberry: { name: '桑园', glyph: '桑', cost: 50, size: 2, workers: 4,
             desc: '种桑养蚕，约三个月收一批蚕茧，由推车送往丝坊。须临路。' },
  silk:    { name: '丝坊', glyph: '丝', cost: 110, size: 2, workers: 6,
             desc: '把蚕茧缫丝织成丝绸，攒够一车送往货栈。' },
  kiln:    { name: '陶窑', glyph: '窑', cost: 90, size: 2, workers: 5, nearWater: 4,
             desc: '取河泥烧制陶器，送往货栈。须建在河边四格内。烟火会降低周边风水。' },
  warehouse: { name: '货栈', glyph: '栈', cost: 100, size: 2, workers: 4, capacity: 400,
             desc: '存放陶器与丝绸，供集市挑夫来取。' },
  teahouse: { name: '茶楼', glyph: '茶', cost: 120, size: 2, workers: 4,
             desc: '说书人沿街巡游，为两格内的民居带来娱乐，也让街坊更体面。' },
  tradepost: { name: '商栈', glyph: '商', cost: 150, size: 2, workers: 3,
             desc: '商队每三个月经西边官道来一次，按「商队」面板的设定买卖货物。' },
  firehouse: { name: '水龙局', glyph: '龙', cost: 60, size: 1, workers: 3,
             desc: '巡更人沿街清除两格内的火险；哪里起火，水龙队就沿路赶去扑救。' },
  repair:  { name: '营缮所', glyph: '缮', cost: 60, size: 1, workers: 3,
             desc: '匠人沿街修缮两格内的房屋，防止年久失修倒塌。' },
  levee:   { name: '河堤', glyph: '堤', cost: 30, size: 1, nearWater: 1, drag: 'line',
             desc: '筑在河岸边（一格内），汛期保护周围三格不被淹。可拖动连续修筑。' },
  ruin:    { name: '废墟', glyph: '墟', cost: 0, size: 1, desc: '火烧、水淹或年久倒塌留下的废墟，用「拆除」清理。' },
  temple:  { name: '祠庙', glyph: '庙', cost: 150, size: 2, key: '7', workers: 3,
             desc: '祭司沿街巡游，满足两格内百姓的信仰，也能改善周边风水。' },
  garden:  { name: '园林', glyph: '园', cost: 25, size: 1, key: '8',
             desc: '亭台小池，显著提升周边风水。' },
  clear:   { name: '拆除', glyph: '拆', cost: 2, size: 1, key: '9', drag: 'area',
             desc: '拖动框选，拆除建筑、道路或伐树。官道不可拆。' },
};
export const TOOL_ORDER = ['select', 'road', 'house', 'well', 'farm', 'granary', 'market', 'temple', 'garden', 'clear',
  'mulberry', 'silk', 'kiln', 'warehouse', 'teahouse', 'tradepost', 'firehouse', 'repair', 'levee'];
// 工具栏分组（分隔线位置）
export const TOOL_GROUPS = [['select', 'road', 'clear'], ['house', 'well', 'garden'], ['farm', 'granary', 'market', 'tradepost'], ['mulberry', 'silk', 'kiln', 'warehouse'], ['temple', 'teahouse'], ['firehouse', 'repair', 'levee']];

export const HOUSE_LEVELS = [
  { name: '宅地', cap: 0, tax: 0 },
  { name: '茅屋', cap: 6, tax: 0.15 },
  { name: '瓦舍', cap: 12, tax: 0.3 },
  { name: '宅院', cap: 20, tax: 0.5 },
  { name: '府邸', cap: 28, tax: 0.75 },
  { name: '大宅', cap: 36, tax: 1.1 },
];
export const FENGSHUI_L4 = 3.5, FENGSHUI_L5 = 4.5;
// 各级民居出工比例：寒门出工多，富户出工少
export const WORK_SHARE = [0, 0.5, 0.5, 0.42, 0.3, 0.2];
// 劳力分配优先级（数字小的先分到人）
export const LABOR_PRIORITY = { farm: 0, granary: 0, firehouse: 1, market: 1, repair: 2, mulberry: 2, silk: 2, kiln: 2, warehouse: 2, tradepost: 2, temple: 3, teahouse: 3 };

// ---------- 灾害 ----------
// 火险：每月增长的点数（满 100 起火）；民居按等级
export const FIRE_RATE = { house: [0, 4.5, 3.5, 2.5, 2, 1.8], kiln: 10, silk: 4, teahouse: 4, granary: 3, warehouse: 3, market: 3.5, temple: 3, tradepost: 3, farm: 0, mulberry: 0 };
export const BURN_MONTHS = 1.5;       // 无人扑救时烧成废墟的时间
export const SPREAD_PER_MONTH = 0.4;  // 每月蔓延到邻居的概率
// 年久失修：每月坚固度下降
export const DECAY_RATE = { house: 1.4, farm: 0.8, mulberry: 0.8, kiln: 2.6, default: 1.6 };
export const FLOOD = { fromYear: 2, chance: 0.6, warnMonth: 3, month: 5, reach: 3, damage: 45, leveeRadius: 3 };

// ---------- 商队 ----------
export const TRADE = {
  every: 3,  // 每几个月来一次
  cap: { food: 240, pottery: 80, silk: 80, cocoon: 120 },
  sell: { food: 0.8, pottery: 4, silk: 8, cocoon: 1.5 },   // 出口每单位得钱
  buy: { food: 1.4, pottery: 7, silk: 13, cocoon: 2.5 },   // 进口每单位花钱
};

// ---------- 关卡 ----------
export const DEADLINE_YEARS = 12;     // 第十五年腊月前完成
export const DEBT_LIMIT = -1000, DEBT_MONTHS = 4;
export const WAGE = 2;      // 每名在岗工人每月工钱
export const UPKEEP = 0.04;  // 建筑每月维护费 = 造价 × 比例
export const PRICE = { food: 0.4, pottery: 3, silk: 6 }; // 货郎每卖出一单位，城中所得市税

export const FUN_MONTHS = 8;
export const GOODS_PER_POP = { pottery: 0.05, silk: 0.04 }; // 每人每月消耗
export const MULBERRY_MONTHS = 3, MULBERRY_YIELD = 60;   // 蚕茧
export const SILK_BATCH = 20, SILK_MONTHS = 1;           // 20 蚕茧 → 12 丝绸
export const KILN_MONTHS = 1.5, KILN_YIELD = 20;
export const LOT_IMMIGRANTS = 6;  // 空宅地可迎入的人数
export const FOOD_PER_POP = 0.35; // 每人每月耗粮
export const FARM_MONTHS = 2.5;
export const FARM_YIELD = 160;
export const FAITH_MONTHS = 8;    // 祭司经过后信仰维持的月数
export const FENGSHUI_L3 = 2.5;

// 风水来源：[强度, 半径]。山水取最大值，其余叠加
// ---------- 五行 ----------
// 0 木 1 火 2 土 3 金 4 水。生：木→火→土→金→水→木；克：木克土、火克金、土克水、金克木、水克火
export const WX = ['木', '火', '土', '金', '水'];
export const WX_COLOR = ['#3f8f5a', '#c8402e', '#d4a83a', '#e6e2d6', '#24324a'];
export const WX_SHENG = [1, 2, 3, 4, 0];
export const WX_KE = [2, 3, 4, 0, 1];
export const WX_OF = { garden: 0, farm: 0, mulberry: 0, silk: 0, kiln: 1, teahouse: 1, temple: 1, granary: 2, levee: 2, repair: 2, ruin: 2, market: 3, warehouse: 3, tradepost: 3, well: 4, firehouse: 4 };
// 民居按朝向定五行：朝南属火、朝东属木、朝西属金、朝北属水
export const FACING_WX = { S: 1, E: 0, W: 3, N: 4 };
export const FACING_NAME = { S: '朝南', E: '朝东', W: '朝西', N: '朝北' };
// 周边五行对民居风水的加减
export const WX_EFFECT = { sheng: 1.0, same: 0.5, xie: -0.3, hao: -0.3, ke: -1.0 };
export const WX_REL_NAME = { sheng: '生', same: '比和', xie: '泄', hao: '耗', ke: '克' };

export const FENGSHUI = {
  water: [3, 4], mountain: [2.5, 6], tree: [0.6, 2],
  garden: [3, 3], temple: [2, 4], house3: [0.6, 2],
  farm: [-1.2, 2], granary: [-2.5, 3], market: [-1, 2], road: [-0.25, 1],
  house4: [1, 2], house5: [1.5, 3], teahouse: [1.5, 3], kiln: [-2.5, 3], warehouse: [-1.5, 2], silk: [-0.5, 1], mulberry: [0.4, 2],
};

export const MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];

// 关卡：三个阶段，完成后出现下一阶段；全部完成即通关
export const STAGES = [
  { title: '营城之志', done: '城池初成', doneText: '河谷里已有一百五十余口人家，宅院林立，祠庙香火不断。下一步：烧陶、养蚕、织绸，让城里兴起百业。',
    hint: '先多开一块田；民居缺水就打井；修祠庙，在宅子旁种园林提升风水。',
    goals: [
      { id: 'pop', text: '人口达到 150', check: s => s.population >= 150, progress: s => `${s.population}/150` },
      { id: 'l3', text: '3 座民居升为宅院', level: 3, check: s => s.countHouses(3) >= 3, progress: s => `${s.countHouses(3)}/3` },
      { id: 'temple', text: '修建祠庙', check: s => s.countType('temple') >= 1, progress: s => `${s.countType('temple')}/1` },
    ] },
  { title: '兴业之志', done: '百业兴旺', doneText: '窑火不熄，机杼声声，水龙局与营缮所守着全城。最后一步：让城池繁华，与远方商队往来。',
    hint: '河边建陶窑，配货栈；桑园 → 丝坊。茶楼让宅院升府邸。建水龙局防火、营缮所修房。',
    goals: [
      { id: 'pottery', text: '陶器月产 ≥ 25', check: s => s.avgStats(3).prod.pottery >= 25, progress: s => `${Math.round(s.avgStats(3).prod.pottery)}/25` },
      { id: 'silkp', text: '丝绸月产 ≥ 16', check: s => s.avgStats(3).prod.silk >= 16, progress: s => `${Math.round(s.avgStats(3).prod.silk)}/16` },
      { id: 'l4', text: '6 座民居升为府邸', level: 4, check: s => s.countHouses(4) >= 6, progress: s => `${s.countHouses(4)}/6` },
      { id: 'safety', text: '修建水龙局与营缮所', check: s => s.countType('firehouse') >= 1 && s.countType('repair') >= 1, progress: s => `${Math.min(1, s.countType('firehouse')) + Math.min(1, s.countType('repair'))}/2` },
    ] },
  { title: '繁华之志', done: '郡城繁华', doneText: '陶器丝绸流通四方，大宅门前车马往来，商队岁岁不绝。这座河谷新城已是一方繁华之地。',
    hint: '多建民居补人口与劳力；丝绸供上大宅；建商栈，在「商队」里把多余的货卖出去。',
    goals: [
      { id: 'pop3', text: '人口达到 600', check: s => s.population >= 600, progress: s => `${s.population}/600` },
      { id: 'l5', text: '5 座民居升为大宅', level: 5, check: s => s.countHouses(5) >= 5, progress: s => `${s.countHouses(5)}/5` },
      { id: 'trade', text: '商队贸易收入 1500 文', check: s => s.record.tradeIncome >= 1500, progress: s => `${Math.min(1500, s.record.tradeIncome)}/1500` },
      { id: 'gold', text: '铜钱积累到 10000', check: s => s.money >= 10000, progress: s => `${Math.floor(s.money)}/10000` },
    ] },
];
