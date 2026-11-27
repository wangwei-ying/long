// 程序化材质细节：往 MeshStandardMaterial 里注入纹样与凹凸（瓦垄、草茎、木纹、夯土层、砖缝、石板、彩画、窗棂）
// 屋顶用几何体局部坐标（屋脊沿 X），其余用世界坐标三向投影，保证各建筑纹理密度一致
import * as THREE from 'three';

export const NOISE_GLSL = /* glsl */`
float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tFbm(vec2 p){ float v = 0.0, a = 0.5; for (int k = 0; k < 4; k++){ v += a * tNoise(p); p = p * 2.03 + 13.7; a *= 0.5; } return v; }
`;

const HELPERS = /* glsl */`
varying vec3 vDLocal; varying vec3 vDWorld; varying vec3 vDWN; varying vec2 vRoof;
${NOISE_GLSL}
vec2 roofCoord(){ return (abs(vRoof.x) + abs(vRoof.y) > 1e-5) ? vec2(vRoof.x, vRoof.y) : vec2(vDLocal.x, abs(vDLocal.z)); }
vec2 triUV(vec3 p, vec3 n){ vec3 a = abs(n); if (a.y > a.x && a.y > a.z) return p.xz; if (a.x > a.z) return p.zy; return p.xy; }
vec3 dBump(vec3 p, vec3 n, float h, float fd){
  vec3 sx = dFdx(p), sy = dFdy(p);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * n - g);
}
`;

// 每种材质：设置 diffuseColor.rgb、凹凸高度 dH、粗糙度系数 dRough、窗棂遮罩 dBar
const KINDS = {
  tile: /* glsl */`
    vec2 rc = roofCoord();
    float u = rc.x * 15.0;
    float row = 0.5 + 0.5 * cos(6.2832 * u);
    float s = rc.y * 17.0 + tNoise(vec2(floor(u + 0.5), 3.0)) * 0.6;
    float course = smoothstep(0.0, 0.3, fract(s));
    float id = tHash(vec2(floor(u + 0.5), floor(s)));
    dH = row * 0.7 + course * 0.3;
    diffuseColor.rgb *= 0.55 + 0.35 * row + 0.12 * course + (id - 0.5) * 0.14;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.95, 0.8), smoothstep(0.55, 0.8, tFbm(vDWorld.xz * 3.0)) * 0.6);
    dRough = 0.9 + 0.2 * (1.0 - row);`,
  glaze: /* glsl */`
    vec2 rc = roofCoord();
    float u = rc.x * 15.0;
    float row = 0.5 + 0.5 * cos(6.2832 * u);
    float s = rc.y * 17.0;
    float course = smoothstep(0.0, 0.3, fract(s));
    dH = row * 0.7 + course * 0.3;
    diffuseColor.rgb *= 0.62 + 0.38 * row * (0.75 + 0.25 * course);
    dRough = 0.55 + 0.6 * (1.0 - row);`,
  thatch: /* glsl */`
    vec2 rc = roofCoord();
    float s = rc.y;
    vec2 q = vec2(rc.x * 70.0 + tNoise(vec2(s * 9.0, rc.x * 4.0)) * 3.0, s * 5.0);
    float str = tNoise(q) * 0.6 + tNoise(q * vec2(2.3, 1.7) + 3.1) * 0.4;
    float band = smoothstep(0.0, 0.35, fract(s * 13.0 + tNoise(vec2(rc.x * 6.0, 1.0)) * 0.4));
    dH = str * 0.7 + band * 0.5;
    diffuseColor.rgb *= (0.62 + 0.5 * str) * (0.78 + 0.22 * band);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25, 0.22, 0.14), smoothstep(0.6, 0.85, tFbm(vDWorld.xz * 4.0)) * 0.35);`,
  wood: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    float pk = uv.x * 16.0;
    float f = fract(pk);
    float seam = smoothstep(0.0, 0.07, f) * smoothstep(1.0, 0.93, f);
    float grain = tNoise(vec2(uv.x * 110.0 + tNoise(uv * vec2(6.0, 1.5)) * 5.0, uv.y * 5.0));
    float id = tHash(vec2(floor(pk), 1.0));
    dH = seam * 0.8 + grain * 0.25;
    diffuseColor.rgb *= (0.72 + 0.28 * grain) * (0.55 + 0.45 * seam) * (0.85 + 0.3 * id);`,
  timber: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    float grain = tNoise(vec2(uv.x * 120.0 + tNoise(uv * 4.0) * 4.0, uv.y * 6.0));
    float wear = smoothstep(0.55, 0.8, tFbm(uv * 9.0));
    dH = grain * 0.2;
    diffuseColor.rgb *= 0.88 + 0.16 * grain;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.12, 0.08), wear * 0.45);`,
  plaster: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    float st = tFbm(uv * 4.0 + 5.0);
    float grime = smoothstep(0.2, 0.0, vDWorld.y) * (0.6 + 0.4 * tNoise(vec2(uv.x * 25.0, 0.0)));
    float streak = smoothstep(0.6, 0.9, tNoise(vec2(uv.x * 40.0, uv.y * 1.5))) * smoothstep(0.1, 0.4, vDWorld.y) * 0.35;
    dH = st * 0.15;
    diffuseColor.rgb *= 0.93 + 0.09 * st;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.42, 0.34), grime * 0.55 + streak);`,
  earth: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    float ly = uv.y * 18.0 + tNoise(vec2(uv.x * 6.0, 0.0)) * 0.5;
    float layer = smoothstep(0.0, 0.18, fract(ly));
    float n = tFbm(uv * 14.0);
    dH = layer * 0.6 + n * 0.3;
    diffuseColor.rgb *= (0.78 + 0.22 * layer) * (0.85 + 0.3 * n) * (0.92 + 0.16 * tHash(vec2(floor(ly), 2.0)));`,
  stone: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    vec2 b = uv * vec2(7.0, 13.0);
    b.x += step(1.0, mod(floor(b.y), 2.0)) * 0.5;
    vec2 f = fract(b);
    float mortar = smoothstep(0.0, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    float id = tHash(floor(b));
    float n = tFbm(uv * 20.0);
    dH = mortar * 0.8 + n * 0.2;
    diffuseColor.rgb *= (0.6 + 0.4 * mortar) * (0.82 + 0.3 * id) * (0.9 + 0.2 * n);`,
  paving: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    vec2 b = uv * 6.5;
    b.x += step(1.0, mod(floor(b.y), 2.0)) * 0.35;
    vec2 f = fract(b);
    float seam = smoothstep(0.0, 0.06, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    float id = tHash(floor(b));
    dH = seam * 0.8;
    diffuseColor.rgb *= (0.62 + 0.38 * seam) * (0.85 + 0.28 * id);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.3, 0.12), (1.0 - seam) * 0.5 * smoothstep(0.45, 0.7, tFbm(uv * 3.0)));`,
  painted: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    float seg = fract(uv.x * 5.0);
    vec3 col = mix(vec3(0.06, 0.2, 0.3), vec3(0.08, 0.3, 0.18), step(0.5, seg));
    vec2 c = vec2(fract(uv.x * 10.0) - 0.5, (fract(uv.y * 10.0) - 0.5) * 1.6);
    float ring = smoothstep(0.06, 0.02, abs(length(c) - 0.28));
    float rim = smoothstep(0.08, 0.0, min(seg, 1.0 - seg)) + smoothstep(0.08, 0.0, abs(seg - 0.5));
    col = mix(col, vec3(0.75, 0.55, 0.18), max(ring, rim * 0.8));
    col = mix(col, vec3(0.85, 0.82, 0.7), smoothstep(0.1, 0.0, abs(length(c) - 0.12)) * 0.8);
    diffuseColor.rgb = col;
    dH = ring * 0.3;`,
  bark: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    float cr = tNoise(vec2(uv.x * 70.0, uv.y * 9.0 + tNoise(uv * 25.0) * 2.0));
    float crack = smoothstep(0.6, 0.8, cr);
    float sc = tNoise(uv * vec2(40.0, 22.0));
    dH = (1.0 - crack) * 0.8 + sc * 0.3;
    diffuseColor.rgb *= (0.7 + 0.4 * sc) * (1.0 - crack * 0.65);`,
  lattice: /* glsl */`
    vec2 uv = triUV(vDWorld, vDWN);
    vec2 g = abs(fract(uv * 42.0) - 0.5);
    dBar = smoothstep(0.32, 0.38, max(g.x, g.y));
    diffuseColor.rgb = mix(vec3(0.8, 0.74, 0.6), vec3(0.3, 0.12, 0.08), dBar);
    dH = dBar * 0.4;`,
};

const STRENGTH = { bark: 0.006, tile: 0.012, glaze: 0.012, thatch: 0.018, wood: 0.006, timber: 0.002, plaster: 0.002, earth: 0.008, stone: 0.008, paving: 0.006, painted: 0.002, lattice: 0.004 };

export function applyDetail(mat, kind) {
  const code = KINDS[kind];
  if (!code) return mat;
  mat.customProgramCacheKey = () => 'detail-' + kind;
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoof; varying vec2 vRoof; varying vec3 vDLocal; varying vec3 vDWorld; varying vec3 vDWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDLocal = position;
        vRoof = aRoof;
        vec4 dWp = vec4(transformed, 1.0);
        vec3 dN = objectNormal;
        #ifdef USE_INSTANCING
          dWp = instanceMatrix * dWp;
          dN = mat3(instanceMatrix) * dN;
        #endif
        vDWorld = (modelMatrix * dWp).xyz;
        vDWN = normalize(mat3(modelMatrix) * dN);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HELPERS)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dH = 0.0; float dRough = 1.0; float dBar = 0.0;
        { ${code} }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor * dRough, 0.05, 1.0);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n normal = dBump(-vViewPosition, normal, dH * ${STRENGTH[kind].toFixed(4)}, faceDirection);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= (1.0 - dBar);');
  };
  return mat;
}
