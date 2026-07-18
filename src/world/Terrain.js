import * as THREE from 'three';
import { Noise, terrainH, terrainSlope, sstep } from '../core/math.js';

/* ============================================================
   Terrain — a single vertex-colored mesh driven by terrainH(),
   plus a baked half-float height map the water shader samples
   for depth-based color and foam.
   ============================================================ */

export const HMAP_EXT = 170;        // height map covers +/- this many metres
const HMAP_RES = 1024;

export function buildHeightMap() {
  const data = new Uint16Array(HMAP_RES * HMAP_RES);
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < HMAP_RES; j++) {
    const z = (j / (HMAP_RES - 1) * 2 - 1) * HMAP_EXT;
    for (let i = 0; i < HMAP_RES; i++) {
      const x = (i / (HMAP_RES - 1) * 2 - 1) * HMAP_EXT;
      data[j * HMAP_RES + i] = toHalf(terrainH(x, z));
    }
  }
  const tex = new THREE.DataTexture(data, HMAP_RES, HMAP_RES, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function makeDetailTexture() {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(s, s);
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const n = 0.74 + 0.26 * (Noise.fbm(i * 0.06, j * 0.06, 4) * 0.5 + 0.5);
    const v = Math.min(1, Math.max(0, n)) * 255;
    const k = (j * s + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function buildTerrain(mobile) {
  const TER_SIZE = 1100, TER_SEG = mobile ? 300 : 400;
  const geo = new THREE.PlaneGeometry(TER_SIZE, TER_SIZE, TER_SEG, TER_SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(),
    sand = new THREE.Color(0x9d8d68), grassA = new THREE.Color(0x40682c),
    grassB = new THREE.Color(0x6f9440), forest = new THREE.Color(0x39512c),
    rock = new THREE.Color(0x77746c), rockB = new THREE.Color(0x5d5b55),
    snow = new THREE.Color(0xe8edf2), bed = new THREE.Color(0x6e6552);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainH(x, z);
    pos.setY(i, h);
    const sl = terrainSlope(x, z);
    const n = Noise.fbm(x * 0.02 + 11, z * 0.02 - 5, 3) * 0.5 + 0.5;
    if (h < 0.3) {
      c.copy(bed).lerp(sand, sstep(-2.2, 0.3, h));
      c.multiplyScalar(0.85 + 0.3 * n);
    } else {
      c.copy(grassA).lerp(grassB, n);
      c.lerp(forest, sstep(0.35, 0.7, Noise.fbm(x * 0.011 - 3, z * 0.011 + 8, 3) * 0.5 + 0.5) * 0.8);
      c.lerp(sand, sstep(1.9, 0.4, h));
      const rocky = sstep(0.55, 1.05, sl);
      c.lerp(n > 0.5 ? rock : rockB, rocky);
      c.lerp(n > 0.5 ? rock : rockB, sstep(52, 78, h) * 0.9);
      const snowLine = 62 + Noise.fbm(x * 0.03, z * 0.03, 2) * 10;
      c.lerp(snow, sstep(snowLine, snowLine + 14, h) * sstep(1.3, 0.7, sl));
      c.multiplyScalar(0.85 + 0.28 * n);
      c.multiplyScalar(0.92 + 0.16 * (Noise.fbm(x * 0.13 + 3, z * 0.13 - 7, 2) * 0.5 + 0.5));
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0.0, map: makeDetailTexture(),
  });
  mat.map.repeat.set(420, 420);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
