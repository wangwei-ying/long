// 程序化建模：民居三级、水井、农田、粮仓、集市、祠庙、园林、步行者
import * as THREE from 'three';
import { applyDetail as D } from './materials.js';
import { rectRoof, polyRoof, mergeGeos, tubeGeo } from './roofs.js';
import { foliageSprite } from './trees.js';

const geoCache = new Map();
const cached = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };

const std = (color, r = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: 0, ...extra });
export const glowMats = [];
const glow = (color, emissive) => {
  const m = std(color, 0.6, { emissive, emissiveIntensity: 0 });
  glowMats.push(m);
  return m;
};

export const M = {
  earth: D(std(0xb08a5f), 'earth'), plaster: D(std(0xece5d5), 'plaster'), plinth: D(std(0x8c877d), 'stone'), stone: D(std(0xaaa597), 'stone'),
  timber: D(std(0x9a3325, 0.6), 'timber'), wood: D(std(0x765239), 'wood'), thatch: D(std(0xbb9858, 1), 'thatch'), tile: D(std(0x535a62, 0.75), 'tile'),
  ridge: std(0x363b41, 0.7), glazeY: D(std(0xd8a535, 0.45), 'glaze'), glazeG: D(std(0x2f735f, 0.5), 'glaze'), bronze: std(0x6d5a3a, 0.4, { metalness: 0.6 }),
  door: D(std(0x5a2a1c), 'wood'), paving: D(std(0xa9a396, 0.95), 'paving'), dirt: std(0x8b7254, 1), pond: std(0x3f7f8c, 0.15),
  painted: D(std(0xffffff, 0.7), 'painted'), ridgeGold: std(0xb8862c, 0.45),
  celadon: std(0x8db5a2, 0.3), terracotta: D(std(0xa3653f, 0.75), 'earth'), soot: std(0x1e1a17, 1), cocoon: std(0xf1ece0, 0.8), lionStone: D(std(0xb9b3a4, 0.9), 'plaster'),
  leaf: std(0x4f7a35), leafDark: std(0x2f5530), bamboo: std(0x6f9a45), straw: std(0xcaa866),
  skin: std(0xe0b48a), crop: std(0x5d8a3a, 0.9),
  clothRed: std(0xa8382b), clothBlue: std(0x3d5f86), clothOchre: std(0xc08a3a), clothGreen: std(0x4d7a55),
  window: D(glow(0x6b5a3a, 0xffc46b), 'lattice'), lantern: glow(0xb2302a, 0xff5a2a),
};

function boxGeo(w, h, d) { return cached(`b${w},${h},${d}`, () => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; }); }
function cylGeo(rt, rb, h, s) { const n = Math.min(16, Math.max(s, 12)); return cached(`c${rt},${rb},${h},${n}`, () => { const g = new THREE.CylinderGeometry(rt, rb, h, n); g.translate(0, h / 2, 0); return g; }); }
function coneGeo(r, h, s) { const n = s <= 4 ? s : Math.min(16, Math.max(s, 12)); return cached(`k${r},${h},${n}`, () => { const g = new THREE.ConeGeometry(r, h, n); g.translate(0, h / 2, 0); return g; }); }
function sphGeo(r) { return cached(`s${r}`, () => new THREE.SphereGeometry(r, 14, 10)); }
// 太湖石：噪声起伏的光滑曲面
function rockGeo(r, seed = 1) {
  return cached(`rock${r},${seed}`, () => {
    const g = new THREE.SphereGeometry(r, 20, 14), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      const d = 1 + 0.22 * Math.sin(n.x * 5 + seed) * Math.cos(n.y * 4 - seed) + 0.12 * Math.sin(n.z * 9 + n.y * 7 + seed * 2) - 0.18 * Math.max(0, Math.sin(n.x * 11 + n.z * 6));
      v.multiplyScalar(d);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  });
}

function add(g, geo, mat, x = 0, y = 0, z = 0, ry = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  g.add(m);
  return m;
}
const box = (g, w, h, d, mat, x, y, z, ry) => add(g, boxGeo(w, h, d), mat, x, y, z, ry);
const cyl = (g, rt, rb, h, s, mat, x, y, z) => add(g, cylGeo(rt, rb, h, s), mat, x, y, z);

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 屋顶：见 roofs.js。几何体按参数缓存，所有同款屋顶共享
const ORN = {
  chiwen: [[-0.012, 0], [0.004, 0.03], [0.01, 0.065], [-0.004, 0.096], [-0.03, 0.104], [-0.048, 0.088], [-0.046, 0.07]],
  flick: [[-0.01, 0], [0.02, 0.006], [0.045, 0.02], [0.064, 0.045], [0.074, 0.075], [0.07, 0.09]],
};
function ornamentGeo(kind, s) {
  return cached(`orn${kind}${s}`, () => {
    const pts = ORN[kind].map(([u, v]) => new THREE.Vector3(u * s, v * s, 0));
    return tubeGeo(pts, (kind === 'chiwen' ? 0.034 : 0.026) * s, (kind === 'chiwen' ? 0.03 : 0.02) * s);
  });
}
function roofData(o) {
  return cached('R' + JSON.stringify(o), () => {
    const d = o.n ? polyRoof(o) : rectRoof(o);
    d.ridgeGeo = d.ridges.length ? mergeGeos(d.ridges) : null;
    return d;
  });
}
function roof(g, L, S, rise, mat, gableMat, x, y, z, opts = {}) {
  const { ry = 0, ridgeMat = M.ridge, ornament, ridge = true, ornScale = 1, ...geo } = { type: 'gable', over: 0.08, thick: 0.035, lift: 0.03, p: 1.7, ...opts };
  const d = roofData({ L, S, rise, ...geo });
  const r = new THREE.Group();
  add(r, d.shell, mat);
  if (gableMat && d.fill) add(r, d.fill, gableMat);
  if (ridge) {
    if (d.ridgeGeo) add(r, d.ridgeGeo, ridgeMat);
    const orn = ornament ?? (geo.type === 'gable' ? 'flick' : 'chiwen');
    if (orn !== 'none') for (const e of d.ends) {
      const m = add(r, ornamentGeo(orn, ornScale), ridgeMat, e.x, e.y, e.z);
      if (e.x < 0) m.rotation.y = Math.PI;
    }
    for (const t of d.tips) add(r, sphGeo(0.016 * ornScale), M.ridge, t.x, t.y, t.z);
    for (const b of d.beasts) {
      add(r, boxGeo(0.018, 0.018, 0.024), ridgeMat, b.x, b.y, b.z);
      add(r, sphGeo(0.011), ridgeMat, b.x, b.y + 0.024, b.z);
    }
  }
  r.position.set(x, y, z);
  r.rotation.y = ry;
  g.add(r);
  return r;
}
function pavilionRoof(g, n, R, rise, mat, x, y, z, opts = {}) {
  const d = roofData({ n, R, rise, thick: 0.02, p: 1.5, corner: 0.07, flare: 0.04, tipLen: 0.035, rot: Math.PI / n, ...opts });
  const r = new THREE.Group();
  add(r, d.shell, mat);
  if (d.ridgeGeo) add(r, d.ridgeGeo, M.ridge);
  add(r, cylGeo(0.012, 0.02, 0.04, 16), M.glazeY, 0, rise - 0.01, 0);
  add(r, sphGeo(0.022), M.glazeY, 0, rise + 0.05, 0);
  r.position.set(x, y, z);
  g.add(r);
  return r;
}

// 斗拱 + 彩画额枋：沿 X 方向一排，挂在檐下
function brackets(g, L, y, z, n) {
  box(g, L, 0.045, 0.03, M.painted, 0, y - 0.05, z);
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + (k + 0.5) * (L / n);
    box(g, 0.04, 0.03, 0.05, M.timber, x, y - 0.005, z + 0.01);
    box(g, 0.075, 0.018, 0.035, M.painted, x, y + 0.022, z + 0.02);
    box(g, 0.035, 0.02, 0.07, M.timber, x, y + 0.04, z + 0.025);
  }
}
function lanternPair(g, x0, x1, y, z) {
  for (const x of [x0, x1]) {
    box(g, 0.006, 0.05, 0.006, M.wood, x, y + 0.07, z);
    cyl(g, 0.035, 0.035, 0.07, 10, M.lantern, x, y, z);
  }
}
function balustrade(g, w, d, y, x0 = 0, z0 = 0, gap = 0) {
  const post = (x, z) => box(g, 0.025, 0.08, 0.025, M.stone, x0 + x, y, z0 + z);
  const rail = (len, x, z, ry) => box(g, len, 0.015, 0.018, M.stone, x0 + x, y + 0.055, z0 + z, ry);
  for (let k = 0; k <= Math.round(w / 0.2); k++) { const x = -w / 2 + k * (w / Math.round(w / 0.2)); post(x, -d / 2); if (Math.abs(x) > gap / 2 + 0.01) post(x, d / 2); }
  for (let k = 1; k < Math.round(d / 0.2); k++) { const z = -d / 2 + k * (d / Math.round(d / 0.2)); post(-w / 2, z); post(w / 2, z); }
  rail(w, 0, -d / 2, 0); rail(d, -w / 2, 0, Math.PI / 2); rail(d, w / 2, 0, Math.PI / 2);
  const side = (w - gap) / 2;
  rail(side, -w / 2 + side / 2, d / 2, 0); rail(side, w / 2 - side / 2, d / 2, 0);
}
function stoneLion(g, x, y, z) {
  box(g, 0.08, 0.05, 0.1, M.stone, x, y, z);
  const body = add(g, sphGeo(0.045, 1), M.lionStone, x, y + 0.085, z - 0.01); body.scale.set(1, 1.15, 1.2);
  add(g, sphGeo(0.035, 1), M.lionStone, x, y + 0.15, z + 0.02);
}

// ---------- 货堆与工位 ----------
// 货堆：一组小件，渲染器按库存数量决定显示几件
function pile(g, key, items) { const list = ((g.userData.piles ||= {})[key] ||= []); for (const m of items) { m.visible = false; list.push(m); } }
const SILK_COLS = () => [M.clothRed, M.clothBlue, M.clothOchre, M.clothGreen];
const ITEM = {
  food: (g, x, y, z, k = 0) => { const m = add(g, sphGeo(0.06), M.straw, x, y + 0.045, z); m.scale.set(1, 0.75, 0.85); m.rotation.y = k * 0.7; return m; },
  pottery: (g, x, y, z, k = 0) => add(g, latheGeo('vase', VASE), k % 3 ? M.terracotta : M.celadon, x, y, z),
  silk: (g, x, y, z, k = 0) => { const m = box(g, 0.13, 0.03, 0.075, SILK_COLS()[k % 4], x, y, z); m.rotation.y = (k % 2) * 0.12; return m; },
  cocoon: (g, x, y, z) => {
    const b = new THREE.Group();
    add(b, latheGeo('basket', [[0.0, 0], [0.03, 0.0], [0.042, 0.02], [0.045, 0.045], [0.04, 0.047], [0.036, 0.022], [0.0, 0.01]]), M.straw, 0, 0, 0);
    const c = add(b, sphGeo(0.04), M.cocoon, 0, 0.04, 0); c.scale.set(1, 0.45, 1);
    b.position.set(x, y, z); g.add(b); return b;
  },
  sheaf: (g, x, y, z) => { const m = add(g, cylGeo(0.035, 0.05, 0.16, 16), M.straw, x, y, z); m.rotation.z = 0.08; return m; },
  grain: (g, x, y, z) => {
    const b = new THREE.Group();
    add(b, latheGeo('basket', [[0.0, 0], [0.03, 0.0], [0.042, 0.02], [0.045, 0.045], [0.04, 0.047], [0.036, 0.022], [0.0, 0.01]]), M.straw, 0, 0, 0);
    const c = add(b, sphGeo(0.04), M.clothOchre, 0, 0.04, 0); c.scale.set(1, 0.4, 1);
    b.position.set(x, y, z); g.add(b); return b;
  },
};
// 一排排摆放：n 件，cols 列，间距 dx/dz，叠层高 dy（每 layer 件换一层）
function lay(g, key, kind, n, x0, y0, z0, cols, dx, dz, layer = 99, dy = 0.06) {
  const items = [];
  for (let k = 0; k < n; k++) {
    const l = Math.floor(k / layer), kk = k % layer;
    items.push(ITEM[kind](g, x0 + (kk % cols) * dx + l * dx * 0.5, y0 + l * dy, z0 + Math.floor(kk / cols) * dz, k));
  }
  pile(g, key, items);
}
function spot(g, x, z, ry, act) { (g.userData.spots ||= []).push({ x, z, ry, act }); }

// 合批：把一座建筑里不会变的零件按材质合成少数几个网格，大幅减少绘制调用
function mergeStatic(root, exclude = new Set()) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map(), victims = [];
  const walk = o => {
    if (exclude.has(o)) return;
    if (o !== root && o.isMesh && !o.isInstancedMesh && !o.userData.sprite) {
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const geo = o.geometry.clone().applyMatrix4(m);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(geo);
      victims.push(o);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  for (const v of victims) v.parent.remove(v);
  for (const [mat, geos] of byMat) {
    const merged = mergeGeos(geos);
    for (const gg of geos) gg.dispose();
    root.add(new THREE.Mesh(merged, mat));
  }
}

function finish(g) {
  const keep = new Set();
  for (const list of Object.values(g.userData.piles || {})) for (const o of list) keep.add(o);
  for (const o of g.userData.activeOnly || []) keep.add(o);
  mergeStatic(g, keep);
  g.traverse(o => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } });
  // 货堆初始隐藏（traverse 不改 visible）
  return g;
}

// ---------- 民居 ----------
function makeLot() {
  const g = new THREE.Group();
  box(g, 0.8, 0.012, 0.8, M.dirt, 0, 0, 0);
  for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) box(g, 0.03, 0.12, 0.03, M.wood, x, 0, z);
  box(g, 0.025, 0.26, 0.025, M.wood, 0.22, 0, 0.3);
  box(g, 0.15, 0.08, 0.015, M.clothRed, 0.22, 0.17, 0.315);
  return finish(g);
}

function makeHut() {
  const g = new THREE.Group();
  box(g, 0.54, 0.3, 0.42, M.earth, 0, 0, -0.04);
  roof(g, 0.54, 0.42, 0.24, M.thatch, M.earth, 0, 0.3, -0.04, { over: 0.07, thick: 0.06, lift: 0, p: 1.05, ridge: false });
  box(g, 0.1, 0.18, 0.012, M.door, 0.06, 0, 0.17);
  box(g, 0.14, 0.06, 0.09, M.wood, -0.3, 0, 0.25);
  cyl(g, 0.045, 0.04, 0.08, 8, M.wood, 0.3, 0, 0.27);
  return finish(g);
}

function makeTileHouse() {
  const g = new THREE.Group();
  box(g, 0.68, 0.05, 0.54, M.plinth, 0, 0, -0.03);
  box(g, 0.6, 0.34, 0.44, M.plaster, 0, 0.05, -0.03);
  for (const [x, z] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.19], [0.3, 0.19]]) box(g, 0.04, 0.34, 0.04, M.timber, x, 0.05, z);
  box(g, 0.62, 0.035, 0.46, M.timber, 0, 0.36, -0.03);
  box(g, 0.6, 0.03, 0.012, M.painted, 0, 0.335, 0.198);
  roof(g, 0.6, 0.44, 0.22, M.tile, M.plaster, 0, 0.39, -0.03, { over: 0.1, lift: 0.03, corner: 0.05, flare: 0.03, sheng: 0.025, barge: true });
  box(g, 0.13, 0.22, 0.012, M.timber, 0, 0.05, 0.195);
  box(g, 0.1, 0.12, 0.014, M.window, 0, 0.12, 0.196);
  for (const x of [-0.18, 0.18]) { box(g, 0.13, 0.11, 0.012, M.window, x, 0.17, 0.195); box(g, 0.15, 0.015, 0.02, M.timber, x, 0.165, 0.2); }
  box(g, 0.2, 0.025, 0.08, M.stone, 0, 0, 0.27);
  cyl(g, 0.06, 0.05, 0.09, 10, M.bronze, 0.33, 0, 0.32);
  cyl(g, 0.035, 0.028, 0.05, 8, M.earth, -0.3, 0, 0.3);
  g.add(foliageSprite(0, 0.08, -0.3, 0.08, 0.3));
  return finish(g);
}

function makeCourtyard() {
  const g = new THREE.Group();
  box(g, 0.94, 0.012, 0.94, M.paving, 0, 0, 0);
  const wallH = 0.2, t = 0.05, e = 0.445;
  const wall = (w, d, x, z) => { box(g, w, wallH, d, M.plaster, x, 0, z); box(g, w + 0.03, 0.03, d + 0.03, M.tile, x, wallH, z); };
  wall(0.94, t, 0, -e); wall(t, 0.94, -e, 0); wall(t, 0.94, e, 0);
  wall(0.36, t, -0.29, e); wall(0.36, t, 0.29, e);
  for (const x of [-0.11, 0.11]) box(g, 0.035, 0.26, 0.035, M.timber, x, 0, e);
  roof(g, 0.26, 0.1, 0.07, M.tile, null, 0, 0.26, e, { over: 0.05, thick: 0.022, lift: 0.015, corner: 0.035, flare: 0.02, ridgeW: 0.025, ridgeH: 0.03, ornScale: 0.5 });
  // 正房
  box(g, 0.72, 0.05, 0.36, M.plinth, 0, 0, -0.22);
  box(g, 0.64, 0.3, 0.28, M.plaster, 0, 0.05, -0.24);
  for (const x of [-0.32, -0.11, 0.11, 0.32]) box(g, 0.035, 0.3, 0.035, M.timber, x, 0.05, -0.09);
  brackets(g, 0.64, 0.305, -0.1, 6);
  roof(g, 0.66, 0.32, 0.2, M.tile, M.plaster, 0, 0.37, -0.22, { over: 0.1, lift: 0.03, corner: 0.07, flare: 0.04, sheng: 0.03, barge: true });
  for (const x of [-0.055, 0.055]) box(g, 0.1, 0.22, 0.012, M.window, x, 0.05, -0.095);
  for (const x of [-0.22, 0.22]) box(g, 0.14, 0.12, 0.012, M.window, x, 0.14, -0.095);
  lanternPair(g, -0.09, 0.09, 0.17, e + 0.04);
  // 厢房
  box(g, 0.22, 0.24, 0.34, M.plaster, 0.28, 0.0, 0.15);
  roof(g, 0.34, 0.22, 0.13, M.tile, M.plaster, 0.28, 0.24, 0.15, { over: 0.06, lift: 0.02, corner: 0.04, flare: 0.02, sheng: 0.015, ry: Math.PI / 2, ornScale: 0.7 });
  box(g, 0.012, 0.08, 0.1, M.window, 0.165, 0.11, 0.15);
  // 院中树
  cyl(g, 0.016, 0.026, 0.24, 12, M.wood, -0.24, 0, 0.18);
  g.add(foliageSprite(0, 0.2, -0.25, 0.32, 0.18));
  g.add(foliageSprite(0, 0.15, -0.18, 0.27, 0.2));
  return finish(g);
}

// ---------- 公共建筑 ----------
function makeWell() {
  const g = new THREE.Group();
  box(g, 0.7, 0.02, 0.7, M.paving, 0, 0, 0);
  cyl(g, 0.15, 0.17, 0.16, 12, M.stone, 0, 0, 0);
  cyl(g, 0.115, 0.115, 0.005, 12, M.pond, 0, 0.158, 0);
  for (const x of [-0.21, 0.21]) box(g, 0.03, 0.42, 0.03, M.wood, x, 0, 0);
  box(g, 0.46, 0.025, 0.025, M.wood, 0, 0.36, 0);
  roof(g, 0.5, 0.24, 0.1, M.tile, null, 0, 0.42, 0, { over: 0.05, thick: 0.022, lift: 0.015, corner: 0.04, flare: 0.025, ridgeW: 0.025, ridgeH: 0.03, ornScale: 0.55 });
  cyl(g, 0.04, 0.035, 0.06, 8, M.wood, 0.28, 0, 0.22);
  return finish(g);
}

function makeFarm() {
  const g = new THREE.Group();
  const cropMat = M.crop.clone();
  cropMat.side = THREE.DoubleSide;
  const geo = cached('crop', () => {
    // 一株粟：5 片弯曲的叶子 + 一支下垂的谷穗
    const parts = [];
    for (let b = 0; b < 5; b++) {
      const th = (b / 5) * Math.PI * 2 + b * 0.7, cx = Math.cos(th), cz = Math.sin(th), pos = [], idx = [];
      const steps = 7;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, out = 0.02 * t + 0.07 * t * t, y = (0.2 + b * 0.012) * t - 0.06 * t * t, w = 0.012 * (1 - t * 0.9);
        pos.push(cx * out - cz * w, y, cz * out + cx * w, cx * out + cz * w, y, cz * out - cx * w);
        if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      parts.push(g);
    }
    const stem = new THREE.CylinderGeometry(0.004, 0.006, 0.26, 8); stem.translate(0, 0.13, 0);
    const ear = new THREE.SphereGeometry(0.018, 14, 10); ear.scale(1, 2.6, 1); ear.rotateZ(1.1); ear.translate(0.03, 0.25, 0);
    parts.push(stem, ear);
    return mergeGeos(parts);
  });
  const pts = [];
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
    const x = -1.3 + (c + 0.5) * (2.6 / 12), z = -1.3 + (r + 0.5) * (2.6 / 12);
    if (x > 0.45 && z < -0.45) continue; // 角落留给草棚
    pts.push([x, z]);
  }
  const crops = new THREE.InstancedMesh(geo, cropMat, pts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  pts.forEach(([x, z], i) => {
    const k = 0.8 + Math.random() * 0.45;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    m4.compose(p.set(x + (Math.random() - 0.5) * 0.05, 0, z + (Math.random() - 0.5) * 0.05), q, s.set(k, k, k));
    crops.setMatrixAt(i, m4);
  });
  crops.castShadow = true;
  const cropGroup = new THREE.Group();
  cropGroup.add(crops);
  g.add(cropGroup);
  // 草棚
  box(g, 0.42, 0.22, 0.32, M.wood, 0.9, 0, -0.9);
  roof(g, 0.42, 0.32, 0.17, M.thatch, M.wood, 0.9, 0.22, -0.9, { over: 0.06, thick: 0.05, lift: 0, p: 1.1, ridge: false });
  box(g, 0.2, 0.08, 0.12, M.straw, 0.55, 0, -1.15);
  lay(g, 'harvest', 'sheaf', 6, 0.55, 0, -0.62, 3, 0.11, 0.12);
  spot(g, -0.8, -0.3, 0.3, 'hoe'); spot(g, 0.1, 0.6, -0.5, 'hoe'); spot(g, -0.4, 0.95, 2.6, 'hoe'); spot(g, 0.7, 0.1, 1.2, 'hoe'); spot(g, -0.9, 0.5, 0.0, 'hoe'); spot(g, 0.3, -0.3, 3.0, 'hoe');
  finish(g);
  g.userData.crops = cropGroup;
  g.userData.cropMat = cropMat;
  return g;
}

function makeGranary() {
  const g = new THREE.Group();
  box(g, 1.8, 0.08, 1.8, M.plinth, 0, 0, 0);
  for (const x of [-0.45, 0, 0.45]) for (const z of [-0.6, -0.05]) box(g, 0.06, 0.18, 0.06, M.wood, x, 0.08, z);
  box(g, 1.12, 0.04, 0.72, M.wood, 0, 0.24, -0.32);
  box(g, 1.02, 0.44, 0.62, M.wood, 0, 0.28, -0.32);
  for (const x of [-0.5, 0.5]) box(g, 0.05, 0.44, 0.05, M.timber, x, 0.28, -0.02);
  roof(g, 1.04, 0.64, 0.3, M.tile, null, 0, 0.72, -0.32, { type: 'hip', over: 0.13, lift: 0.025, corner: 0.09, flare: 0.06 });
  box(g, 0.2, 0.3, 0.012, M.door, 0, 0.28, -0.005);
  for (const x of [-0.45, 0.45]) {
    cyl(g, 0.22, 0.24, 0.42, 14, M.earth, x, 0.08, 0.5);
    add(g, coneGeo(0.3, 0.24, 14), M.thatch, x, 0.5, 0.5);
  }
  lay(g, 'food', 'food', 8, -0.13, 0.08, 0.42, 3, 0.13, 0.15, 6, 0.07);
  spot(g, -0.15, 0.62, Math.PI, 'carry'); spot(g, 0.25, 0.05, 0.3, 'work');
  return finish(g);
}

function makeMarket() {
  const g = new THREE.Group();
  box(g, 1.86, 0.015, 1.86, M.paving, 0, 0, 0);
  const cloths = [M.clothRed, M.clothBlue, M.clothOchre, M.clothGreen];
  const goods = [M.clothOchre, M.leaf, M.straw, M.clothRed];
  [[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]].forEach(([x, z], i) => {
    const s = new THREE.Group();
    for (const [px, pz] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]]) box(s, 0.025, pz < 0 ? 0.4 : 0.34, 0.025, M.wood, px, 0, pz);
    const aw = box(s, 0.52, 0.02, 0.42, cloths[i], 0, 0.36, 0);
    aw.rotation.x = 0.16;
    box(s, 0.38, 0.14, 0.18, M.wood, 0, 0, 0.05);
    const key = ['food', 'food', 'pottery', 'silk'][i];
    if (key === 'food') pile(g, 'food', [0, 1, 2].map(k => ITEM.grain(s, -0.11 + k * 0.11, 0.14, 0.05)));
    else if (key === 'pottery') pile(g, 'pottery', [0, 1, 2].map(k => ITEM.pottery(s, -0.11 + k * 0.11, 0.14, 0.05, k)));
    else pile(g, 'silk', [0, 1, 2].map(k => ITEM.silk(s, -0.06 + (k % 2) * 0.12, 0.155 + Math.floor(k / 2) * 0.03, 0.05, k)));
    void goods;
    box(s, 0.012, 0.5, 0.012, M.wood, 0.24, 0, 0.17);
    box(s, 0.006, 0.2, 0.08, cloths[(i + 2) % 4], 0.24, 0.24, 0.215);
    s.position.set(x, 0.015, z);
    s.rotation.y = Math.atan2(-x, -z) + Math.PI;
    g.add(s);
    const r = s.rotation.y, lx = 0, lz = -0.12;
    spot(g, x + lx * Math.cos(r) + lz * Math.sin(r), z - lx * Math.sin(r) + lz * Math.cos(r), r, 'work');
  });
  box(g, 0.035, 0.72, 0.035, M.timber, 0, 0, 0);
  box(g, 0.34, 0.025, 0.025, M.timber, 0, 0.64, 0);
  for (const x of [-0.14, 0.14]) {
    box(g, 0.006, 0.06, 0.006, M.wood, x, 0.58, 0);
    cyl(g, 0.045, 0.045, 0.085, 10, M.lantern, x, 0.5, 0);
  }
  return finish(g);
}

function makeTemple() {
  const g = new THREE.Group();
  box(g, 1.84, 0.08, 1.84, M.plinth, 0, 0, 0);
  box(g, 1.4, 0.1, 1.1, M.stone, 0, 0.08, -0.2);
  box(g, 0.4, 0.05, 0.2, M.stone, 0, 0.08, 0.42);
  box(g, 1.0, 0.42, 0.62, M.timber, 0, 0.18, -0.25);
  for (let k = 0; k < 6; k++) cyl(g, 0.028, 0.032, 0.42, 8, M.timber, -0.5 + k * 0.2, 0.18, 0.12);
  brackets(g, 1.04, 0.515, 0.14, 9);
  balustrade(g, 1.36, 1.06, 0.18, 0, -0.2, 0.4);
  stoneLion(g, -0.3, 0.08, 0.5); stoneLion(g, 0.3, 0.08, 0.5);
  for (const x of [-0.3, -0.1, 0.1, 0.3]) box(g, 0.17, 0.34, 0.012, M.window, x, 0.18, 0.066);
  roof(g, 1.18, 0.86, 0.4, M.glazeY, null, 0, 0.6, -0.2, { type: 'skirt', tMax: 0.58, over: 0.16, lift: 0.03, corner: 0.12, flare: 0.08, tipLen: 0.06, ridgeMat: M.ridgeGold, beasts: 2 });
  box(g, 0.78, 0.16, 0.5, M.timber, 0, 0.66, -0.22);
  brackets(g, 0.76, 0.775, 0.03, 7);
  roof(g, 0.82, 0.56, 0.3, M.glazeY, null, 0, 0.86, -0.22, { type: 'hip', over: 0.14, lift: 0.03, corner: 0.13, flare: 0.08, tipLen: 0.06, ridgeMat: M.ridgeGold, beasts: 3, ornScale: 1.3 });
  box(g, 0.24, 0.1, 0.012, M.glazeG, 0, 0.66, 0.035);
  cyl(g, 0.08, 0.06, 0.1, 10, M.bronze, 0, 0.08, 0.66);
  add(g, coneGeo(0.07, 0.07, 10), M.bronze, 0, 0.18, 0.66);
  for (const x of [-0.62, 0.62]) {
    box(g, 0.05, 0.3, 0.05, M.stone, x, 0.08, 0.62);
    box(g, 0.08, 0.08, 0.08, M.lantern, x, 0.38, 0.62);
    add(g, coneGeo(0.07, 0.05, 4), M.ridge, x, 0.46, 0.62);
  }
  spot(g, 0.18, 0.75, Math.PI, 'bow');
  for (const x of [-0.72, 0.72]) {
    cyl(g, 0.018, 0.028, 0.34, 12, M.wood, x, 0.08, -0.72);
    for (let k = 0; k < 4; k++) g.add(foliageSprite(1, 0.22 - k * 0.04, x + (k % 2 ? 0.02 : -0.02), 0.24 + k * 0.1, -0.72, true));
  }
  return finish(g);
}

function makeGarden() {
  const g = new THREE.Group();
  const pond = cyl(g, 0.2, 0.2, 0.02, 18, M.pond, -0.14, 0.0, 0.13);
  pond.scale.set(1.3, 1, 1);
  cyl(g, 0.16, 0.17, 0.04, 6, M.stone, 0.18, 0, -0.16);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    cyl(g, 0.012, 0.012, 0.2, 12, M.timber, 0.18 + Math.cos(a) * 0.12, 0.04, -0.16 + Math.sin(a) * 0.12);
  }
  pavilionRoof(g, 6, 0.2, 0.16, M.glazeG, 0.18, 0.24, -0.16);
  const rock = add(g, rockGeo(0.07, 3), M.lionStone, -0.3, 0.09, -0.27);
  rock.scale.set(0.9, 1.7, 0.75);
  add(g, rockGeo(0.04, 7), M.lionStone, -0.2, 0.03, -0.33);
  for (let k = 0; k < 7; k++) {
    const h = 0.3 + Math.random() * 0.22, bx = 0.24 + Math.random() * 0.14, bz = 0.18 + Math.random() * 0.16;
    cyl(g, 0.007, 0.009, h, 10, M.bamboo, bx, 0, bz);
    g.add(foliageSprite(3, 0.12 + Math.random() * 0.05, bx, h - 0.04, bz));
  }
  for (let k = 0; k < 4; k++) box(g, 0.08, 0.012, 0.06, M.paving, 0.06 - k * 0.05, 0, 0.42 - k * 0.12);
  return finish(g);
}

// ---------- 府邸 / 大宅 ----------
function courtyardShell(g, gateLanterns = true) {
  box(g, 0.94, 0.012, 0.94, M.paving, 0, 0, 0);
  const wallH = 0.22, t = 0.05, e = 0.445;
  const wall = (w, d, x, z) => { box(g, w, wallH, d, M.plaster, x, 0, z); box(g, w + 0.03, 0.03, d + 0.03, M.tile, x, wallH, z); };
  wall(0.94, t, 0, -e); wall(t, 0.94, -e, 0); wall(t, 0.94, e, 0);
  wall(0.36, t, -0.29, e); wall(0.36, t, 0.29, e);
  for (const x of [-0.11, 0.11]) box(g, 0.035, 0.28, 0.035, M.timber, x, 0, e);
  roof(g, 0.28, 0.1, 0.08, M.tile, null, 0, 0.28, e, { over: 0.05, thick: 0.022, lift: 0.015, corner: 0.04, flare: 0.025, ridgeW: 0.025, ridgeH: 0.03, ornScale: 0.5 });
  if (gateLanterns) lanternPair(g, -0.09, 0.09, 0.19, e + 0.04);
  box(g, 0.24, 0.02, 0.06, M.stone, 0, 0, e + 0.05);
}
function twoStoryHall(g, z, w, d, opts = {}) {
  box(g, w + 0.08, 0.05, d + 0.06, M.plinth, 0, 0, z);
  box(g, w, 0.24, d, M.plaster, 0, 0.05, z);
  for (let k = 0; k <= 4; k++) box(g, 0.032, 0.24, 0.032, M.timber, -w / 2 + k * (w / 4), 0.05, z + d / 2 + 0.01);
  for (const x of [-0.18, 0, 0.18]) box(g, 0.13, 0.16, 0.012, M.window, x, 0.08, z + d / 2 + 0.006);
  // 腰檐 + 平座栏杆
  roof(g, w + 0.02, d + 0.02, 0.26, M.tile, null, 0, 0.29, z, { type: 'skirt', tMax: 0.42, over: 0.07, lift: 0.02, corner: 0.05, flare: 0.03, tipLen: 0.03, ridgeW: 0.025, ridgeH: 0.03 });
  const uw = w * 0.84, ud = d * 0.78;
  box(g, uw, 0.2, ud, M.plaster, 0, 0.36, z);
  for (let k = 0; k <= 3; k++) box(g, 0.028, 0.2, 0.028, M.timber, -uw / 2 + k * (uw / 3), 0.36, z + ud / 2 + 0.01);
  for (const x of [-0.13, 0.13]) box(g, 0.14, 0.12, 0.012, M.window, x, 0.4, z + ud / 2 + 0.006);
  box(g, uw + 0.06, 0.012, 0.012, M.timber, 0, 0.44, z + ud / 2 + 0.04);
  for (let k = 0; k <= 6; k++) box(g, 0.01, 0.07, 0.01, M.timber, -(uw + 0.06) / 2 + k * ((uw + 0.06) / 6), 0.37, z + ud / 2 + 0.04);
  brackets(g, uw, 0.54, z + ud / 2 + 0.005, 5);
  roof(g, uw, ud, opts.rise || 0.2, M.tile, null, 0, 0.58, z, { type: 'hip', over: 0.09, lift: 0.02, corner: opts.corner || 0.08, flare: opts.flare || 0.05, tipLen: 0.04, ornScale: 0.8 });
}
function makeMansion() {
  const g = new THREE.Group();
  courtyardShell(g);
  twoStoryHall(g, -0.22, 0.66, 0.34);
  for (const sx of [-1, 1]) {
    box(g, 0.2, 0.22, 0.3, M.plaster, sx * 0.3, 0, 0.15);
    box(g, 0.012, 0.09, 0.12, M.window, sx * 0.195, 0.1, 0.15);
    roof(g, 0.3, 0.2, 0.12, M.tile, M.plaster, sx * 0.3, 0.22, 0.15, { over: 0.06, lift: 0.02, corner: 0.04, flare: 0.02, sheng: 0.015, ry: Math.PI / 2, ornScale: 0.6 });
  }
  cyl(g, 0.014, 0.022, 0.22, 12, M.wood, 0, 0, 0.2);
  g.add(foliageSprite(0, 0.15, 0, 0.3, 0.2));
  return finish(g);
}
function makeGrandHouse() {
  const g = new THREE.Group();
  courtyardShell(g);
  twoStoryHall(g, -0.22, 0.7, 0.34, { rise: 0.24, corner: 0.11, flare: 0.07 });
  // 东厢 + 西侧小园：水池、湖石、竹
  box(g, 0.2, 0.22, 0.32, M.plaster, 0.3, 0, 0.15);
  box(g, 0.012, 0.09, 0.14, M.window, 0.195, 0.1, 0.15);
  roof(g, 0.32, 0.2, 0.12, M.tile, M.plaster, 0.3, 0.22, 0.15, { over: 0.06, lift: 0.02, corner: 0.05, flare: 0.03, sheng: 0.015, ry: Math.PI / 2, ornScale: 0.6 });
  const pond = cyl(g, 0.12, 0.12, 0.015, 32, M.pond, -0.22, 0.012, 0.16); pond.scale.set(1, 1, 1.4);
  const rk = add(g, rockGeo(0.05, 5), M.lionStone, -0.3, 0.07, 0.3); rk.scale.set(0.8, 1.6, 0.7);
  for (let k = 0; k < 4; k++) { const bx = -0.36 + k * 0.03, bz = -0.02 + (k % 2) * 0.04; cyl(g, 0.006, 0.008, 0.3, 8, M.bamboo, bx, 0, bz); g.add(foliageSprite(3, 0.09, bx, 0.28, bz)); }
  lanternPair(g, -0.2, 0.2, 0.31, 0.0);
  return finish(g);
}

// ---------- 桑园 ----------
function makeMulberry() {
  const g = new THREE.Group();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (r === 0 && c === 2) continue;
    const x = -0.6 + c * 0.55 + (r % 2) * 0.08, z = -0.6 + r * 0.55;
    cyl(g, 0.016, 0.026, 0.16, 12, M.wood, x, 0, z);
    for (let k = 0; k < 3; k++) g.add(foliageSprite(0, 0.11 + k * 0.015, x + (k - 1) * 0.06, 0.2 + (k % 2) * 0.05, z + (k === 1 ? 0.04 : -0.02)));
  }
  // 蚕房：草棚 + 蚕匾架
  box(g, 0.42, 0.22, 0.3, M.wood, 0.55, 0, -0.62);
  roof(g, 0.42, 0.3, 0.16, M.thatch, M.wood, 0.55, 0.22, -0.62, { over: 0.06, thick: 0.05, lift: 0, p: 1.1, ridge: false });
  for (const x of [0.36, 0.74]) box(g, 0.02, 0.2, 0.02, M.wood, x, 0, -0.38);
  for (let k = 0; k < 3; k++) cyl(g, 0.09, 0.09, 0.012, 24, M.straw, 0.55, 0.05 + k * 0.06, -0.38);
  lay(g, 'harvest', 'cocoon', 4, 0.3, 0, -0.15, 4, 0.1, 0);
  spot(g, -0.33, -0.33, 0.5, 'pick'); spot(g, 0.2, 0.25, -0.8, 'pick'); spot(g, -0.33, 0.5, 2.0, 'pick'); spot(g, 0.5, -0.1, 3.0, 'work');
  return finish(g);
}

// ---------- 丝坊 ----------
function loom(g, x, z) {
  for (const [dx, dz] of [[-0.08, -0.06], [0.08, -0.06], [-0.08, 0.06], [0.08, 0.06]]) box(g, 0.015, dz < 0 ? 0.2 : 0.12, 0.015, M.wood, x + dx, 0, z + dz);
  box(g, 0.18, 0.015, 0.015, M.wood, x, 0.2, z - 0.06);
  box(g, 0.16, 0.01, 0.12, M.clothBlue, x, 0.11, z);
  box(g, 0.05, 0.08, 0.04, M.wood, x, 0, z + 0.1);
}
function makeSilk() {
  const g = new THREE.Group();
  box(g, 1.8, 0.04, 1.8, M.paving, 0, 0, 0);
  box(g, 1.0, 0.05, 0.6, M.plinth, 0, 0.04, -0.4);
  box(g, 0.94, 0.32, 0.5, M.plaster, 0, 0.09, -0.45);
  for (let k = 0; k <= 5; k++) box(g, 0.035, 0.32, 0.035, M.timber, -0.47 + k * 0.188, 0.09, -0.19);
  for (const x of [-0.28, 0, 0.28]) box(g, 0.16, 0.22, 0.012, M.window, x, 0.12, -0.195);
  brackets(g, 0.94, 0.4, -0.2, 7);
  roof(g, 0.94, 0.5, 0.24, M.tile, M.plaster, 0, 0.43, -0.45, { over: 0.12, lift: 0.02, corner: 0.07, flare: 0.04, sheng: 0.03, barge: true });
  loom(g, -0.45, 0.05); loom(g, -0.15, 0.05);
  // 晾丝架：彩色丝绸
  const cols = [M.clothRed, M.clothOchre, M.clothBlue, M.clothGreen, M.clothRed];
  for (const x of [0.15, 0.75]) box(g, 0.025, 0.42, 0.025, M.wood, x, 0, 0.45);
  box(g, 0.64, 0.02, 0.02, M.wood, 0.45, 0.42, 0.45);
  cols.forEach((m, k) => box(g, 0.09, 0.28, 0.006, m, 0.21 + k * 0.12, 0.13, 0.45));
  lay(g, 'cocoon', 'cocoon', 4, 0.22, 0.04, -0.02, 4, 0.11, 0);
  box(g, 0.34, 0.04, 0.2, M.wood, -0.45, 0.04, 0.6);
  lay(g, 'silk', 'silk', 6, -0.52, 0.08, 0.56, 2, 0.14, 0.09, 4, 0.032);
  spot(g, -0.45, 0.2, Math.PI, 'weave'); spot(g, -0.15, 0.2, Math.PI, 'weave'); spot(g, 0.3, 0.1, 0, 'work'); spot(g, 0.6, 0.6, 0.3, 'work'); spot(g, -0.7, 0.4, 1.4, 'carry'); spot(g, 0.0, 0.62, 0.0, 'work');
  return finish(g);
}

// ---------- 陶窑 ----------
const VASE = [[0.0, 0], [0.028, 0], [0.042, 0.025], [0.048, 0.055], [0.036, 0.09], [0.02, 0.105], [0.026, 0.122], [0.0, 0.122]];
const BOWL = [[0.0, 0], [0.02, 0], [0.04, 0.02], [0.05, 0.035], [0.046, 0.036], [0.0, 0.012]];
function makeKiln() {
  const g = new THREE.Group();
  box(g, 1.8, 0.03, 1.8, M.dirt, 0, 0, 0);
  // 馒头窑：半球窑身 + 窑门 + 烟囱
  const dome = add(g, cached('kilnDome', () => new THREE.SphereGeometry(0.36, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2)), M.terracotta, -0.3, 0.03, -0.25);
  dome.scale.set(1, 0.95, 1);
  box(g, 0.16, 0.15, 0.06, M.soot, -0.3, 0.03, 0.09);
  box(g, 0.24, 0.03, 0.08, M.stone, -0.3, 0.18, 0.1);
  cyl(g, 0.06, 0.08, 0.62, 24, M.terracotta, -0.3, 0.03, -0.55);
  cyl(g, 0.065, 0.065, 0.03, 24, M.soot, -0.3, 0.64, -0.55);
  const smoke = [0, 1, 2].map(k => g.add(foliageSprite(5, 0.12, -0.3, 0.7, -0.55, false, k / 3)) && g.children[g.children.length - 1]);
  g.userData.activeOnly = smoke;
  // 陶坯棚
  for (const [x, z] of [[0.2, -0.1], [0.75, -0.1], [0.2, 0.55], [0.75, 0.55]]) box(g, 0.03, 0.3, 0.03, M.wood, x, 0, z);
  roof(g, 0.6, 0.7, 0.14, M.thatch, null, 0.475, 0.3, 0.22, { over: 0.06, thick: 0.04, lift: 0, p: 1.1, ridge: false, ry: Math.PI / 2 });
  box(g, 0.5, 0.03, 0.18, M.wood, 0.475, 0.12, 0.05);
  for (let k = 0; k < 2; k++) add(g, latheGeo('vase', VASE), M.stone, 0.35 + k * 0.2, 0.15, 0.05);
  for (let k = 0; k < 3; k++) add(g, latheGeo('bowl', BOWL), M.stone, 0.62 + k * 0.03, 0.15 + k * 0.035, 0.08);
  lay(g, 'pottery', 'pottery', 6, 0.22, 0.03, 0.34, 3, 0.12, 0.14);
  spot(g, -0.3, 0.28, Math.PI, 'stoke'); spot(g, 0.45, -0.12, 0, 'work'); spot(g, 0.75, 0.3, -1.2, 'carry'); spot(g, -0.65, 0.35, 0.8, 'dig'); spot(g, 0.1, 0.12, 1.0, 'work');
  const clay = add(g, rockGeo(0.14, 9), M.terracotta, -0.55, 0.03, 0.5); clay.scale.set(1.3, 0.5, 1);
  return finish(g);
}

// ---------- 货栈 ----------
function makeWarehouse() {
  const g = new THREE.Group();
  box(g, 1.8, 0.06, 1.8, M.paving, 0, 0, 0);
  box(g, 1.2, 0.06, 0.82, M.plinth, 0, 0.06, -0.35);
  box(g, 1.1, 0.4, 0.72, M.wood, 0, 0.12, -0.35);
  for (let k = 0; k <= 4; k++) box(g, 0.045, 0.4, 0.045, M.timber, -0.55 + k * 0.275, 0.12, 0.02);
  box(g, 0.3, 0.32, 0.015, M.door, 0, 0.12, 0.012);
  brackets(g, 1.1, 0.5, 0.02, 8);
  roof(g, 1.1, 0.72, 0.32, M.tile, null, 0, 0.54, -0.35, { type: 'hip', over: 0.14, lift: 0.025, corner: 0.09, flare: 0.06 });
  for (let k = 0; k < 2; k++) { const c = box(g, 0.12, 0.1, 0.12, M.wood, -0.7 + k * 0.14, 0.06, 0.62); c.rotation.y = k * 0.3; }
  lay(g, 'pottery', 'pottery', 8, -0.55, 0.06, 0.25, 4, 0.11, 0.12);
  box(g, 0.36, 0.05, 0.22, M.wood, 0.45, 0.06, 0.3);
  lay(g, 'silk', 'silk', 8, 0.38, 0.11, 0.26, 2, 0.14, 0.09, 4, 0.032);
  spot(g, -0.15, 0.45, 0.4, 'carry'); spot(g, 0.2, 0.55, -0.6, 'carry'); spot(g, 0.0, 0.15, Math.PI, 'work'); spot(g, -0.7, 0.42, 1.2, 'work');
  return finish(g);
}

// ---------- 茶楼 ----------
function makeTeahouse() {
  const g = new THREE.Group();
  box(g, 1.8, 0.03, 1.8, M.paving, 0, 0, 0);
  const z = -0.3, w = 1.0, d = 0.66;
  box(g, w + 0.1, 0.06, d + 0.08, M.plinth, 0, 0.03, z);
  box(g, w, 0.3, d - 0.12, M.plaster, 0, 0.09, z - 0.06);
  for (let k = 0; k <= 5; k++) cyl(g, 0.022, 0.026, 0.3, 16, M.timber, -w / 2 + k * (w / 5), 0.09, z + d / 2);
  for (const x of [-0.3, -0.1, 0.1, 0.3]) box(g, 0.16, 0.22, 0.012, M.window, x, 0.11, z + d / 2 - 0.12);
  roof(g, w + 0.04, d + 0.04, 0.34, M.tile, null, 0, 0.39, z, { type: 'skirt', tMax: 0.42, over: 0.1, lift: 0.02, corner: 0.08, flare: 0.05, tipLen: 0.04, ridgeW: 0.028, ridgeH: 0.03 });
  const uw = 0.84, ud = 0.5;
  box(g, uw, 0.26, ud, M.timber, 0, 0.47, z);
  for (let k = 0; k < 5; k++) box(g, 0.14, 0.16, 0.012, M.window, -0.32 + k * 0.16, 0.52, z + ud / 2 + 0.006);
  box(g, uw + 0.1, 0.014, 0.014, M.timber, 0, 0.6, z + ud / 2 + 0.05);
  for (let k = 0; k <= 8; k++) box(g, 0.012, 0.09, 0.012, M.timber, -(uw + 0.1) / 2 + k * ((uw + 0.1) / 8), 0.51, z + ud / 2 + 0.05);
  brackets(g, uw, 0.77, z + ud / 2 + 0.005, 7);
  roof(g, uw, ud, 0.26, M.tile, null, 0, 0.81, z, { type: 'hip', over: 0.13, lift: 0.025, corner: 0.13, flare: 0.08, tipLen: 0.05, ornScale: 1 });
  lanternPair(g, -0.35, 0.35, 0.3, z + d / 2 + 0.1);
  // 茶幌与茶座
  box(g, 0.025, 0.9, 0.025, M.wood, 0.72, 0, 0.35);
  box(g, 0.14, 0.012, 0.012, M.wood, 0.65, 0.86, 0.35);
  box(g, 0.1, 0.3, 0.006, M.clothBlue, 0.63, 0.55, 0.35);
  box(g, 0.06, 0.06, 0.008, M.plaster, 0.63, 0.7, 0.354);
  for (const [x, zz] of [[-0.45, 0.45], [-0.05, 0.5], [0.35, 0.6]]) {
    cyl(g, 0.11, 0.11, 0.015, 28, M.wood, x, 0.12, zz);
    cyl(g, 0.012, 0.02, 0.12, 12, M.wood, x, 0, zz);
    for (const a of [0, 2.1, 4.2]) cyl(g, 0.035, 0.035, 0.07, 16, M.wood, x + Math.cos(a) * 0.16, 0, zz + Math.sin(a) * 0.16);
    add(g, latheGeo('bowl', BOWL), M.celadon, x + 0.03, 0.135, zz);
  }
  spot(g, -0.25, 0.55, 0.6, 'serve'); spot(g, 0.15, 0.62, -0.4, 'serve'); spot(g, 0.3, 0.1, 0, 'serve'); spot(g, -0.6, 0.15, 0.5, 'work');
  return finish(g);
}

// ---------- 水龙局 / 营缮所 / 河堤 / 商栈 / 废墟 ----------
function makeFirehouse() {
  const g = new THREE.Group();
  box(g, 0.9, 0.02, 0.9, M.paving, 0, 0, 0);
  box(g, 0.62, 0.3, 0.42, M.plaster, 0, 0.02, -0.16);
  for (const x of [-0.31, 0.31]) box(g, 0.04, 0.3, 0.04, M.timber, x, 0.02, 0.05);
  box(g, 0.22, 0.22, 0.012, M.door, 0, 0.02, 0.055);
  roof(g, 0.62, 0.42, 0.18, M.tile, M.plaster, 0, 0.32, -0.16, { over: 0.08, lift: 0.025, corner: 0.05, flare: 0.03, sheng: 0.02, ornScale: 0.7 });
  // 望火楼
  for (const [x, z] of [[0.24, 0.2], [0.38, 0.2], [0.24, 0.34], [0.38, 0.34]]) box(g, 0.025, 0.62, 0.025, M.wood, x, 0, z);
  box(g, 0.2, 0.025, 0.2, M.wood, 0.31, 0.6, 0.27);
  pavilionRoof(g, 4, 0.16, 0.1, M.tile, 0.31, 0.7, 0.27, { corner: 0.03, flare: 0.02 });
  cyl(g, 0.035, 0.035, 0.05, 16, M.bronze, 0.31, 0.63, 0.27);
  // 水缸、水龙车
  for (const x of [-0.36, -0.22]) cyl(g, 0.055, 0.045, 0.1, 20, M.terracotta, x, 0.02, 0.3);
  box(g, 0.2, 0.08, 0.1, M.timber, -0.05, 0.05, 0.3);
  const tank = cyl(g, 0.04, 0.04, 0.16, 16, M.bronze, -0.05, 0.13, 0.3); tank.rotation.z = Math.PI / 2;
  spot(g, -0.1, 0.18, 0.3, 'work'); spot(g, 0.1, 0.38, -0.4, 'work'); spot(g, -0.3, 0.12, 0.8, 'carry');
  return finish(g);
}
function makeRepair() {
  const g = new THREE.Group();
  box(g, 0.9, 0.02, 0.9, M.dirt, 0, 0, 0);
  box(g, 0.56, 0.28, 0.36, M.wood, 0, 0.02, -0.2);
  roof(g, 0.56, 0.36, 0.16, M.tile, M.wood, 0, 0.3, -0.2, { over: 0.08, lift: 0.02, corner: 0.04, flare: 0.02, sheng: 0.015, ornScale: 0.6 });
  box(g, 0.16, 0.2, 0.012, M.door, -0.12, 0.02, -0.015);
  // 木料堆、砖瓦、梯子
  for (let k = 0; k < 4; k++) { const t = cyl(g, 0.02, 0.02, 0.36, 12, M.wood, 0.12, 0.04 + k * 0.035, 0.2 + (k % 2) * 0.03); t.rotation.z = Math.PI / 2; }
  for (let k = 0; k < 3; k++) box(g, 0.16, 0.035, 0.1, M.tile, -0.25, 0.02 + k * 0.035, 0.25);
  const lad = box(g, 0.08, 0.36, 0.012, M.wood, 0.3, 0.02, -0.01); lad.rotation.x = -0.35;
  spot(g, 0.0, 0.32, 0.5, 'work'); spot(g, -0.3, 0.05, -0.6, 'carry'); spot(g, 0.32, 0.25, 2.6, 'dig');
  return finish(g);
}
function makeLevee() {
  const g = new THREE.Group();
  // 夯土堤身（四面坡）+ 堤顶石板路 + 迎水面木桩
  add(g, cached('levee', () => { const c = new THREE.CylinderGeometry(0.42, 0.7, 0.2, 4, 1); c.rotateY(Math.PI / 4); c.translate(0, 0.1, 0); return c; }), M.earth, 0, 0, 0);
  box(g, 0.56, 0.02, 0.56, M.paving, 0, 0.2, 0);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const st = cyl(g, 0.014, 0.018, 0.16, 8, M.wood, Math.cos(a) * 0.5, 0.0, Math.sin(a) * 0.5); st.rotation.z = Math.cos(a) * 0.3; st.rotation.x = -Math.sin(a) * 0.3; }
  g.add(foliageSprite(0, 0.07, 0.3, 0.24, 0.3)); g.add(foliageSprite(0, 0.06, -0.32, 0.24, -0.28));
  return finish(g);
}
function makeTradepost() {
  const g = new THREE.Group();
  box(g, 1.84, 0.03, 1.84, M.paving, 0, 0, 0);
  // 回字形院落：正厅 + 两厢 + 大门
  box(g, 1.0, 0.34, 0.42, M.plaster, 0, 0.03, -0.55);
  for (let k = 0; k <= 4; k++) box(g, 0.035, 0.34, 0.035, M.timber, -0.5 + k * 0.25, 0.03, -0.33);
  brackets(g, 1.0, 0.4, -0.33, 7);
  roof(g, 1.0, 0.42, 0.24, M.tile, null, 0, 0.44, -0.55, { type: 'hip', over: 0.12, lift: 0.025, corner: 0.09, flare: 0.06 });
  for (const sx of [-1, 1]) {
    box(g, 0.3, 0.26, 0.6, M.plaster, sx * 0.7, 0.03, 0.05);
    roof(g, 0.6, 0.3, 0.14, M.tile, M.plaster, sx * 0.7, 0.29, 0.05, { over: 0.06, lift: 0.02, corner: 0.04, flare: 0.02, sheng: 0.015, ry: Math.PI / 2, ornScale: 0.6 });
  }
  for (const x of [-0.18, 0.18]) box(g, 0.04, 0.4, 0.04, M.timber, x, 0, 0.82);
  roof(g, 0.44, 0.14, 0.1, M.tile, null, 0, 0.4, 0.82, { over: 0.05, thick: 0.022, lift: 0.02, corner: 0.05, flare: 0.03, ornScale: 0.5 });
  box(g, 0.3, 0.07, 0.012, M.glazeG, 0, 0.32, 0.84);
  lanternPair(g, -0.14, 0.14, 0.27, 0.86);
  // 院中拴马桩、货包
  for (const x of [-0.3, 0.3]) cyl(g, 0.02, 0.025, 0.2, 12, M.stone, x, 0.03, 0.45);
  for (let k = 0; k < 4; k++) { const b = add(g, sphGeo(0.06), [M.clothOchre, M.straw, M.clothBlue, M.straw][k], -0.15 + k * 0.1, 0.07, 0.05); b.scale.set(1.2, 0.7, 0.9); }
  spot(g, -0.1, 0.25, 0, 'carry'); spot(g, 0.2, 0.15, -0.6, 'work'); spot(g, 0.0, 0.6, Math.PI, 'serve');
  return finish(g);
}
function makeRuin(size = 1) {
  const g = new THREE.Group();
  const s = size * 0.9;
  box(g, s, 0.015, s, M.soot, 0, 0, 0);
  const rnd = (k) => { const x = Math.sin(k * 12.9898 + size * 7.1) * 43758.5453; return x - Math.floor(x); };
  for (let k = 0; k < 6 * size * size; k++) {
    const b = box(g, 0.04 + rnd(k) * 0.05, 0.03, 0.3 * (0.5 + rnd(k + 1)), rnd(k + 2) > 0.5 ? M.soot : M.wood, (rnd(k + 3) - 0.5) * s * 0.8, 0.015 + rnd(k + 4) * 0.04, (rnd(k + 5) - 0.5) * s * 0.8);
    b.rotation.set((rnd(k + 6) - 0.5) * 0.6, rnd(k + 7) * 3, (rnd(k + 8) - 0.5) * 0.5);
  }
  for (let k = 0; k < 3 * size; k++) { const r = add(g, rockGeo(0.06 + rnd(k + 20) * 0.05, k), M.stone, (rnd(k + 9) - 0.5) * s * 0.7, 0.02, (rnd(k + 10) - 0.5) * s * 0.7); r.scale.y = 0.5; }
  const post = box(g, 0.04, 0.22, 0.04, M.soot, s * 0.3, 0, -s * 0.25); post.rotation.z = 0.25;
  return finish(g);
}

export function makeBuilding(type, level = 0, size = 1) {
  switch (type) {
    case 'house': return [makeLot, makeHut, makeTileHouse, makeCourtyard, makeMansion, makeGrandHouse][level]();
    case 'mulberry': return makeMulberry();
    case 'silk': return makeSilk();
    case 'kiln': return makeKiln();
    case 'warehouse': return makeWarehouse();
    case 'teahouse': return makeTeahouse();
    case 'firehouse': return makeFirehouse();
    case 'repair': return makeRepair();
    case 'levee': return makeLevee();
    case 'tradepost': return makeTradepost();
    case 'ruin': return makeRuin(size);
    case 'well': return makeWell();
    case 'farm': return makeFarm();
    case 'granary': return makeGranary();
    case 'market': return makeMarket();
    case 'temple': return makeTemple();
    case 'garden': return makeGarden();
  }
  return new THREE.Group();
}

// ---------- 步行者 ----------
const WALKER_COLORS = { immigrant: 0x7d6b52, cart: 0x58687a, porter: 0x8d7a55, peddler: 0x3e5f8a, priest: 0xb8652a, teller: 0x5a3f6e, hoe: 0x5f6444, pick: 0x6b7448, weave: 0x5a6a80, stoke: 0x4a4038, dig: 0x6a5a44, carry: 0x7a6a4e, work: 0x55606e, serve: 0x8a5038, bow: 0x9a5a2a, fireman: 0x8a2e22, watchman: 0x3a3a4a, mason: 0x6a5a40, caravan: 0x6a4a6a };
const walkerMats = {};
function latheGeo(key, pts, seg = 12) {
  return cached(key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));
}
const ROBE = [[0.0, 0], [0.056, 0.0], [0.054, 0.012], [0.046, 0.06], [0.038, 0.11], [0.04, 0.135], [0.03, 0.152], [0.012, 0.16], [0.0, 0.16]];
const HAT = [[0.0, 0.045], [0.02, 0.036], [0.05, 0.014], [0.078, 0.0], [0.079, -0.004], [0.0, -0.002]];
export function makeWalker(kind) {
  const g = new THREE.Group();
  const body = (walkerMats[kind] ||= D(std(WALKER_COLORS[kind] || 0x777777, 0.9), 'plaster'));
  const inner = new THREE.Group();
  add(inner, latheGeo('robe', ROBE), body, 0, 0, 0);
  add(inner, latheGeo('sash', [[0.0405, 0.0], [0.0415, 0.012], [0.0, 0.012]]), M.clothRed, 0, 0.1, 0);
  for (const sx of [-1, 1]) { const arm = add(inner, cylGeo(0.012, 0.016, 0.085, 12), body, sx * 0.042, 0.065, 0.005); arm.rotation.z = sx * 0.18; }
  add(inner, sphGeo(0.032), M.skin, 0, 0.188, 0);
  if (kind !== 'priest') add(inner, latheGeo('hat', HAT), M.straw, 0, 0.205, 0);
  else add(inner, sphGeo(0.012), M.skin, 0, 0.222, -0.005);
  if (kind === 'immigrant') { const b = add(inner, sphGeo(0.042), M.clothOchre, 0, 0.11, -0.06); b.scale.set(1, 0.85, 0.75); }
  if (kind === 'porter' || kind === 'peddler') {
    const pole = add(inner, cylGeo(0.005, 0.005, 0.3, 10), M.wood, -0.15, 0.17, 0); pole.rotation.z = -Math.PI / 2;
    const fill = { food: [], pottery: [], silk: [] };
    for (const x of [-0.13, 0.13]) {
      add(inner, cylGeo(0.0015, 0.0015, 0.08, 6), M.wood, x, 0.09, 0);
      add(inner, latheGeo('basket', [[0.0, 0], [0.03, 0.0], [0.042, 0.02], [0.045, 0.045], [0.04, 0.047], [0.036, 0.022], [0.0, 0.01]]), M.straw, x, 0.045, 0);
      const f = add(inner, sphGeo(0.04), M.clothOchre, x, 0.09, 0); f.scale.set(1, 0.5, 1); fill.food.push(f);
      const p = add(inner, latheGeo('vase', VASE), M.terracotta, x, 0.06, 0); p.scale.setScalar(0.6); fill.pottery.push(p);
      const sk = box(inner, 0.07, 0.03, 0.05, M.clothRed, x, 0.08, 0); fill.silk.push(sk);
    }
    for (const k in fill) fill[k].forEach(m => { m.visible = false; });
    g.userData.fill = fill;
  }
  if (kind === 'caravan') {
    const donkey = new THREE.Group();
    const body = add(donkey, sphGeo(0.06), M.dirt, 0, 0.13, 0); body.scale.set(0.8, 0.75, 1.6);
    const head = add(donkey, sphGeo(0.03), M.dirt, 0, 0.19, 0.11); head.scale.set(0.8, 0.9, 1.4);
    for (const sx of [-1, 1]) add(donkey, coneGeo(0.01, 0.04, 8), M.dirt, sx * 0.015, 0.21, 0.1);
    for (const [x, z] of [[-0.025, 0.06], [0.025, 0.06], [-0.025, -0.06], [0.025, -0.06]]) cyl(donkey, 0.008, 0.01, 0.1, 8, M.dirt, x, 0, z);
    for (const sx of [-1, 1]) { const pk = add(donkey, sphGeo(0.04), M.clothOchre, sx * 0.06, 0.15, 0); pk.scale.set(0.7, 1, 1.1); }
    donkey.position.set(0.12, 0, 0.1);
    inner.add(donkey);
  }
  if (kind === 'cart') {
    box(inner, 0.16, 0.05, 0.13, M.wood, 0, 0.05, 0.15);
    const cargo = {};
    const grp = k => { const c = new THREE.Group(); c.visible = false; inner.add(c); cargo[k] = c; return c; };
    let c = grp('food'); for (const x of [-0.035, 0.035]) { const m = add(c, sphGeo(0.045), M.straw, x, 0.13, 0.15); m.scale.set(0.9, 0.7, 1.2); }
    c = grp('cocoon'); { const m = add(c, sphGeo(0.065), M.cocoon, 0, 0.11, 0.15); m.scale.set(1.1, 0.55, 0.9); }
    c = grp('pottery'); for (const x of [-0.045, 0, 0.045]) { const m = add(c, latheGeo('vase', VASE), x ? M.terracotta : M.celadon, x, 0.1, 0.15); m.scale.setScalar(0.65); }
    c = grp('silk'); [M.clothRed, M.clothBlue, M.clothOchre].forEach((m, k) => box(c, 0.13, 0.025, 0.08, m, 0, 0.1 + k * 0.026, 0.15));
    g.userData.cargo = cargo;
    const wg = cached('wheel', () => { const c = new THREE.TorusGeometry(0.04, 0.008, 10, 28); c.rotateY(Math.PI / 2); return c; });
    for (const x of [-0.09, 0.09]) add(inner, wg, M.wood, x, 0.045, 0.15);
    const ax = add(inner, cylGeo(0.006, 0.006, 0.18, 8), M.wood, -0.09, 0.045, 0.15); ax.rotation.z = -Math.PI / 2;
  }
  if (kind === 'priest') add(inner, sphGeo(0.02), M.clothRed, 0, 0.12, 0.05);
  if (kind === 'hoe' || kind === 'dig') {
    const h = add(inner, cylGeo(0.004, 0.004, 0.22, 8), M.wood, 0.03, 0.04, 0.05); h.rotation.x = 0.9;
    box(inner, 0.04, 0.008, 0.03, M.bronze, 0.03, 0.04, 0.17);
  }
  if (kind === 'carry') { const sk = add(inner, sphGeo(0.045), M.straw, 0, 0.15, -0.05); sk.scale.set(1, 0.8, 0.8); }
  if (kind === 'fireman') {
    for (const x of [-0.06, 0.06]) { cyl(inner, 0.025, 0.02, 0.045, 14, M.wood, x, 0.05, 0.04); }
    const pole = add(inner, cylGeo(0.005, 0.005, 0.26, 8), M.wood, 0.05, 0.08, 0.08); pole.rotation.x = 1.1;
  }
  if (kind === 'watchman') { box(inner, 0.006, 0.1, 0.006, M.wood, 0.06, 0.1, 0.03); cyl(inner, 0.025, 0.025, 0.04, 14, M.lantern, 0.06, 0.06, 0.03); }
  if (kind === 'mason') { const ld = box(inner, 0.05, 0.22, 0.01, M.wood, 0.0, 0.05, -0.05); ld.rotation.x = 0.2; box(inner, 0.05, 0.02, 0.04, M.tile, 0.05, 0.1, 0.05); }
  if (kind === 'teller') { const fan = add(inner, cylGeo(0.035, 0.035, 0.004, 20), M.plaster, 0.05, 0.14, 0.04); fan.rotation.x = 1.2; fan.scale.set(1, 1, 0.6); }
  const keep = new Set();
  for (const c of Object.values(g.userData.cargo || {})) keep.add(c);
  for (const list of Object.values(g.userData.fill || {})) for (const o of list) keep.add(o);
  mergeStatic(inner, keep);
  inner.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.add(inner);
  g.userData.inner = inner;
  return g;
}
