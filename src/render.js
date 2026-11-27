// 渲染：地形着色器、河水着色器、天空与昼夜、实例化树木、建筑与步行者同步、水墨描边后期
import * as THREE from 'three';
import { N, MARGIN, WATER_Y, DAY_SECONDS, T_GRASS, T_MOUNTAIN, T_WATER } from './config.js';
import { makeBuilding, makeWalker, glowMats } from './models.js';
import { mulberry32 } from './noise.js';
import { Post } from './post.js';
import { Forest, FU, foliageSprite } from './trees.js';
import { FlowLayer } from './flow.js';

const NOISE_GLSL = /* glsl */`
float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tFbm(vec2 p){ float v = 0.0, a = 0.5; for (int k = 0; k < 4; k++){ v += a * tNoise(p); p = p * 2.03 + 13.7; a *= 0.5; } return v; }
`;

const lin = hex => new THREE.Color(hex);
const mixC = (a, b, t) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Renderer {
  constructor(canvas, world, sim) {
    this.world = world;
    this.sim = sim;
    this.size = N + MARGIN * 2;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false; // 阴影每 3 帧更新一次
    r.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 1200);
    this.scene.fog = new THREE.Fog(0xb9c6cc, 50, 175);

    this.hemi = new THREE.HemisphereLight(0x9fb3d0, 0x4a3f2c, 0.8);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.time = 0;
    this.dayTime = 0.31;
    this.dayCycle = true;
    this.ink = true;
    this.paint = true;
    this.shadowExt = 0;

    this.buildTiles();
    this.buildTerrain();
    this.buildWater();
    this.buildSky();
    this.buildTrees();
    this.buildPost();

    this.buildingMeshes = new Map();
    this.walkerMeshes = new Map();
    this.ghostCache = new Map();
    this.ghost = null;
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    world.on('tiles', () => this.updateTiles());
    world.on('trees', () => this.updateTrees());
    world.on('build', b => this.addBuilding(b));
    world.on('update', b => this.addBuilding(b, true));
    world.on('remove', b => this.removeBuilding(b));
    world.on('roads', () => this.reorientHouses());
    world.on('flood', () => this.updateHazards());
    world.on('tiles', () => this.updateHazards());
    this.updateTiles();
    this.updateHazards();
    this.flow = new FlowLayer(this.scene);
  }

  // ---------- 格子数据纹理 ----------
  buildTiles() {
    this.tileData = new Uint8Array(N * N * 4);
    this.tileTex = new THREE.DataTexture(this.tileData, N, N, THREE.RGBAFormat);
    this.tileTex.magFilter = THREE.LinearFilter;
    this.tileTex.minFilter = THREE.LinearFilter;
    this.tileTex.needsUpdate = true;
    this.prevData = new Uint8Array(N * N * 4);
    this.prevTex = new THREE.DataTexture(this.prevData, N, N, THREE.RGBAFormat);
    this.prevTex.magFilter = THREE.NearestFilter;
    this.prevTex.minFilter = THREE.NearestFilter;
    this.prevTex.needsUpdate = true;
    this.prevDirty = [];
    this.hazData = new Uint8Array(N * N * 4);
    this.hazTex = new THREE.DataTexture(this.hazData, N, N, THREE.RGBAFormat);
    this.hazTex.magFilter = this.hazTex.minFilter = THREE.LinearFilter;
    this.hazTex.needsUpdate = true;
  }

  updateHazards() {
    const W = this.world, d = this.hazData;
    for (let k = 0; k < N * N; k++) {
      d[k * 4] = W.flooded && W.flooded[k] ? 255 : 0;
      d[k * 4 + 1] = W.floodRisk && W.floodRisk[k] ? 255 : 0;
    }
    this.hazTex.needsUpdate = true;
  }

  updateTiles() {
    const W = this.world, d = this.tileData;
    for (let k = 0; k < N * N; k++) {
      d[k * 4] = W.road[k] ? 255 : 0;
      d[k * 4 + 1] = 0;
      d[k * 4 + 2] = W.water[k] === 2 ? 255 : W.water[k] === 1 ? 130 : 0;
      d[k * 4 + 3] = Math.round(Math.min(1, Math.max(0, (W.fengshui[k] + 4) / 12)) * 255);
    }
    for (const b of W.buildings.values()) {
      if (b.type !== 'farm' && b.type !== 'mulberry') continue;
      for (const [x, y] of W.footprint(b.i, b.j, b.size)) d[W.idx(x, y) * 4 + 1] = 255;
    }
    this.tileTex.needsUpdate = true;
  }

  setPreview(valid = [], invalid = [], hover = []) {
    const d = this.prevData;
    for (const k of this.prevDirty) { d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 0; }
    this.prevDirty = [];
    const put = (list, ch) => {
      for (const [i, j] of list) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const k = j * N + i;
        d[k * 4 + ch] = 255;
        this.prevDirty.push(k);
      }
    };
    put(valid, 0); put(invalid, 1); put(hover, 2);
    this.prevTex.needsUpdate = true;
  }

  // ---------- 地形 ----------
  buildTerrain() {
    const S = this.size, seg = S * 3;
    const geo = new THREE.PlaneGeometry(S, S, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.world.heightAt(x + N / 2, z + N / 2));
    }
    geo.computeVertexNormals();

    // 高度纹理给河水着色器用（判断水深、岸边白沫）
    const R = S * 2, hd = new Uint8Array(R * R * 4);
    for (let b = 0; b < R; b++) for (let a = 0; a < R; a++) {
      const x = -S / 2 + (a + 0.5) / R * S, z = -S / 2 + (b + 0.5) / R * S;
      const h = this.world.heightAt(x + N / 2, z + N / 2);
      const v = Math.round(Math.min(1, Math.max(0, (h + 1) / 4)) * 255);
      hd.set([v, v, v, 255], (b * R + a) * 4);
    }
    this.heightTex = new THREE.DataTexture(hd, R, R, THREE.RGBAFormat);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;

    this.tu = {
      uTiles: { value: this.tileTex }, uPreview: { value: this.prevTex }, uN: { value: N },
      uOverlay: { value: 0 }, uGrid: { value: 0 }, uTime: { value: 0 }, uHaz: { value: this.hazTex }, uFlood: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.tu);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uTiles; uniform sampler2D uPreview; uniform sampler2D uHaz; uniform float uN, uOverlay, uGrid, uTime, uFlood;
varying vec3 vWPos; varying vec3 vWN;
${NOISE_GLSL}`)
        .replace('#include <color_fragment>', /* glsl */`
{
  vec2 tp = vWPos.xz + uN * 0.5;
  vec2 uvT = tp / uN;
  float inside = step(0.0, tp.x) * step(tp.x, uN) * step(0.0, tp.y) * step(tp.y, uN);
  vec4 T = texture2D(uTiles, uvT);
  float h = vWPos.y;
  float n1 = tFbm(tp * 0.32), n2 = tFbm(tp * 2.6), n3 = tFbm(tp * 0.15 + 7.0);
  vec3 col = mix(vec3(0.16, 0.32, 0.17), vec3(0.30, 0.43, 0.22), smoothstep(0.3, 0.7, n1));
  col *= 0.88 + 0.24 * n2;
  col = mix(col, vec3(0.47, 0.42, 0.22), smoothstep(0.6, 0.78, n3) * 0.55);
  // 河岸与河床
  col = mix(col, vec3(0.58, 0.50, 0.33), smoothstep(-0.06, -0.2, h));
  col = mix(col, vec3(0.25, 0.24, 0.17), smoothstep(-0.35, -0.75, h));
  // 山体：按坡度与高度过渡到岩石，山顶覆雪
  float slope = 1.0 - clamp(vWN.y, 0.0, 1.0);
  float rock = max(smoothstep(0.25, 0.55, slope + n2 * 0.15), smoothstep(1.4, 2.4, h + n1));
  col = mix(col, mix(vec3(0.13, 0.27, 0.30), vec3(0.27, 0.40, 0.38), n2), rock * step(0.06, h));
  col = mix(col, vec3(0.42, 0.36, 0.24), smoothstep(0.5, 0.0, h) * rock * step(0.06, h) * 0.6);
  col = mix(col, vec3(0.16, 0.24, 0.12), smoothstep(0.15, 0.6, h) * (1.0 - rock) * 0.7);
  col = mix(col, vec3(0.36, 0.52, 0.48), smoothstep(2.4, 3.1, h + n2 * 0.5));
  // 田垄
  float soil = smoothstep(0.45, 0.6, T.g) * inside;
  float furrow = 0.5 + 0.5 * sin(tp.x * 3.14159 * 6.0);
  col = mix(col, mix(vec3(0.24, 0.15, 0.08), vec3(0.36, 0.25, 0.13), furrow) * (0.9 + 0.2 * n2), soil);
  // 道路：线性插值的道路遮罩 + 卵石纹理
  float road = smoothstep(0.5, 0.62, T.r);
  float edge = smoothstep(0.36, 0.5, T.r) * (1.0 - road);
  vec2 cb = fract(tp * vec2(3.0, 3.0) + vec2(floor(tp.y * 3.0) * 0.5, 0.0));
  float stone = smoothstep(0.0, 0.14, min(min(cb.x, 1.0 - cb.x), min(cb.y, 1.0 - cb.y)));
  vec3 roadC = mix(vec3(0.46, 0.38, 0.26), vec3(0.56, 0.48, 0.34), n2) * (0.82 + 0.18 * stone);
  col = mix(col, roadC, road);
  col *= 1.0 - edge * 0.3;
  // 叠加图层：水源 / 风水
  if (uOverlay > 0.5 && uOverlay < 1.5) {
    col = mix(col, vec3(0.15, 0.45, 0.95), T.b * 0.6 * inside);
  } else if (uOverlay > 1.5) {
    float f = T.a;
    vec3 fc = f < 0.333 ? mix(vec3(0.75, 0.12, 0.08), vec3(0.95, 0.75, 0.25), f * 3.0) : mix(vec3(0.95, 0.75, 0.25), vec3(0.15, 0.7, 0.35), clamp((f - 0.333) * 1.5, 0.0, 1.0));
    col = mix(col, fc, 0.6 * inside * step(h, 0.3));
  }
  // 汛险图层（斜线）与正在被淹的河滩（浑水 + 波纹）
  vec4 Hz = texture2D(uHaz, uvT) * inside;
  if (uOverlay > 2.5) {
    float hatch = step(0.5, fract((tp.x + tp.y) * 2.0));
    col = mix(col, mix(vec3(0.1, 0.35, 0.95), vec3(0.03, 0.15, 0.6), hatch), Hz.g * 0.72);
  }
  float fl = smoothstep(0.25, 0.6, Hz.r) * uFlood;
  if (fl > 0.0) {
    float rip = 0.5 + 0.5 * sin((tp.x * 2.3 + tp.y * 1.7) * 6.0 - uTime * 2.5 + tFbm(tp * 1.5) * 5.0);
    vec3 muddy = mix(vec3(0.2, 0.27, 0.26), vec3(0.32, 0.36, 0.32), rip);
    muddy += vec3(0.12, 0.14, 0.13) * smoothstep(0.9, 1.0, rip);
    col = mix(col, muddy, fl * 0.88);
  }
  // 网格
  vec2 g = abs(fract(tp) - 0.5);
  float line = smoothstep(0.465, 0.5, max(g.x, g.y));
  col = mix(col, col * 0.62, line * uGrid * inside * step(h, 0.15) * 0.8);
  // 放置预览
  vec4 P = texture2D(uPreview, uvT) * inside;
  float pulse = 0.85 + 0.15 * sin(uTime * 5.0);
  float border = smoothstep(0.38, 0.48, max(g.x, g.y));
  col = mix(col, vec3(0.35, 0.95, 0.45), P.r * (0.35 + 0.4 * border) * pulse);
  col = mix(col, vec3(1.0, 0.22, 0.15), P.g * (0.45 + 0.4 * border) * pulse);
  col = mix(col, vec3(1.0, 0.95, 0.75), P.b * (0.18 + 0.5 * border));
  // 地图以外：降低饱和度与亮度
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(mix(vec3(lum), col, 0.8), col, inside);
  diffuseColor.rgb = col;
}`);
    };
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  // ---------- 河水 ----------
  buildWater() {
    const S = this.size;
    this.wu = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uHeight: { value: null }, uExt: { value: S },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
      uSky: { value: new THREE.Color(0.6, 0.7, 0.8) }, uLight: { value: 1 }, uPaint: { value: 1 },
    }]);
    this.wu.uHeight.value = this.heightTex;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.wu, transparent: true, depthWrite: false, fog: true,
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        varying vec3 vW;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        uniform float uTime, uExt, uLight, uPaint; uniform sampler2D uHeight;
        uniform vec3 uSunDir, uSunCol, uSky;
        varying vec3 vW;
        ${NOISE_GLSL}
        void main(){
          vec2 uv = (vW.xz + uExt * 0.5) / uExt;
          float th = texture2D(uHeight, uv).r * 4.0 - 1.0;
          float depth = vW.y - th;
          if (depth < -0.01) discard;
          vec2 p = vW.xz; float t = uTime;
          vec2 flow = vec2(0.0, -t * 0.35);
          float n = tFbm(p * vec2(1.6, 0.7) + flow);
          vec3 nrm = normalize(vec3(
            0.07 * cos(p.x * 1.7 + t * 1.1 + n * 4.0) + 0.04 * cos((p.x + p.y) * 3.1 + t * 1.9),
            1.0,
            0.07 * cos(p.y * 1.3 - t * 1.4 + n * 3.0) + 0.04 * cos((p.x - p.y) * 2.6 + t * 1.6)));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(nrm, V), 0.0), 3.0);
          vec3 shallow = vec3(0.18, 0.42, 0.40), deep = vec3(0.03, 0.13, 0.18);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 0.55, depth)) * uLight;
          col += vec3(0.04, 0.06, 0.05) * smoothstep(0.55, 0.8, n) * uLight;
          col = mix(col, uSky, clamp(fres * 0.7 + 0.08, 0.0, 1.0));
          vec3 H = normalize(uSunDir + V);
          col += uSunCol * pow(max(dot(nrm, H), 0.0), 140.0) * 2.5;
          float foamBand = 0.5 + 0.5 * sin(depth * 55.0 - t * 2.2 + n * 6.0);
          float foam = smoothstep(0.11, 0.0, depth) * (0.55 + 0.45 * foamBand);
          col = mix(col, vec3(0.85, 0.9, 0.9) * max(uLight, 0.25), foam * 0.75);
          float wl = sin((p.y * 6.5 + sin(p.x * 2.1 + t * 0.5) * 0.7 + tNoise(p * 1.3) * 1.4 - t * 0.7) * 3.14159);
          float wl2 = sin((p.y * 4.3 - p.x * 1.1 + sin(p.x * 3.3 - t * 0.4) * 0.5 - t * 0.45) * 3.14159);
          float lines = max(smoothstep(0.86, 0.99, wl), smoothstep(0.9, 0.995, wl2) * 0.6) * smoothstep(0.02, 0.2, depth) * uPaint;
          col = mix(col, col * 0.5 + vec3(0.01, 0.05, 0.07) * uLight, lines * 0.55);
          col = mix(col, col * vec3(0.85, 1.05, 1.0) + vec3(0.02, 0.05, 0.03) * uLight, uPaint * 0.5);
          float alpha = mix(0.5, 0.93, smoothstep(0.0, 0.45, depth));
          gl_FragColor = vec4(col, max(alpha, foam * 0.9));
          #include <fog_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(S, S, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WATER_Y;
    this.water.renderOrder = 2;
    this.scene.add(this.water);
  }

  // ---------- 天空 ----------
  buildSky() {
    this.su = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      uTime: { value: 0 }, uNight: { value: 0 }, uPaint: { value: 1 },
      uPaper: { value: new THREE.Color(0.92, 0.88, 0.79) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.su, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir, uZenith, uHorizon, uSunCol, uPaper; uniform float uTime, uNight, uPaint;
        varying vec3 vDir;
        ${NOISE_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, h));
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 10.0) * 0.22) * (1.0 - uNight);
          vec3 md = -uSunDir; float mdot = max(dot(d, md), 0.0);
          col += vec3(0.8, 0.85, 1.0) * pow(mdot, 1600.0) * 3.0 * uNight;
          vec2 cp = d.xz / max(h, 0.06) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
          float c = smoothstep(0.52, 0.78, tFbm(cp));
          vec3 cloud = mix(uHorizon * 1.15, vec3(1.0), 0.45) * (1.0 - uNight * 0.85);
          col = mix(col, cloud, c * smoothstep(0.02, 0.25, h) * 0.65);
          vec2 sp = floor(d.xz / max(h, 0.15) * 160.0);
          float star = step(0.9975, tHash(sp)) * uNight * smoothstep(0.08, 0.4, h) * (1.0 - c);
          col += vec3(star) * 1.4;
          if (uPaint > 0.5) {
            // 画意模式输出的是显示空间颜色，后期合成时直接采用
            vec3 paper = mix(uPaper, vec3(0.12, 0.14, 0.2), uNight * 0.85);
            vec3 pc = mix(paper, paper * vec3(0.9, 0.95, 1.02), smoothstep(0.05, 0.8, h));
            pc = mix(pc, pc * vec3(1.03, 0.92, 0.82), (1.0 - uNight) * pow(max(dot(d, uSunDir), 0.0), 6.0) * 0.5);
            float sunDisk = smoothstep(0.9982, 0.9987, dot(d, uSunDir)) * (1.0 - uNight) * step(-0.03, uSunDir.y);
            pc = mix(pc, vec3(0.78, 0.22, 0.13), sunDisk * 0.92);
            pc = mix(pc, vec3(0.92, 0.9, 0.82), smoothstep(0.9992, 0.9995, dot(d, -uSunDir)) * uNight);
            float cl = smoothstep(0.5, 0.82, tFbm(d.xz / max(h, 0.08) * vec2(0.45, 1.3) + vec2(uTime * 0.004, 0.0)));
            pc = mix(pc, pc * 0.88, cl * smoothstep(0.03, 0.3, h));
            float az = atan(d.z, d.x);
            for (int k = 0; k < 3; k++) {
              float fk = float(k);
              vec2 rp = vec2(cos(az), sin(az)) * (2.2 + fk * 1.7) + fk * 7.3;
              float rg = tFbm(rp) * 0.7 + tFbm(rp * 3.1) * 0.3;
              float hk = 0.012 + (0.17 - fk * 0.045) * pow(rg, 1.7);
              float m = smoothstep(hk + 0.002, hk - 0.002, h);
              vec3 mc = mix(vec3(0.14, 0.17, 0.19), paper, 0.72 - fk * 0.24);
              mc = mix(mc, mix(vec3(0.16, 0.3, 0.3), paper, 0.6 - fk * 0.15), 0.35);
              mc = mix(mc, paper, smoothstep(hk - 0.004, hk - 0.11, h) * 0.9);
              pc = mix(pc, mc, m);
            }
            pc = mix(pc, paper, smoothstep(0.004, -0.04, h));
            pc += vec3(star) * 0.8;
            col = pc;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  // ---------- 树木：国画枝干 + 着色器叶团（见 trees.js） ----------
  buildTrees() { this.forest = new Forest(this.scene, this.world); }
  updateTrees() { this.forest.update(); }

  // ---------- 建筑 ----------
  houseFacing(b) {
    const W = this.world;
    const dirs = [[0, 1, 0], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, -1, Math.PI]];
    for (let r = 1; r <= 2; r++) for (const [dx, dz, ry] of dirs) {
      const x = b.i + dx * r, z = b.j + dz * r;
      if (W.inside(x, z) && W.road[W.idx(x, z)]) return ry;
    }
    return 0;
  }

  addBuilding(b, animate = false) {
    const old = this.buildingMeshes.get(b.id);
    if (old) this.scene.remove(old.group);
    const g = makeBuilding(b.type, b.level || 0, b.size);
    const cx = b.i + b.size / 2, cz = b.j + b.size / 2;
    g.position.set(cx - N / 2, Math.max(-0.02, this.world.heightAt(cx, cz)), cz - N / 2);
    if (b.type === 'house') g.rotation.y = this.houseFacing(b);
    // 工位上的工人（人数随在岗比例显示）
    g.userData.workers = (g.userData.spots || []).map((sp, k) => {
      const w = makeWalker(sp.act);
      w.position.set(sp.x, 0, sp.z);
      w.rotation.y = sp.ry;
      w.visible = false;
      w.userData.act = sp.act; w.userData.phase = k * 1.7 + b.id;
      w.traverse(o => { if (o.isMesh) o.castShadow = false; });
      g.add(w);
      return w;
    });
    // 头顶状态印章
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    icon.visible = false; icon.renderOrder = 5;
    icon.userData.h = { house: 0.8, farm: 0.75, temple: 1.45, teahouse: 1.45, firehouse: 1.0, repair: 0.75, levee: 0.5, ruin: 0.5, well: 0.8, garden: 0.7 }[b.type] ?? 1.2;
    g.add(icon);
    g.userData.icon = icon;
    this.scene.add(g);
    // 新建与升级都从小到大“长”出来
    this.buildingMeshes.set(b.id, { group: g, born: this.time - (animate ? 0.1 : 0), b });
    g.scale.setScalar(0.01);
    if (b.type === 'farm' || b.type === 'mulberry') this.updateTiles();
  }

  rebuildAll() {
    for (const m of this.buildingMeshes.values()) this.scene.remove(m.group);
    this.buildingMeshes.clear();
    for (const g of this.walkerMeshes.values()) this.scene.remove(g);
    this.walkerMeshes.clear();
    for (const b of this.world.buildings.values()) this.addBuilding(b);
    this.updateTiles();
    this.updateTrees();
  }

  reorientHouses() {
    for (const { group, b } of this.buildingMeshes.values()) if (b.type === 'house') group.rotation.y = this.houseFacing(b);
  }

  removeBuilding(b) {
    const m = this.buildingMeshes.get(b.id);
    if (m) this.scene.remove(m.group);
    this.buildingMeshes.delete(b.id);
    if (b.type === 'farm' || b.type === 'mulberry') this.updateTiles();
  }

  setGhost(type, i, j, valid) {
    if (!type) { if (this.ghost) this.ghost.visible = false; return; }
    let gh = this.ghostCache.get(type);
    if (!gh) {
      const src = makeBuilding(type, type === 'house' ? 0 : 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0x9fffb0, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.6 });
      src.traverse(o => { if (o.isMesh) { if (o.userData.sprite) o.visible = false; o.material = mat; o.castShadow = false; } });
      src.userData.mat = mat;
      gh = src;
      this.ghostCache.set(type, gh);
      this.scene.add(gh);
    }
    if (this.ghost && this.ghost !== gh) this.ghost.visible = false;
    this.ghost = gh;
    const size = { farm: 3, granary: 2, market: 2, temple: 2, mulberry: 2, silk: 2, kiln: 2, warehouse: 2, teahouse: 2, tradepost: 2 }[type] || 1;
    const cx = i + size / 2, cz = j + size / 2;
    gh.position.set(cx - N / 2, 0.01, cz - N / 2);
    gh.userData.mat.color.set(valid ? 0x9fffb0 : 0xff7766);
    gh.visible = true;
  }

  // ---------- 后期：SSAO + 国画合成（见 post.js） ----------
  buildPost() {
    this.post = new Post(this.renderer, this.camera, N / 2);
    this.pu = this.post.u;
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.post.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- 昼夜 ----------
  updateLighting(target, dist) {
    const a = (this.dayTime - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(a) * 0.8, Math.sin(a), 0.45 + 0.25 * Math.cos(a)).normalize();
    const e = Math.sin(a);
    const dayK = sstep(-0.12, 0.3, e);
    const duskK = sstep(0.4, 0.0, Math.abs(e + 0.05));
    const nightK = 1 - sstep(-0.18, 0.08, e);

    const sunCol = mixC(lin(0xff8a4a), lin(0xfff1dc), sstep(0.02, 0.45, e));
    const isSun = e > -0.02;
    const lightDir = isSun ? sunDir : sunDir.clone().multiplyScalar(-1);
    this.sun.color.copy(isSun ? sunCol : lin(0x8fa6e8));
    this.sun.intensity = isSun ? 2.7 * sstep(-0.02, 0.18, e) : 0.95 * sstep(0.02, 0.25, -e);
    this.hemi.color.copy(mixC(lin(0x41598c), lin(0xa9bcd6), dayK));
    this.hemi.groundColor.copy(mixC(lin(0x1c1a20), lin(0x5a4a30), dayK));
    this.hemi.intensity = 0.8 + 0.3 * dayK;
    this.pu.uExposure.value = 1.0 + 0.35 * (1 - dayK);

    let zenith = mixC(lin(0x060a1a), lin(0x3f78c4), dayK);
    let horizon = mixC(lin(0x121a2e), lin(0xc4d3dc), dayK);
    horizon = mixC(horizon, lin(0xf2955a), duskK * 0.8);
    zenith = mixC(zenith, lin(0x4a4a7a), duskK * 0.4);
    this.su.uSunDir.value.copy(sunDir);
    this.su.uZenith.value.copy(zenith);
    this.su.uHorizon.value.copy(horizon);
    this.su.uSunCol.value.copy(sunCol);
    this.su.uNight.value = nightK;
    this.scene.fog.color.copy(this.paint ? mixC(new THREE.Color(1.1, 0.8, 0.5), lin(0x141a2a), nightK) : horizon);

    this.wu.uSunDir.value.copy(lightDir);
    this.wu.uSunCol.value.copy(this.sun.color).multiplyScalar(this.sun.intensity / 2.7);
    this.wu.uSky.value.copy(mixC(horizon, zenith, 0.4));
    this.wu.uLight.value = 0.3 + 0.7 * dayK;

    for (const m of glowMats) m.emissiveIntensity = 0.1 + 1.7 * nightK;
    FU.uSunDir.value.copy(lightDir);
    FU.uSunCol.value.copy(this.sun.color).multiplyScalar(this.sun.intensity / Math.PI);
    FU.uAmb.value.copy(this.hemi.color).lerp(this.hemi.groundColor, 0.35).multiplyScalar(this.hemi.intensity / Math.PI * 1.15);
    FU.uNight.value = nightK;
    this.pu.uNight.value = nightK;
    this.nightK = nightK;

    // 阴影相机跟随视点
    const ext = Math.min(36, Math.max(12, dist * 0.85));
    this.sun.position.copy(target).addScaledVector(lightDir, 60);
    this.sun.target.position.copy(target);
    if (Math.abs(ext - this.shadowExt) > 0.5) {
      const c = this.sun.shadow.camera;
      c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.near = 1; c.far = 140;
      c.updateProjectionMatrix();
      this.shadowExt = ext;
    }
  }

  // ---------- 每帧 ----------
  pick(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, p)) return null;
    return { i: Math.floor(p.x + N / 2), j: Math.floor(p.z + N / 2), x: p.x, z: p.z };
  }

  render(dt, rig) {
    this.time += dt;
    if (this.dayCycle) this.dayTime = (this.dayTime + dt * this.sim.speed / DAY_SECONDS) % 1;
    this.tu.uTime.value = this.time;
    FU.uTime.value = this.time;
    this.wu.uTime.value = this.time;
    this.su.uTime.value = this.time;
    this.pu.uTime.value = this.time;
    this.pu.uInk.value = this.ink ? 1 : 0;
    this.pu.uPaint.value = this.paint ? 1 : 0;
    this.su.uPaint.value = this.paint ? 1 : 0;
    this.wu.uPaint.value = this.paint ? 1 : 0;
    this.updateLighting(rig.target, rig.dist);
    this.sky.position.copy(this.camera.position);

    this.nearView = rig.dist < 22;
    // 建筑生长动画、农作物
    for (const m of this.buildingMeshes.values()) {
      const age = this.time - m.born;
      const s = age >= 0.45 ? 1 : easeOutBack(age / 0.45);
      m.group.scale.setScalar(Math.max(0.01, s));
      this.syncBuilding(m);
      if (m.b.type === 'farm') {
        const gr = m.b.growth || 0;
        m.group.userData.crops.scale.set(1, 0.12 + 0.88 * gr, 1);
        m.group.userData.cropMat.color.setRGB(0.22 + 0.5 * gr * gr, 0.36 + 0.14 * gr, 0.12 - 0.02 * gr);
      }
    }
    this.syncWalkers();

    this.tu.uFlood.value += ((this.sim.flood ? 1 : 0) - this.tu.uFlood.value) * Math.min(1, dt * 1.5);
    this.flow.update(this.time);
    if ((this.frameNo = (this.frameNo || 0) + 1) % 3 === 1) this.renderer.shadowMap.needsUpdate = true;
    this.post.render(this.scene);
  }

  // ---------- 货堆、工人、状态印章 ----------
  pileCounts(b) {
    const c = (v, per) => Math.ceil(Math.max(0, v - 0.01) / per);
    switch (b.type) {
      case 'granary': return { food: c(b.food, 100) };
      case 'warehouse': return { pottery: c(b.goods.pottery, 25), silk: c(b.goods.silk, 25) };
      case 'market': return { food: c(b.stock.food, 50), pottery: c(b.stock.pottery, 15), silk: c(b.stock.silk, 15) };
      case 'kiln': return { pottery: c(b.out, 10) };
      case 'silk': return { cocoon: c(b.cocoon, 30), silk: c(b.out, 7) };
      case 'farm': case 'mulberry': return { harvest: b.growth >= 1 ? 99 : 0 };
    }
    return {};
  }

  iconTexture(text) {
    this.iconTex ||= new Map();
    if (this.iconTex.has(text)) return this.iconTex.get(text);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const x = cv.getContext('2d');
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const font = `${text.length > 1 ? 40 : 66}px "ZCOOL XiaoWei", "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Songti SC", sans-serif`;
    const draw = () => {
    x.clearRect(0, 0, 128, 128);
    const good = text === '升';
    x.fillStyle = good ? '#2f7a52' : '#b8322a';
    x.beginPath(); x.roundRect ? x.roundRect(8, 8, 112, 112, 18) : x.rect(8, 8, 112, 112); x.fill();
    x.strokeStyle = 'rgba(255,240,225,0.85)'; x.lineWidth = 5;
    x.beginPath(); x.roundRect ? x.roundRect(18, 18, 92, 92, 10) : x.rect(18, 18, 92, 92); x.stroke();
    x.fillStyle = '#fff4e6';
    x.font = font;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (text.length > 1) { x.fillText(text[0], 64, 44); x.fillText(text[1], 64, 86); } else x.fillText(text, 64, 68);
    t.needsUpdate = true;
    };
    draw();
    // 网页字体按需加载：字形到位后重画一次
    if (document.fonts && document.fonts.load) document.fonts.load(font, text).then(draw).catch(() => {});
    this.iconTex.set(text, t);
    return t;
  }

  syncBuilding(m) {
    const b = m.b, ud = m.group.userData;
    if (ud.piles) {
      const counts = this.pileCounts(b);
      for (const key in ud.piles) { const n = counts[key] || 0; ud.piles[key].forEach((p, i) => { p.visible = i < n; }); }
    }
    if (ud.activeOnly) for (const o of ud.activeOnly) o.visible = !!b.active;
    if (ud.workers && ud.workers.length) {
      // 远景不画工人（看不清，省绘制）
      const n = !this.nearView ? 0 : b.staff > 0 ? Math.max(1, Math.round((b.staff / b.need) * ud.workers.length)) : 0;
      const moving = !!b.active && this.sim.speed > 0;
      ud.workers.forEach((w, i) => {
        w.visible = i < n;
        if (!w.visible) return;
        const inner = w.userData.inner, t = this.time * (w.userData.act === 'hoe' || w.userData.act === 'dig' ? 3.2 : 2.4) + w.userData.phase;
        const act = w.userData.act;
        if (!moving) { inner.rotation.set(0, 0, 0); inner.position.y = 0; return; }
        if (act === 'hoe' || act === 'dig') inner.rotation.x = 0.25 + 0.3 * Math.max(0, Math.sin(t));
        else if (act === 'pick' || act === 'bow') inner.rotation.x = 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(t * 0.6));
        else if (act === 'weave' || act === 'stoke') { inner.rotation.x = 0.12; inner.rotation.z = 0.08 * Math.sin(t * 2); }
        else if (act === 'carry' || act === 'serve') { inner.position.y = Math.abs(Math.sin(t * 2)) * 0.015; inner.rotation.y = 0.5 * Math.sin(t * 0.35); }
        else inner.rotation.x = 0.06 * Math.sin(t);
      });
    }
    if (b.burning && !ud.fire) {
      const f = new THREE.Group(), sz = b.size;
      for (let k = 0; k < 6 + sz * 3; k++) {
        const x = (Math.sin(k * 7.3) * 0.3) * sz, z = (Math.cos(k * 4.1) * 0.3) * sz;
        f.add(foliageSprite(6, 0.2 + 0.07 * sz, x, 0.2 + (k % 3) * 0.1, z, false, (k * 0.37) % 1));
      }
      for (let k = 0; k < 4; k++) f.add(foliageSprite(5, 0.26 * sz, 0, 0.7, 0, false, k / 4));
      // 火光：地面一圈橙红辉光
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.55 * sz, 24), new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; f.add(glow);
      m.group.add(f);
      ud.fire = f;
    }
    if (ud.fire) ud.fire.visible = !!b.burning;
    const icon = ud.icon;
    if (icon) {
      const text = b.icon;
      if (text) {
        if (icon.userData.text !== text) { icon.material.map = this.iconTexture(text); icon.material.needsUpdate = true; icon.userData.text = text; }
        icon.visible = true;
        const sc = m.group.scale.x || 1;
        icon.position.set(0, icon.userData.h + Math.sin(this.time * 2.5 + b.id) * 0.03, 0);
        icon.scale.setScalar(0.3 / sc * Math.min(1, sc * 4));
      } else icon.visible = false;
    }
  }

  syncWalkers() {
    const seen = new Set();
    for (const wk of this.sim.walkers) {
      if (wk.dead) continue;
      seen.add(wk.id);
      let g = this.walkerMeshes.get(wk.id);
      if (!g) { g = makeWalker(wk.kind); this.scene.add(g); this.walkerMeshes.set(wk.id, g); }
      const p = this.sim.walkerPose(wk);
      const h = Math.max(0.0, this.world.heightAt(p.x, p.z));
      const bob = Math.abs(Math.sin(this.time * 9 + wk.id)) * 0.02 * (this.sim.speed > 0 ? 1 : 0);
      g.position.set(p.x - N / 2, h, p.z - N / 2);
      g.userData.inner.position.y = bob;
      const ud = g.userData;
      if (ud.cargo) for (const k in ud.cargo) ud.cargo[k].visible = wk.carry > 0 && wk.good === k;
      if (ud.fill) {
        const L = wk.load || {};
        let dom = null, best = 0.5;
        for (const k of ['food', 'pottery', 'silk']) if ((L[k] || 0) > best) { best = L[k]; dom = k; }
        for (const k in ud.fill) ud.fill[k].forEach(f => { f.visible = k === dom; });
      }
      if (p.dx || p.dz) {
        const target = Math.atan2(p.dx, p.dz);
        let d = target - g.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        g.rotation.y += d * 0.3;
      }
    }
    for (const [id, g] of this.walkerMeshes) {
      if (!seen.has(id)) { this.scene.remove(g); this.walkerMeshes.delete(id); }
    }
  }
}

function easeOutBack(t) { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
