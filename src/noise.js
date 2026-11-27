// 可复现的随机数与值噪声
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Float32Array(512 * 512);
  for (let i = 0; i < perm.length; i++) perm[i] = rand();
  const lattice = (x, y) => perm[((y & 511) << 9) | (x & 511)];
  const smooth = t => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = smooth(x - xi), fy = smooth(y - yi);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, oct = 4) {
    let v = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < oct; i++) {
      v += amp * noise(x, y);
      norm += amp;
      x = x * 2.03 + 17.1; y = y * 2.03 + 9.7;
      amp *= 0.5;
    }
    return v / norm;
  }
  return { noise, fbm, rand };
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
