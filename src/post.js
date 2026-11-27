// 后期：半分辨率 SSAO → 合成（笔触勾线、颜料设色、长卷式设色→水墨→留白、宣纸纹理、灯火辉光、色调映射）
import * as THREE from 'three';
import { NOISE_GLSL } from './materials.js';

const FULLSCREEN_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class Post {
  constructor(renderer, camera, mapHalf) {
    this.r = renderer;
    this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.rt.depthTexture = new THREE.DepthTexture(4, 4);
    this.aoRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);

    this.aoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: this.rt.depthTexture }, uRes: { value: new THREE.Vector2(2, 2) },
        uProj: { value: camera.projectionMatrix }, uProjInv: { value: camera.projectionMatrixInverse },
        uRadius: { value: 0.45 },
      },
      depthTest: false, depthWrite: false, vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tDepth; uniform vec2 uRes; uniform mat4 uProj, uProjInv; uniform float uRadius;
        varying vec2 vUv;
        vec3 viewPos(vec2 uv){ float z = texture2D(tDepth, uv).r; vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          float z0 = texture2D(tDepth, vUv).r;
          if (z0 >= 1.0) { gl_FragColor = vec4(1.0); return; }
          vec3 P = viewPos(vUv);
          vec2 px = 1.0 / uRes;
          vec3 N = normalize(cross(viewPos(vUv + vec2(px.x, 0.0)) - P, viewPos(vUv + vec2(0.0, px.y)) - P));
          float rs = uRadius * uProj[1][1] / -P.z * 0.5;
          float aspect = uRes.y / uRes.x;
          float ang = hash(vUv * uRes) * 6.2832;
          float occ = 0.0;
          for (int i = 0; i < 12; i++) {
            float fi = float(i);
            float rr = (fi + 0.5) / 12.0;
            float a = ang + fi * 2.39996;
            vec2 off = vec2(cos(a) * aspect, sin(a)) * rr * rs;
            vec3 d = viewPos(vUv + off) - P;
            float dist = length(d);
            occ += max(dot(N, d / max(dist, 1e-4)) - 0.12, 0.0) * (1.0 - smoothstep(uRadius * 0.6, uRadius * 1.6, dist));
          }
          gl_FragColor = vec4(vec3(clamp(1.0 - occ / 12.0 * 1.8, 0.0, 1.0)), 1.0);
        }`,
    });

    this.u = {
      tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, tAO: { value: this.aoRT.texture },
      uRes: { value: new THREE.Vector2(4, 4) }, uProjInv: { value: camera.projectionMatrixInverse }, uViewInv: { value: camera.matrixWorld },
      uInk: { value: 1 }, uPaint: { value: 1 }, uTime: { value: 0 }, uExposure: { value: 1 }, uNight: { value: 0 },
      uMapHalf: { value: mapHalf }, uPaper: { value: new THREE.Color(0.92, 0.88, 0.79) },
    };
    this.compMat = new THREE.ShaderMaterial({
      uniforms: this.u, depthTest: false, depthWrite: false, vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tColor, tDepth, tAO; uniform vec2 uRes; uniform mat4 uProjInv, uViewInv;
        uniform float uInk, uPaint, uTime, uExposure, uNight, uMapHalf; uniform vec3 uPaper;
        varying vec2 vUv;
        ${NOISE_GLSL}
        vec3 viewPos(vec2 uv){ float z = texture2D(tDepth, uv).r; vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
        float invD(vec2 uv){ return 1.0 / max(-viewPos(uv).z, 1e-4); }
        vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        void main(){
          vec2 px = 1.0 / uRes;
          vec2 sc = vUv * vec2(uRes.x / uRes.y, 1.0);
          // 手绘抖动：低频噪声轻微扭曲采样坐标
          vec2 wob = (vec2(tNoise(sc * 22.0 + 3.1), tNoise(sc * 22.0 + 7.7)) - 0.5) * px * 3.0 * uPaint;
          vec2 uv = vUv + wob;
          vec3 c = texture2D(tColor, uv).rgb;
          float z = texture2D(tDepth, uv).r;
          bool sky = z >= 0.99999;
          vec3 V = viewPos(uv);
          vec3 W = (uViewInv * vec4(V, 1.0)).xyz;
          float dist = -V.z;

          // 环境光遮蔽（简单模糊）
          vec2 apx = px * 2.0;
          float ao = (texture2D(tAO, uv).r * 2.0 + texture2D(tAO, uv + vec2(apx.x, 0.0)).r + texture2D(tAO, uv - vec2(apx.x, 0.0)).r
                    + texture2D(tAO, uv + vec2(0.0, apx.y)).r + texture2D(tAO, uv - vec2(0.0, apx.y)).r) / 6.0;
          if (!sky) c *= mix(vec3(1.0), mix(vec3(0.5, 0.56, 0.68), vec3(1.0), ao), 0.75);

          // 辉光：灯笼与窗户
          vec3 glow = vec3(0.0);
          float rot = tHash(vUv * uRes) * 6.2832;
          for (int k = 0; k < 12; k++) {
            float a = float(k) * 2.39996 + rot, r = 2.0 + float(k) * 0.9;
            glow += max(texture2D(tColor, vUv + vec2(cos(a), sin(a)) * r * px).rgb - 1.0, 0.0);
          }
          c += min(glow, vec3(6.0)) * (0.03 + 0.05 * uNight);

          // 勾线：逆深度拉普拉斯，轮廓（不连续）粗重，转折（折角）轻细；线宽随噪声起伏
          float lw = 1.0 + (0.6 + 0.8 * tNoise(sc * 9.0)) * uPaint;
          float w0 = 1.0 / max(dist, 1e-4);
          float lap = abs(invD(uv + vec2(px.x * lw, 0.0)) + invD(uv - vec2(px.x * lw, 0.0)) + invD(uv + vec2(0.0, px.y * lw)) + invD(uv - vec2(0.0, px.y * lw)) - 4.0 * w0) / w0;
          float sil = smoothstep(0.02, 0.07, lap);
          float crease = smoothstep(0.0025, 0.009, lap) * 0.45 * uPaint;
          float fade = 1.0 - smoothstep(45.0, 110.0, dist);
          float dry = 0.55 + 0.45 * smoothstep(0.25, 0.6, tNoise(sc * vec2(60.0, 14.0)));
          float edge = max(sil, crease) * fade * mix(1.0, dry, uPaint) * uInk;

          vec3 raw = c;
          c = aces(c * uExposure);
          c = pow(c, vec3(1.0 / 2.2));
          if (sky) c = mix(c, raw, uPaint);

          // 颜料设色：暗部偏石青，亮部偏暖，略降饱和，柔和分阶
          float L = dot(c, vec3(0.299, 0.587, 0.114));
          vec3 graded = c * mix(vec3(0.82, 0.92, 1.06), vec3(1.05, 1.0, 0.9), smoothstep(0.15, 0.75, L));
          graded = mix(vec3(L), graded, 0.8);
          float Lq = (floor(L * 5.0) + smoothstep(0.35, 0.65, fract(L * 5.0))) / 5.0;
          graded *= mix(1.0, Lq / max(L, 1e-3), 0.25);
          graded = pow(graded, vec3(0.84)) * mix(vec3(1.0), uPaper, 0.22) + uPaper * 0.035;
          float gran = tFbm(sc * 260.0);
          graded *= 1.0 - (gran - 0.5) * 0.16 * (1.0 - L);
          c = mix(c, graded, uPaint);

          vec3 ink = vec3(0.12, 0.11, 0.1);
          c = mix(c, ink, edge * 0.85);

          // 长卷构图：地图外渐入水墨，再淡入留白
          vec3 paper = mix(uPaper, vec3(0.13, 0.15, 0.21), uNight * 0.85);
          if (!sky) {
            float dOut = max(max(abs(W.x), abs(W.z)) - uMapHalf, 0.0);
            dOut += (tFbm(W.xz * 0.15) - 0.5) * 5.0;
            float washK = smoothstep(0.5, 6.0, dOut) * uPaint;
            float Lw = dot(c, vec3(0.299, 0.587, 0.114));
            vec3 wash = mix(ink * 1.3, paper * 0.96, smoothstep(0.08, 0.7, Lw));
            c = mix(c, wash, washK);
            c = mix(c, paper, smoothstep(7.0, 15.0, dOut) * uPaint);
            c = mix(c, paper, smoothstep(55.0, 140.0, dist) * 0.7 * uPaint);
          }

          // 宣纸纹理与卷轴暗角
          float fiber = tFbm(sc * vec2(420.0, 90.0)) * 0.6 + tFbm(sc * vec2(80.0, 300.0)) * 0.4;
          c *= mix(1.0, 0.95 + 0.07 * fiber, uPaint);
          vec2 q = vUv - 0.5;
          c *= 1.0 - dot(q, q) * mix(0.55, 0.4, uPaint);
          c = mix(c, c * vec3(1.0, 0.97, 0.9), smoothstep(0.15, 0.5, length(q)) * 0.5 * uPaint);
          c += (tHash(vUv * uRes + fract(uTime) * 91.0) - 0.5) * 0.015;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
  }

  setSize(w, h) {
    this.rt.setSize(w, h);
    const aw = Math.max(1, Math.floor(w / 2)), ah = Math.max(1, Math.floor(h / 2));
    this.aoRT.setSize(aw, ah);
    this.aoMat.uniforms.uRes.value.set(aw, ah);
    this.u.uRes.value.set(w, h);
  }

  render(scene) {
    const r = this.r;
    r.setRenderTarget(this.rt);
    r.render(scene, this.camera);
    this.quad.material = this.aoMat;
    r.setRenderTarget(this.aoRT);
    r.render(this.scene, this.cam);
    this.quad.material = this.compMat;
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
