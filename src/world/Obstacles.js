/* ============================================================
   Obstacles — a uniform-grid field of the solid props the
   Environment scatters (tree trunks, big rocks). Two radii per
   entry: rCol is the hard body pushed against by player/enemy
   movement, rClear is the wider footprint (canopy) that spawn
   placement must stay out of.
   ============================================================ */

const CELL = 8;

export class ObstacleField {
  constructor() {
    this.items = [];              // { x, z, rCol, rClear }
    this.grid = new Map();        // "cx,cz" -> indices into items
    this.maxClear = 0;
  }

  add(x, z, rCol, rClear) {
    const idx = this.items.length;
    this.items.push({ x, z, rCol, rClear });
    this.maxClear = Math.max(this.maxClear, rClear);
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let bucket = this.grid.get(key);
    if (!bucket) this.grid.set(key, bucket = []);
    bucket.push(idx);
  }

  /* visit every obstacle whose center could be within `reach` of (x,z) */
  _each(x, z, reach, fn) {
    const c0x = Math.floor((x - reach) / CELL), c1x = Math.floor((x + reach) / CELL);
    const c0z = Math.floor((z - reach) / CELL), c1z = Math.floor((z + reach) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const bucket = this.grid.get(`${cx},${cz}`);
      if (!bucket) continue;
      for (const i of bucket) if (fn(this.items[i]) === false) return false;
    }
    return true;
  }

  /* true if a circle of `radius` at (x,z) overlaps no obstacle's clear footprint */
  isClear(x, z, radius) {
    return this._each(x, z, radius + this.maxClear, (o) => {
      const dx = x - o.x, dz = z - o.z, rr = o.rClear + radius;
      return dx * dx + dz * dz >= rr * rr;   // false aborts the walk = blocked
    });
  }

  /* push a circle of `radius` at (x,z) out of all hard bodies; returns {x,z} */
  collideCircle(x, z, radius, out) {
    out.x = x; out.z = z;
    this._each(x, z, radius + this.maxClear, (o) => {
      if (o.rCol <= 0) return;
      const dx = out.x - o.x, dz = out.z - o.z;
      const rr = o.rCol + radius, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return;
      const d = Math.sqrt(d2);
      if (d > 1e-4) { out.x = o.x + (dx / d) * rr; out.z = o.z + (dz / d) * rr; }
      else { out.x = o.x + rr; }             // dead-center: push along +x
    });
    return out;
  }

  /* nearest clear spot to (x,z): spiral outward in rings until one is found.
     `valid(x,z)` lets callers add terrain constraints (e.g. stay on land). */
  findClear(x, z, radius, maxDist = 30, valid = null) {
    const ok = (px, pz) => this.isClear(px, pz, radius) && (!valid || valid(px, pz));
    if (ok(x, z)) return { x, z };
    for (let r = 2; r <= maxDist; r += 2) {
      const steps = Math.max(8, Math.floor(r * 2));
      const a0 = Math.random() * Math.PI * 2;
      for (let i = 0; i < steps; i++) {
        const a = a0 + (i / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (ok(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };   // world is packed here; give up rather than fail
  }
}
