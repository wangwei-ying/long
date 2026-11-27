// 国画树：程序化枝干（锥形曲管 + 树皮纹理）+ 着色器绘制的叶团（点叶、车轮松针、柳丝、个字竹叶）
// 叶团是朝向镜头的面片（松针盘为水平面片），在片元着色器里按笔法画出来，不使用多边形树冠
import * as THREE from 'three';
import { NOISE_GLSL, applyDetail } from './materials.js';
import { mergeGeos } from './roofs.js';
import { mulberry32 } from './noise.js';
import { N, MARGIN, T_GRASS, T_MOUNTAIN, T_WATER } from './config.js';

// 0 阔叶点叶  1 松针盘（水平） 2 柳  3 竹叶  4 松针团（朝向镜头，用于柏树）
export const FU = {
  uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.3, 0.3, 0.3) }, uNight: { value: 0 },
};

const VS = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec3 iPos; attribute vec4 iData; attribute vec4 iMisc;
uniform float uTime;
varying vec2 vUv; varying vec4 vData; varying vec3 vN; varying float vTree; varying float vAge;
void main(){
  vUv = uv * 2.0 - 1.0;
  vAge = 0.0;
  vData = iData; vTree = iMisc.w;
  float sc = length(modelMatrix[0].xyz);
  vec3 c = (modelMatrix * vec4(iPos, 1.0)).xyz;
  float size = iData.x * sc * iData.w;
  float type = iData.z;
  if (type > 5.5) {
    float age = fract(uTime * 0.85 + iData.y);
    vAge = age;
    c.y += age * 0.32 * sc;
    c.x += sin(uTime * 7.0 + iData.y * 20.0) * 0.015 * sc;
    size *= 1.0 - age * 0.55;
  } else if (type > 4.5) {
    float age = fract(uTime * 0.08 + iData.y);
    vAge = age;
    c.y += age * 0.9 * sc;
    c.x += (age * age * 0.3 + sin(uTime * 0.7 + iData.y * 9.0) * 0.04) * sc;
    size *= 0.5 + age * 1.7;
  }
  c.x += sin(uTime * 1.3 + iData.y * 17.0 + c.z * 0.3) * 0.05 * size;
  c.z += cos(uTime * 1.1 + iData.y * 11.0) * 0.03 * size;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 off;
  if (abs(type - 1.0) < 0.5) {
    float a = iData.y * 6.2832;
    vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
    off = vec3(p.x, p.x * 0.12, p.y) * size * 2.0;
    vN = normalize(vec3(p.x * 0.5, 1.0, p.y * 0.5));
  } else {
    float stretch = abs(type - 2.0) < 0.5 ? 1.45 : 1.0;
    off = (right * position.x + up * position.y * stretch) * size * 2.0;
    vN = normalize(iMisc.xyz * 0.8 + right * position.x * 1.4 + up * position.y * 1.4 + back * 0.4);
  }
  vec4 mvPosition = viewMatrix * vec4(c + off, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FOLIAGE = /* glsl */`
uniform vec3 uSunDir, uSunCol, uAmb; uniform float uTime, uNight;
varying vec2 vUv; varying vec4 vData; varying vec3 vN; varying float vTree; varying float vAge;
${NOISE_GLSL}
mat2 rot(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
// 返回 rgb 颜色（反照率）与覆盖度 a（<0.5 丢弃）
vec4 foliage(){
  vec2 p = vUv; float r = length(p); float a = atan(p.y, p.x);
  float seed = vData.y; float type = vData.z;
  float shade = clamp(dot(normalize(vN), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  bool maple = tHash(vec2(vTree, 3.3)) < 0.1;
  if (type > 5.5) {
    // 火焰：上窄下宽的火舌，随年龄由黄转红
    vec2 q = vec2(p.x * (1.2 + max(p.y, 0.0) * 1.2), p.y + 0.25);
    float n = tNoise(p * 3.0 + vec2(seed * 7.0, -uTime * 6.0));
    float d = length(q) + (n - 0.5) * 0.5;
    float alpha = smoothstep(0.85, 0.35, d) * (1.0 - vAge * 0.85);
    vec3 col = mix(vec3(1.0, 0.62, 0.18), vec3(0.85, 0.16, 0.04), clamp(vAge * 1.3 + d * 0.5, 0.0, 1.0));
    return vec4(col, alpha);
  }
  if (type > 4.5) {
    // 炊烟：水墨晕染的一团，上升中淡去
    float n = tFbm(p * 2.2 + vec2(seed * 10.0, -uTime * 0.25));
    float m = smoothstep(1.0, 0.3, r + (n - 0.5) * 0.8);
    float alpha = m * (1.0 - vAge) * smoothstep(0.0, 0.15, vAge) * 0.7;
    return vec4(mix(vec3(0.2, 0.2, 0.19), vec3(0.62, 0.6, 0.56), vAge), alpha);
  }
  if (type < 0.5) {
    // 点叶法：淡墨（花青藤黄）打底，浓墨胡椒点 / 介字点
    float edge = 0.7 + 0.12 * sin(a * 5.0 + seed * 6.0) + 0.07 * sin(a * 11.0 + seed * 13.0);
    vec2 q = p * 6.5 + seed * 10.0;
    vec2 cell = floor(q), f = fract(q) - 0.5;
    vec2 jit = vec2(tHash(cell), tHash(cell + 7.1)) - 0.5;
    vec2 d = rot(tHash(cell + 3.3) * 3.1416) * (f - jit * 0.45);
    float dotM = smoothstep(0.3, 0.2, length(d * vec2(1.0, 2.0)));
    float inner = smoothstep(edge, edge - 0.1, r);
    float outer = step(r, edge + 0.22) * dotM * step(0.5, tHash(cell + 1.7));
    if (inner < 0.5 && outer < 0.5) return vec4(0.0);
    vec3 wl = maple ? vec3(0.62, 0.26, 0.08) : vec3(0.30, 0.43, 0.15);
    vec3 wd = maple ? vec3(0.32, 0.08, 0.04) : vec3(0.08, 0.18, 0.08);
    vec3 ink = maple ? vec3(0.2, 0.03, 0.02) : vec3(0.02, 0.05, 0.035);
    vec3 col = mix(wd, wl, shade * (0.7 + 0.3 * tNoise(p * 3.0 + seed)));
    col = mix(col, ink, dotM * (0.45 + 0.55 * (1.0 - shade)) * (0.55 + 0.45 * tHash(cell + 9.0)));
    col = mix(col, ink, smoothstep(edge - 0.16, edge, r) * inner * 0.3);
    return vec4(col, 1.0);
  }
  if (type < 1.5 || type > 3.5) {
    // 车轮松针：放射状细线，针尖形成锯齿边
    float spikes = pow(abs(sin(a * 9.0 + seed * 5.0)), 0.6);
    float edge = 0.7 + 0.22 * spikes - 0.08 * tNoise(vec2(a * 3.0, seed * 7.0));
    if (r > edge) return vec4(0.0);
    float nd = abs(sin(a * 36.0 + seed * 20.0 + tNoise(vec2(r * 5.0, a * 2.0)) * 1.2));
    float needles = smoothstep(0.7, 0.97, nd) * smoothstep(0.15, 0.5, r);
    vec3 base = mix(vec3(0.04, 0.11, 0.09), vec3(0.15, 0.27, 0.19), shade * (0.55 + 0.45 * (1.0 - r)));
    vec3 col = mix(base, vec3(0.01, 0.035, 0.03), needles * 0.85);
    col = mix(col, vec3(0.01, 0.03, 0.025), smoothstep(edge - 0.12, edge, r) * 0.5);
    return vec4(col, 1.0);
  }
  if (type < 2.5) {
    // 柳：拱形树冠垂下丝丝柳条，随风摆动
    float sway = sin(uTime * 1.4 + seed * 9.0) * 0.08 * (1.0 - p.y);
    float xs = p.x + sway + sin(p.y * 3.0 + seed * 4.0) * 0.05;
    float fid = floor(xs * 8.0), fx = fract(xs * 8.0) - 0.5;
    float len = 0.5 + 0.9 * tHash(vec2(fid, seed));
    float topY = 0.8 - 0.35 * xs * xs;
    float strand = smoothstep(0.2, 0.06, abs(fx)) * step(topY - len, p.y) * step(p.y, topY) * step(abs(xs), 0.92);
    float lv = smoothstep(0.38, 0.1, abs(fract(p.y * 13.0 + fid * 0.37) - 0.5));
    float crown = smoothstep(0.32, 0.18, length(vec2(p.x * 0.75, (p.y - 0.62) * 2.0)) + tNoise(p * 6.0 + seed) * 0.1);
    float m = max(strand * (0.55 + 0.45 * lv), crown);
    if (m < 0.4) return vec4(0.0);
    vec3 col = mix(vec3(0.1, 0.18, 0.05), vec3(0.38, 0.48, 0.13), shade);
    col = mix(col, vec3(0.04, 0.08, 0.03), lv * strand * 0.45);
    return vec4(col, 1.0);
  }
  // 个字竹叶（墨竹）
  if (r > 0.98) return vec4(0.0);
  vec2 q = p * 2.6 + seed * 5.0;
  vec2 cell = floor(q), f = fract(q) - vec2(0.5, 0.75);
  float m = 0.0;
  float ba = -1.5708 + (tHash(cell) - 0.5) * 0.8;
  for (int k = 0; k < 3; k++) {
    float aa = ba + (float(k) - 1.0) * 0.62;
    vec2 dir = vec2(cos(aa), sin(aa));
    float t = dot(f, dir), s = abs(dot(f, vec2(-dir.y, dir.x)));
    float w = 0.085 * sin(clamp(t / 0.55, 0.0, 1.0) * 3.1416);
    m = max(m, step(0.0, t) * step(t, 0.55) * smoothstep(w, w * 0.5, s));
  }
  if (m < 0.5) return vec4(0.0);
  vec3 col = mix(vec3(0.015, 0.05, 0.035), vec3(0.1, 0.22, 0.12), shade * 0.85 * tHash(cell + 2.0));
  return vec4(col, 1.0);
}`;

const FS = /* glsl */`
#include <common>
#include <fog_pars_fragment>
${FOLIAGE}
void main(){
  vec4 f = foliage();
  vec3 light = uAmb + uSunCol * clamp(dot(normalize(vN), uSunDir), 0.0, 1.0);
#ifdef SMOKE
  if (f.a < 0.01) discard;
  gl_FragColor = vData.z > 5.5 ? vec4(f.rgb * 1.8, f.a) : vec4(f.rgb * (uAmb * 1.6 + uSunCol * 0.6), f.a);
#else
  if (f.a < 0.5) discard;
  gl_FragColor = vec4(f.rgb * light, 1.0);
#endif
  #include <fog_fragment>
}`;

const FS_DEPTH = /* glsl */`
#include <common>
#include <packing>
${FOLIAGE}
void main(){
  if (foliage().a < 0.5) discard;
  gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
}`;

let _mat = null, _depth = null, _smoke = null;
function foliageMats() {
  if (!_mat) {
    _mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), vertexShader: VS, fragmentShader: FS, fog: true, side: THREE.DoubleSide });
    Object.assign(_mat.uniforms, FU);
    _depth = new THREE.ShaderMaterial({ uniforms: FU, vertexShader: VS, fragmentShader: FS_DEPTH, side: THREE.DoubleSide });
  }
  if (!_smoke) {
    _smoke = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), vertexShader: VS, fragmentShader: FS, fog: true,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, defines: { SMOKE: 1 } });
    Object.assign(_smoke.uniforms, FU);
  }
  return { mat: _mat, depth: _depth, smoke: _smoke };
}

function spriteGeometry(n) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  g.setAttribute('iMisc', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  g.instanceCount = n;
  return g;
}

// 建筑里用的单个叶团（院中树、盆栽、竹丛、柏树）
const spriteCache = new Map();
export function foliageSprite(type, size, x, y, z, upright = false, seedIn = null) {
  const t = type === 1 && upright ? 4 : type;
  const seed = seedIn ?? Math.round(Math.random() * 7) / 7;
  const key = `${t},${size},${seed}`;
  let g = spriteCache.get(key);
  if (!g) {
    g = spriteGeometry(1);
    g.attributes.iData.array.set([size, seed, t, 1]);
    g.attributes.iMisc.array.set([0, 1, 0, seed * 13.7]);
    spriteCache.set(key, g);
  }
  const { mat, depth, smoke } = foliageMats();
  const m = new THREE.Mesh(g, t >= 5 ? smoke : mat);
  m.customDepthMaterial = depth;
  m.position.set(x, y, z);
  m.userData.sprite = true;
  if (t >= 5) { m.userData.noShadow = true; m.renderOrder = 3; m.frustumCulled = false; }
  return m;
}

// ---------- 枝干 ----------
function taperTube(pts, r0, r1, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const seg = Math.max(4, pts.length * 2);
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    const n = frames.normals[i], b = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(c.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * r, c.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * r, c.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * r);
    }
  }
  const R = radial + 1;
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
    const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function makePine(rand) {
  const H = 0.95 + rand() * 0.4;
  const lean = rand() * Math.PI * 2, lk = 0.08 + rand() * 0.14;
  const trunkAt = t => V(Math.cos(lean) * lk * t * t + Math.sin(t * 5 + lean) * 0.025, H * t, Math.sin(lean) * lk * t * t + Math.cos(t * 4) * 0.02);
  const tubes = [taperTube([0, 0.25, 0.5, 0.75, 1].map(trunkAt), 0.05, 0.012)];
  const clusters = [];
  const n = 3 + Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) {
    const t = 0.42 + (k / n) * 0.5 + rand() * 0.05;
    const base = trunkAt(t);
    const a = rand() * Math.PI * 2, L = (0.12 + rand() * 0.14) * (1.1 - t * 0.5);
    const mid = base.clone().add(V(Math.cos(a) * L * 0.5, 0.05, Math.sin(a) * L * 0.5));
    const end = base.clone().add(V(Math.cos(a) * L, 0.03 + rand() * 0.05, Math.sin(a) * L));
    tubes.push(taperTube([base, mid, end], 0.014, 0.005, 5));
    clusters.push({ p: end.clone().add(V(0, 0.03, 0)), s: (0.17 + rand() * 0.08) * (1.15 - t * 0.4), t: 1 });
    if (rand() < 0.6) clusters.push({ p: mid.clone().add(V(0, 0.05, 0)), s: 0.11 + rand() * 0.05, t: 1 });
  }
  clusters.push({ p: trunkAt(1).add(V(0, 0.03, 0)), s: 0.14 + rand() * 0.05, t: 1 });
  return { geo: mergeGeos(tubes), clusters, center: V(0, H * 0.75, 0) };
}

function makeBroad(rand) {
  const H = 0.42 + rand() * 0.18;
  const top = V((rand() - 0.5) * 0.06, H, (rand() - 0.5) * 0.06);
  const tubes = [taperTube([V(0, 0, 0), V(0.01, H * 0.5, -0.01), top], 0.045, 0.026)];
  const center = V(top.x, H + 0.24, top.z);
  const clusters = [];
  const nb = 2 + Math.floor(rand() * 2);
  for (let k = 0; k < nb; k++) {
    const a = (k / nb) * Math.PI * 2 + rand();
    const end = center.clone().add(V(Math.cos(a) * 0.17, 0.02 + rand() * 0.1, Math.sin(a) * 0.17));
    const mid = top.clone().lerp(end, 0.5).add(V(0, 0.03, 0));
    tubes.push(taperTube([top, mid, end], 0.022, 0.007, 5));
  }
  const nc = 7 + Math.floor(rand() * 3);
  for (let k = 0; k < nc; k++) {
    const a = rand() * Math.PI * 2, e = (rand() - 0.3) * 1.2;
    const d = V(Math.cos(a) * Math.cos(e) * 0.24, Math.sin(e) * 0.16, Math.sin(a) * Math.cos(e) * 0.24);
    clusters.push({ p: center.clone().add(d), s: 0.15 + rand() * 0.08, t: 0 });
  }
  clusters.push({ p: center.clone().add(V(0, 0.04, 0)), s: 0.22, t: 0 });
  return { geo: mergeGeos(tubes), clusters, center };
}

function makeWillow(rand) {
  const lean = rand() * Math.PI * 2;
  const top = V(Math.cos(lean) * 0.12, 0.55 + rand() * 0.1, Math.sin(lean) * 0.12);
  const tubes = [taperTube([V(0, 0, 0), V(Math.cos(lean) * 0.03, 0.25, Math.sin(lean) * 0.03), top], 0.045, 0.022)];
  const center = top.clone().add(V(0, 0.1, 0));
  const clusters = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rand() * 0.5;
    const end = center.clone().add(V(Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2));
    tubes.push(taperTube([top, top.clone().lerp(end, 0.5).add(V(0, 0.07, 0)), end], 0.016, 0.006, 5));
    clusters.push({ p: end.clone().add(V(0, -0.1, 0)), s: 0.2 + rand() * 0.06, t: 2 });
  }
  clusters.push({ p: center.clone().add(V(0, -0.05, 0)), s: 0.25, t: 2 });
  return { geo: mergeGeos(tubes), clusters, center };
}

// ---------- 整片树林 ----------
export class Forest {
  constructor(scene, world) {
    this.world = world;
    const rand = mulberry32(4242);
    this.variants = [];
    for (let k = 0; k < 6; k++) this.variants.push({ kind: 'pine', ...makePine(rand) });
    for (let k = 0; k < 6; k++) this.variants.push({ kind: 'broad', ...makeBroad(rand) });
    for (let k = 0; k < 3; k++) this.variants.push({ kind: 'willow', ...makeWillow(rand) });
    const byKind = kind => this.variants.map((v, i) => [v, i]).filter(([v]) => v.kind === kind).map(([, i]) => i);
    const pines = byKind('pine'), broads = byKind('broad'), willows = byKind('willow');
    const pick = arr => arr[Math.floor(rand() * arr.length)];

    const W = world, trees = [];
    const nearRiver = (u, v) => Math.abs(u - W.riverCenter(v)) < W.riverHalf(v) + 1.6;
    for (let j = -MARGIN; j < N + MARGIN; j++) for (let i = -MARGIN; i < N + MARGIN; i++) {
      const inside = i >= 0 && j >= 0 && i < N && j < N;
      if (inside) continue;
      const u = i + 0.5, v = j + 0.5, t = W.classify(u, v), h = W.heightAt(u, v);
      let p = 0;
      if (t === T_MOUNTAIN) p = h < 2.2 ? 0.4 : 0.06;
      else if (t === T_GRASS) p = 0.26 * (0.4 + W.fbm(u * 0.1 + 50, v * 0.1 + 80, 3));
      if (Math.abs(j - W.entry.j) <= 1 && i < 0) p = 0;
      if (rand() < p) {
        const wil = t === T_GRASS && nearRiver(u, v) && rand() < 0.6;
        trees.push({ x: u + (rand() - 0.5) * 0.6, z: v + (rand() - 0.5) * 0.6, variant: wil ? pick(willows) : t === T_MOUNTAIN || rand() < 0.55 ? pick(pines) : pick(broads), s: 0.85 + rand() * 0.5, k: -1 });
      }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = W.idx(i, j);
      if (W.type[k] === T_MOUNTAIN && rand() < 0.45) {
        trees.push({ x: i + 0.5 + (rand() - 0.5) * 0.6, z: j + 0.5 + (rand() - 0.5) * 0.6, variant: pick(pines), s: 0.8 + rand() * 0.5, k: -1 });
      }
      if (!W.tree[k]) continue;
      const wil = nearRiver(i + 0.5, j + 0.5);
      const n = rand() < 0.4 ? 2 : 1;
      for (let c = 0; c < n; c++) {
        trees.push({ x: i + 0.5 + (rand() - 0.5) * 0.5, z: j + 0.5 + (rand() - 0.5) * 0.5, variant: wil ? pick(willows) : W.tree[k] === 1 ? pick(pines) : pick(broads), s: (c ? 0.65 : 0.9) + rand() * 0.35, k });
      }
    }
    this.trees = trees;
    trees.forEach(t => { t.ry = rand() * Math.PI * 2; t.seed = rand() * 100; t.y = W.heightAt(t.x, t.z); });

    // 枝干：每个变体一个 InstancedMesh
    const bark = applyDetail(new THREE.MeshStandardMaterial({ color: 0x4d3b2d, roughness: 0.95 }), 'bark');
    this.trunks = this.variants.map((v, vi) => {
      const list = trees.filter(t => t.variant === vi);
      const m = new THREE.InstancedMesh(v.geo, bark, Math.max(1, list.length));
      m.count = list.length;
      m.castShadow = false; m.receiveShadow = true;
      list.forEach((t, k) => { t.trunkMesh = m; t.trunkIdx = k; });
      scene.add(m);
      return m;
    });

    // 叶团：所有树合成一个实例化几何
    let nc = 0;
    trees.forEach(t => { t.c0 = nc; nc += this.variants[t.variant].clusters.length; });
    this.leafGeo = spriteGeometry(nc);
    const ip = this.leafGeo.attributes.iPos.array, id = this.leafGeo.attributes.iData.array, im = this.leafGeo.attributes.iMisc.array;
    const q = new THREE.Quaternion(), up = V(0, 1, 0);
    trees.forEach(t => {
      const v = this.variants[t.variant];
      q.setFromAxisAngle(up, t.ry);
      v.clusters.forEach((c, k) => {
        const n = t.c0 + k;
        const lp = c.p.clone().applyQuaternion(q).multiplyScalar(t.s);
        ip.set([t.x - N / 2 + lp.x, t.y + lp.y, t.z - N / 2 + lp.z], n * 3);
        const nr = c.p.clone().sub(v.center).applyQuaternion(q).add(V(0, 0.08, 0)).normalize();
        id.set([c.s * t.s, (t.seed * 7.31 + k * 0.137) % 1, c.t, 1], n * 4);
        im.set([nr.x, nr.y, nr.z, t.seed], n * 4);
      });
    });
    const { mat, depth } = foliageMats();
    this.leaves = new THREE.Mesh(this.leafGeo, mat);
    this.leaves.customDepthMaterial = depth;
    this.leaves.castShadow = true;
    this.leaves.frustumCulled = false;
    scene.add(this.leaves);
    this.update();
  }

  update() {
    const W = this.world, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V(1, 1, 1), p = V(0, 0, 0), up = V(0, 1, 0);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const id = this.leafGeo.attributes.iData.array;
    for (const t of this.trees) {
      const alive = t.k < 0 || W.tree[t.k] ? 1 : 0;
      if (alive) {
        q.setFromAxisAngle(up, t.ry);
        m4.compose(p.set(t.x - N / 2, t.y - 0.02, t.z - N / 2), q, s.set(t.s, t.s, t.s));
        t.trunkMesh.setMatrixAt(t.trunkIdx, m4);
      } else t.trunkMesh.setMatrixAt(t.trunkIdx, zero);
      const n = this.variants[t.variant].clusters.length;
      for (let k = 0; k < n; k++) id[(t.c0 + k) * 4 + 3] = alive;
    }
    for (const m of this.trunks) m.instanceMatrix.needsUpdate = true;
    this.leafGeo.attributes.iData.needsUpdate = true;
  }
}
