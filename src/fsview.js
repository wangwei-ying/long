// 风水预览：放下一座建筑之前，算出它对周边民居风水（形势 + 五行）的影响
import { BUILDINGS, FENGSHUI, WX, WX_OF, FACING_NAME, WX_REL_NAME, HOUSE_LEVELS } from './config.js';

export const FS_STEPS = [[2.5, 3, '宅院'], [3.5, 4, '府邸'], [4.5, 5, '大宅']];
export const fsReach = fs => fs >= 4.5 ? '大宅' : fs >= 3.5 ? '府邸' : fs >= 2.5 ? '宅院' : '瓦舍';

// 一户民居（或假想民居）的风水说明
export function describeWx(info) {
  const self = WX[info.self], face = FACING_NAME[info.facing];
  if (info.env < 0) return `${face}属${self}，周边五行不显`;
  const env = WX[info.env];
  const rel = { sheng: `${env}生${self}`, same: `同属${self}`, ke: `${env}克${self}`, xie: `${self}生${env}（泄）`, hao: `${self}克${env}（耗）` }[info.rel];
  return `${face}属${self}，周边属${env}，${rel}`;
}

export function fengshuiPreview(world, sim, type, i, j) {
  const def = BUILDINGS[type], size = def.size;
  const cx = i + size / 2, cy = j + size / 2;
  // 新宅地自身没有风水来源；园林、祠庙、作坊等才有
  const src = type === 'house' ? null : FENGSHUI[type];
  const cells = [];
  const formAt = (x, y) => {
    if (!src) return 0;
    const [s, r] = src, d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    return d > r + 0.5 ? 0 : s * (1 - d / (r + 1));
  };
  if (src) {
    const r = src[1];
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      if (!world.inside(x, y)) continue;
      const v = formAt(x, y);
      if (Math.abs(v) > 0.02) cells.push([world.idx(x, y), v]);
    }
  }
  const affected = [];
  if (src || WX_OF[type] != null) {
    const R = Math.max(src ? src[1] : 0, 3.5) + 1;
    for (const h of world.buildings.values()) {
      if (h.type !== 'house' || Math.hypot(h.i + 0.5 - cx, h.j + 0.5 - cy) > R) continue;
      const before = world.houseWuxing(h);
      const after = world.houseWuxing(h, world.wxExtraFor(type, i, j, size, h.i, h.j));
      const delta = formAt(h.i, h.j) + after.delta - before.delta;
      if (Math.abs(delta) < 0.05) continue;
      const fs = h.fs ?? (world.fengshui[world.idx(h.i, h.j)] + before.delta);
      const up = FS_STEPS.filter(([t, lv]) => h.level >= lv - 1 && fs < t && fs + delta >= t).map(s => s[2]);
      const down = FS_STEPS.filter(([t, lv]) => h.level >= lv && fs >= t && fs + delta < t).map(s => s[2]);
      affected.push({ h, delta, up, down, wxNote: after.rel !== before.rel ? describeWx(after) : null });
    }
  }
  // 提示文字
  const lines = [];
  if (type === 'house') {
    const k = world.idx(i, j);
    const wx = world.houseWuxing({ i, j, size: 1, type: 'house' });
    const fs = world.fengshui[k] + wx.delta;
    lines.push(`风水 ${fs.toFixed(1)}（形势 ${world.fengshui[k].toFixed(1)}，五行 ${wx.delta >= 0 ? '+' : ''}${wx.delta}）→ 风水够${fsReach(fs)}`);
    lines.push(describeWx(wx));
  } else if (affected.length) {
    const pos = affected.filter(a => a.delta > 0), neg = affected.filter(a => a.delta < 0);
    const rng = list => { const v = list.map(a => a.delta); const lo = Math.min(...v), hi = Math.max(...v); const f = x => `${x > 0 ? '+' : ''}${x.toFixed(1)}`; return lo === hi ? f(lo) : `${f(lo)}～${f(hi)}`; };
    if (pos.length) lines.push(`周边 ${pos.length} 户民居（含宅地）风水 ${rng(pos)}${pos.some(a => a.up.length) ? `，${pos.filter(a => a.up.length).length} 户因此够升级` : ''}`);
    if (neg.length) lines.push(`周边 ${neg.length} 户民居（含宅地）风水 ${rng(neg)}${neg.some(a => a.down.length) ? `，${neg.filter(a => a.down.length).length} 户会因此退级` : ''}`);
    const note = affected.find(a => a.wxNote);
    if (note) lines.push(`五行：属${WX[WX_OF[type]]}，使邻近民居变为「${note.wxNote}」`);
  } else if (src || WX_OF[type] != null) {
    lines.push(`影响半径内没有民居${WX_OF[type] != null ? `（此建筑五行属${WX[WX_OF[type]]}）` : ''}`);
  }
  void sim; void HOUSE_LEVELS; void WX_REL_NAME;
  return { cells, affected, lines, bad: affected.some(a => a.down.length) };
}
