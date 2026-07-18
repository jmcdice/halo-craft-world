/* ============================================================
   math.js — shared scalar utils + seeded simplex noise +
   the procedural terrain height field.

   The SAME terrainH() feeds three consumers so they agree:
     - the terrain mesh geometry
     - the water shader's depth (via a baked height map texture)
     - the player / enemy ground collision
   ============================================================ */

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

export const WATER_LEVEL = 0.0;

/* ---------------- 2D simplex noise (seeded, deterministic) ---------------- */
export const Noise = (() => {
  const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const p = new Uint8Array(256); let seed = 20260717;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm8 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm8[i] = perm[i] % 8; }
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  function n2(x, y) {
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255; let n = 0, tt;
    tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { tt *= tt; const g = grad[pm8[ii + perm[jj]]]; n += tt * tt * (g[0] * x0 + g[1] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { tt *= tt; const g = grad[pm8[ii + i1 + perm[jj + j1]]]; n += tt * tt * (g[0] * x1 + g[1] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { tt *= tt; const g = grad[pm8[ii + 1 + perm[jj + 1]]]; n += tt * tt * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  }
  function fbm(x, y, oct) { let a = .5, f = 1, s = 0, n = 0; for (let k = 0; k < oct; k++) { s += a * n2(x * f, y * f); n += a; a *= .5; f *= 2.03; } return s / n; }
  function ridged(x, y, oct) { let a = .5, f = 1, s = 0, n = 0; for (let k = 0; k < oct; k++) { s += a * (1 - Math.abs(n2(x * f, y * f))); n += a; a *= .5; f *= 2.13; } return s / n; }
  return { n2, fbm, ridged };
})();

/* ---------------- terrain height field ---------------- */
export function terrainH(x, z) {
  const r = Math.hypot(x, z);
  const n1 = Noise.fbm(x * 0.008 + 7.3, z * 0.008 - 2.1, 3);   // shoreline wobble
  const shoreR = 62 + n1 * 24;
  const d = r - shoreR;                                        // >0: land side
  const mMask = sstep(110, 400, d);                            // mountain mask
  const ridge = Noise.ridged(x * 0.0022 + 3.7, z * 0.0022 + 9.2, 5);
  let land = 3 + Noise.fbm(x * 0.005, z * 0.005, 4) * 10 + d * 0.12;
  land += Math.pow(ridge, 1.7) * 145 * mMask;
  land += Noise.ridged(x * 0.009 + 1.3, z * 0.009 - 4.2, 4) * 24 * mMask;
  land += Noise.fbm(x * 0.04, z * 0.04, 3) * 1.6 * (1 - mMask);
  if (d < 60) land = Math.min(Math.max(land, 2.0 + d * 0.09), 3.6 + d * 0.13);  // gentle lakeshore
  const floor = -1.2 - 9 * sstep(0, -45, d) + Noise.fbm(x * 0.05, z * 0.05, 2) * 0.8;
  const t = sstep(6, -14, d);
  return lerp(land, floor, t);
}

export function terrainSlope(x, z) {
  const e = 1.2, h = terrainH(x, z);
  return Math.hypot(terrainH(x + e, z) - h, terrainH(x, z + e) - h) / e;
}

/* surface normal at a point (for slope-aware placement / step handling) */
export function terrainNormal(x, z, out) {
  const e = 1.0;
  const hL = terrainH(x - e, z), hR = terrainH(x + e, z);
  const hD = terrainH(x, z - e), hU = terrainH(x, z + e);
  out.set(hL - hR, 2 * e, hD - hU).normalize();
  return out;
}

/* radius of the shoreline (terrain crosses the water plane) along an angle */
export function shoreRadiusAt(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  let lo = 20, hi = 160;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (terrainH(c * mid, s * mid) > WATER_LEVEL) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
