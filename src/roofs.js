// 参数化屋顶：悬山 / 庑殿 / 腰檐 / 攒尖，凹曲坡面 + 生起 + 翼角起翘出翘，屋脊沿曲面走，附鸱吻、蝎子尾、仙人走兽
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 把若干带索引的几何体合并（只保留 position / normal / aRoof）
export function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), roof = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, r = g.attributes.aRoof;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (r) roof.set(r.array, vo * 2);
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[io++] = g.index.array[k] + vo;
    else for (let k = 0; k < p.count; k++) idx[io++] = k + vo;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aRoof', new THREE.BufferAttribute(roof, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// 由点阵生成一张带索引的面片；want 用来判断朝向（返回期望的法线方向）
function gridGeo(rows, want) {
  const R = rows.length, C = rows[0].length;
  const pos = [], roof = [], idx = [];
  for (const row of rows) for (const p of row) { pos.push(p.x, p.y, p.z); roof.push(p.along || 0, p.slope || 0); }
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
    const a = i * C + j, b = a + 1, c = a + C, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // 用中间一格检查朝向
  const mi = Math.floor((R - 1) / 2), mj = Math.floor((C - 1) / 2);
  const P = k => V(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const a = mi * C + mj, pa = P(a), pb = P(a + 1), pc = P(a + C);
  const n = new THREE.Vector3().subVectors(pc, pa).cross(new THREE.Vector3().subVectors(pb, pa));
  if (n.dot(want(pa)) < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRoof', new THREE.Float32BufferAttribute(roof, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 方截面管：沿折线扫掠，用于屋脊
export function tubeGeo(pts, w, h) {
  const rows = [];
  const up0 = V(0, 1, 0);
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const tan = new THREE.Vector3().subVectors(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]).normalize();
    let side = new THREE.Vector3().crossVectors(up0, tan);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(tan, side).normalize();
    const c = p.clone().addScaledVector(up, h * 0.3);
    rows.push([
      c.clone().addScaledVector(side, -w / 2).addScaledVector(up, -h / 2),
      c.clone().addScaledVector(side, w / 2).addScaledVector(up, -h / 2),
      c.clone().addScaledVector(side, w / 2).addScaledVector(up, h / 2),
      c.clone().addScaledVector(side, -w / 2).addScaledVector(up, h / 2),
    ]);
  }
  const pos = [], idx = [];
  for (const r of rows) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let k = 0; k < rows.length - 1; k++) for (let s = 0; s < 4; s++) {
    const a = k * 4 + s, b = k * 4 + ((s + 1) % 4), c = a + 4, d = b + 4;
    idx.push(a, b, c, b, d, c);
  }
  const last = (rows.length - 1) * 4;
  idx.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3);
  const gi = new THREE.BufferGeometry();
  gi.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  gi.setIndex(idx);
  const g = gi.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

const TN = 9;
const bSamples = n => Array.from({ length: n + 1 }, (_, j) => 0.5 - 0.5 * Math.cos(Math.PI * j / n));

/**
 * 矩形屋顶。屋脊沿 X，坡面朝 ±Z，原点在墙顶中心。
 * o.type: 'gable' 悬山 | 'hip' 庑殿 | 'skirt' 腰檐（庑殿截去上部）
 */
export function rectRoof(o) {
  const Ax = o.L / 2 + o.over, Bz = o.S / 2 + o.over;
  const hip = o.type !== 'gable';
  const w = Math.min(Ax, Bz) * (o.cornerW ?? 0.42);
  const tMax = o.type === 'skirt' ? o.tMax : 1;
  const H = t => o.rise * Math.pow(t, o.p);

  function point(face, t, b) {
    let x, z, ed;
    if (!hip || face < 2) { const h = hip ? Ax - t * Bz : Ax; x = (2 * b - 1) * h; z = Bz * (1 - t); ed = h - Math.abs(x); }
    else { const d = Bz * (1 - t); x = Ax - t * Bz; z = (2 * b - 1) * d; ed = d - Math.abs(z); }
    if (face === 1) z = -z;
    if (face === 3) x = -x;
    const along = face < 2 ? x : z;
    const e = 1 - t, k = Math.exp(-Math.max(0, ed) / w);
    const sx = Math.sign(x) || 1, sz = Math.sign(z) || 1;
    const fl = (o.flare || 0) * e * e * k;
    // 悬山只在檐口两角起翘；庑殿四角
    x += sx * fl * 0.7071; z += sz * fl * 0.7071;
    let y = H(t) + (o.lift || 0) * Math.pow(e, 3) + (o.corner || 0) * Math.pow(e, 2.2) * k;
    if (!hip) y += (o.sheng || 0) * Math.pow(t, 2) * Math.pow(Math.abs(x) / Ax, 3);
    return Object.assign(V(x, y, z), { along, slope: t * Bz * 1.15 });
  }

  const faces = hip ? [0, 1, 2, 3] : [0, 1];
  const parts = [];
  const top = [], bottom = [];
  for (const f of faces) {
    const bs = bSamples(f < 2 ? 12 : 7);
    const rows = [];
    for (let i = 0; i <= TN; i++) {
      const t = (i / TN) * tMax;
      rows.push(bs.map(b => point(f, t, b)));
    }
    top.push(rows);
    const drop = o.thick;
    bottom.push(rows.map(r => r.map(p => Object.assign(p.clone().add(V(0, -drop, 0)), { along: p.along, slope: p.slope }))));
  }
  for (const rows of top) parts.push(gridGeo(rows, () => V(0, 1, 0)));
  for (const rows of bottom) parts.push(gridGeo(rows, () => V(0, -1, 0)));
  // 檐口立面（连接上下两层），显出屋面厚度与瓦当
  const strip = (a, b) => gridGeo([a, b], p => V(p.x, 0, p.z));
  top.forEach((rows, fi) => {
    const bot = bottom[fi];
    parts.push(strip(rows[0], bot[0]));
    if (!hip) {
      parts.push(strip(rows.map(r => r[0]), bot.map(r => r[0])));
      parts.push(strip(rows.map(r => r[r.length - 1]), bot.map(r => r[r.length - 1])));
    }
    if (o.type === 'skirt') parts.push(strip(rows[TN], bot[TN]));
  });
  const shell = mergeGeos(parts);

  // 山墙填充（悬山）：墙顶到屋面下沿
  let fill = null;
  if (!hip) {
    const segs = 14, fp = [], fi = [];
    for (const sxw of [-1, 1]) {
      const base = fp.length / 3;
      for (let s = 0; s <= segs; s++) {
        const zz = -o.S / 2 + (s / segs) * o.S;
        const t = Math.min(1, 1 - Math.abs(zz) / Bz);
        const p = point(0, t, 0.5 + sxw * 0.5 * (o.L / 2) / Ax);
        const y = Math.max(0.002, p.y - o.thick - 0.004);
        fp.push(sxw * o.L / 2, 0, zz, sxw * o.L / 2, y, zz);
      }
      for (let s = 0; s < segs; s++) {
        const a = base + s * 2, b = a + 1, c = a + 2, d = a + 3;
        if (sxw > 0) fi.push(a, b, c, b, d, c); else fi.push(a, c, b, b, c, d);
      }
    }
    fill = new THREE.BufferGeometry();
    fill.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fill.setIndex(fi);
    fill.computeVertexNormals();
  }

  // 屋脊
  const ridges = [], beasts = [], tips = [], ends = [];
  const rw = o.ridgeW ?? 0.045, rh = o.ridgeH ?? 0.05;
  if (o.type !== 'skirt') {
    const ridgePts = [];
    if (hip) {
      const r = Ax - Bz;
      for (let s = 0; s <= 8; s++) ridgePts.push(point(0, 1, s / 8).setY(H(1)));
      ridges.push(tubeGeo(ridgePts.map(p => V(p.x, p.y + o.thick * 0.2, 0)), rw, rh));
      ends.push(V(-r, H(1) + o.thick * 0.2, 0), V(r, H(1) + o.thick * 0.2, 0));
    } else {
      for (let s = 0; s <= 16; s++) ridgePts.push(point(0, 1, s / 16));
      ridges.push(tubeGeo(ridgePts.map(p => V(p.x, p.y + o.thick * 0.2, 0)), rw, rh));
      ends.push(V(ridgePts[0].x, ridgePts[0].y + o.thick * 0.2, 0), V(ridgePts[16].x, ridgePts[16].y + o.thick * 0.2, 0));
    }
  }
  if (hip) {
    // 四条垂脊 / 戗脊，沿曲面从脊端走到翼角，末端顺势上挑
    for (const [f, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const pts = [];
      for (let i = TN; i >= 0; i--) {
        const t = (i / TN) * tMax;
        const p = point(f, t, b);
        pts.push(V(p.x, p.y + o.thick * 0.15, p.z));
      }
      const n = pts.length, last = pts[n - 1], prev = pts[n - 2];
      const dir = new THREE.Vector3().subVectors(last, prev).setY(0).normalize();
      const tip = last.clone().addScaledVector(dir, (o.tipLen ?? 0.05)).add(V(0, (o.tipLen ?? 0.05) * 0.55, 0));
      pts.push(tip);
      ridges.push(tubeGeo(pts, rw * 0.8, rh * 0.8));
      tips.push(tip);
      if (o.beasts) {
        for (let k = 0; k < o.beasts; k++) {
          const idx = n - 3 - k;
          if (idx > 0) beasts.push(pts[idx].clone().add(V(0, rh * 0.5, 0)));
        }
      }
    }
  } else if (o.barge) {
    // 排山脊：沿悬山两端的屋面边缘
    for (const f of [0, 1]) for (const b of [0, 1]) {
      const pts = [];
      for (let i = TN; i >= 0; i--) { const p = point(f, i / TN, b); pts.push(V(p.x, p.y + o.thick * 0.1, p.z)); }
      ridges.push(tubeGeo(pts, rw * 0.6, rh * 0.6));
    }
  }
  return { shell, fill, ridges, beasts, tips, ends };
}

/** 攒尖顶：n 边形，翼角起翘 */
export function polyRoof(o) {
  const n = o.n, R = o.R;
  const corners = Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2 + (o.rot || 0); return V(Math.cos(a) * R, 0, Math.sin(a) * R); });
  const edge = corners[0].distanceTo(corners[1]);
  const w = edge * 0.35;
  function point(k, t, b) {
    const c0 = corners[k], c1 = corners[(k + 1) % n];
    const p = new THREE.Vector3().lerpVectors(c0, c1, b).multiplyScalar(1 - t);
    const ed = Math.min(b, 1 - b) * edge * (1 - t);
    const e = 1 - t, kk = Math.exp(-ed / w);
    const near = b < 0.5 ? c0 : c1;
    const fl = (o.flare || 0) * e * e * kk;
    p.addScaledVector(near.clone().normalize(), fl);
    p.y = o.rise * Math.pow(t, o.p) + (o.corner || 0) * Math.pow(e, 2.2) * kk;
    return Object.assign(p, { along: b * edge, slope: t * R });
  }
  const parts = [], tops = [];
  for (let k = 0; k < n; k++) {
    const rows = [];
    for (let i = 0; i <= TN; i++) rows.push(bSamples(10).map(b => point(k, i / TN, b)));
    tops.push(rows);
    parts.push(gridGeo(rows, () => V(0, 1, 0)));
    const bot = rows.map(r => r.map(p => Object.assign(p.clone().add(V(0, -o.thick, 0)), { along: p.along, slope: p.slope })));
    parts.push(gridGeo(bot, () => V(0, -1, 0)));
    parts.push(gridGeo([rows[0], bot[0]], p => V(p.x, 0, p.z)));
  }
  const ridges = [], tips = [];
  for (let k = 0; k < n; k++) {
    const pts = [];
    for (let i = TN; i >= 0; i--) { const p = point(k, i / TN, 0); pts.push(V(p.x, p.y + o.thick * 0.15, p.z)); }
    const l = pts.length, dir = new THREE.Vector3().subVectors(pts[l - 1], pts[l - 2]).setY(0).normalize();
    const tip = pts[l - 1].clone().addScaledVector(dir, o.tipLen ?? 0.04).add(V(0, (o.tipLen ?? 0.04) * 0.7, 0));
    pts.push(tip); tips.push(tip);
    ridges.push(tubeGeo(pts, o.ridgeW ?? 0.025, o.ridgeH ?? 0.03));
  }
  return { shell: mergeGeos(parts), fill: null, ridges, beasts: [], tips, ends: [], apex: V(0, o.rise, 0) };
}
