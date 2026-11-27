// 产业链流向图层：从产地到仓库、到集市、到民居，用流动的弧线标出货物去向；卡住的环节标红
import * as THREE from 'three';
import { N } from './config.js';

export const CHAINS = {
  food: { name: '粮', color: 0xe0a83c, label: '粮食' },
  silk: { name: '丝', color: 0xd8483a, label: '蚕茧与丝绸' },
  pottery: { name: '陶', color: 0x4fae96, label: '陶器' },
  trade: { name: '商', color: 0x9a72e0, label: '商队' },
  service: { name: '巡', color: 0x5d9fdc, label: '集市到民居' },
};
const BAD = new Set(['缺工', '断料', '满仓', '无路']);

const center = b => new THREE.Vector3(b.i + b.size / 2 - N / 2, 0.35 + b.size * 0.12, b.j + b.size / 2 - N / 2);

// 计算流向：每座产出建筑连到最近的、已连通官道的下游建筑
export function flowLinks(sim) {
  const W = sim.w, all = [...W.buildings.values()];
  const of = t => all.filter(b => b.type === t && W.isConnected(b));
  const nearest = (b, list) => {
    let best = null, bd = 1e9;
    for (const o of list) { const d = Math.hypot(o.i - b.i, o.j - b.j); if (d < bd) { bd = d; best = o; } }
    return best;
  };
  const links = [];
  const link = (from, to, chain, extra = {}) => to && links.push({ from, to, chain, bad: BAD.has(from.icon) || BAD.has(to.icon), ...extra });
  const granaries = of('granary'), markets = of('market'), warehouses = of('warehouse'), silks = of('silk');
  for (const b of all) {
    if (b.type === 'farm') link(b, nearest(b, granaries), 'food');
    if (b.type === 'mulberry') link(b, nearest(b, silks), 'silk');
    if (b.type === 'silk') link(b, nearest(b, warehouses), 'silk');
    if (b.type === 'kiln') link(b, nearest(b, warehouses), 'pottery');
    if (b.type === 'tradepost') {
      links.push({ from: { i: W.entry.i - 2, j: W.entry.j, size: 1, virtual: true }, to: b, chain: 'trade', bad: BAD.has(b.icon) });
      const pending = Object.values(b.out).some(v => v >= 1);
      if (pending) link(b, nearest(b, warehouses.length ? warehouses : granaries), 'trade');
    }
  }
  for (const m of markets) {
    link(nearest(m, granaries) || m, m, 'food');
    if (warehouses.length) { const wh = nearest(m, warehouses); link(wh, m, 'pottery'); }
    // 集市到民居：最近的几户
    const hs = all.filter(h => h.type === 'house' && h.level > 0).sort((a, b) => Math.hypot(a.i - m.i, a.j - m.j) - Math.hypot(b.i - m.i, b.j - m.j)).slice(0, 8);
    for (const h of hs) if (Math.hypot(h.i - m.i, h.j - m.j) < 12) links.push({ from: m, to: h, chain: 'service', bad: h.icon === '饥', thin: true });
  }
  return links.filter(l => l.from !== l.to);
}

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FS = /* glsl */`
uniform vec3 uColor; uniform float uTime, uLen, uBad;
varying vec2 vUv;
void main(){
  float s = fract(vUv.x * uLen * 2.2 - uTime * 1.4);
  float dash = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.55, 0.63, s));
  vec3 col = mix(uColor, vec3(1.0, 0.2, 0.15), uBad);
  float a = mix(0.35, 0.95, dash);
  if (uBad > 0.5) a *= 0.6 + 0.4 * step(0.5, fract(uTime * 2.0));
  gl_FragColor = vec4(col * 1.6, a);
}`;

export class FlowLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 20;
    scene.add(this.group);
    this.filter = 'all';
    this.mats = [];
  }
  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }

  build(links) {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
    this.mats = [];
    for (const l of links) {
      if (this.filter !== 'all' && l.chain !== this.filter) continue;
      const a = center(l.from), b = center(l.to);
      if (l.from.virtual) a.y = 0.2;
      const dist = a.distanceTo(b);
      if (dist < 0.3) continue;
      const mid = a.clone().lerp(b, 0.5); mid.y += 0.4 + dist * 0.22;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const r = l.thin ? 0.018 : 0.04;
      const geo = new THREE.TubeGeometry(curve, Math.max(12, Math.round(dist * 4)), r, 6, false);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: false, depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color(CHAINS[l.chain].color) }, uTime: { value: 0 }, uLen: { value: dist }, uBad: { value: l.bad ? 1 : 0 } },
      });
      this.mats.push(mat);
      const tube = new THREE.Mesh(geo, mat); tube.renderOrder = 20; this.group.add(tube);
      if (!l.thin) {
        const tip = curve.getPoint(1), dir = curve.getTangent(0.98);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 10), mat);
        cone.position.copy(tip).addScaledVector(dir, -0.08);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        cone.renderOrder = 21;
        this.group.add(cone);
      }
    }
  }
  update(time) { if (this.group.visible) for (const m of this.mats) m.uniforms.uTime.value = time; }
}
