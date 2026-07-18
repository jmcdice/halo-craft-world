import * as THREE from 'three';

/* ============================================================
   Dropship — Covenant Phantom-style troop delivery. Instead of
   enemies popping into existence, a dropship sweeps in from
   over the lake, hovers above the drop point, beams troops down
   through a glowing gravity lift, then banks away and leaves.

   deliver() is fire-and-forget; the enemies are spawned at the
   moment the beam fires (so kill-credit tagging still applies).
   ============================================================ */

const APPROACH_TIME = 4.5;
const DROP_TIME = 2.6;
const DEPART_TIME = 3.5;
const HOVER_H = 15;

function buildShip() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x574a78, roughness: 0.35, metalness: 0.75 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x8a5cff, emissive: 0x7a4fd0, emissiveIntensity: 2.4, roughness: 0.3 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 5.2, 6, 12), hull);
  body.rotation.z = Math.PI / 2; body.castShadow = true; g.add(body);
  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 4.2, 4, 8), hull);
  spine.rotation.z = Math.PI / 2; spine.position.y = 1.0; g.add(spine);
  // side nacelles
  [-1, 1].forEach(s => {
    const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 2.6, 4, 8), hull);
    nac.rotation.z = Math.PI / 2; nac.position.set(-0.6, -0.2, s * 2.2); g.add(nac);
    const engine = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), glowMat);
    engine.position.set(-2.2, -0.2, s * 2.2); g.add(engine);
  });
  // cockpit glow strip
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 0.9), glowMat);
  strip.position.set(2.6, 0.25, 0); g.add(strip);
  const light = new THREE.PointLight(0x9a6cff, 14, 40, 2);
  light.position.y = -1.5; g.add(light);
  g.userData.light = light;
  return g;
}

function buildBeam() {
  const geo = new THREE.CylinderGeometry(1.6, 2.4, HOVER_H, 12, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xb08cff, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

class Delivery {
  constructor(scene, world, target, dropFn, onDone) {
    this.scene = scene; this.world = world;
    this.dropFn = dropFn; this.onDone = onDone;
    this.phase = 'in'; this.t = 0; this.dropped = false;

    const groundY = Math.max(world.heightAt(target.x, target.z), world.waterLevel);
    this.hover = new THREE.Vector3(target.x, groundY + HOVER_H, target.z);

    // approach from over the lake: radially outward-in through the target
    const r = Math.max(Math.hypot(target.x, target.z), 1);
    const dir = { x: target.x / r, z: target.z / r };
    this.from = new THREE.Vector3(target.x - dir.x * 260, this.hover.y + 46, target.z - dir.z * 260);
    this.away = new THREE.Vector3(target.x + dir.x * 90, this.hover.y + 70, target.z + dir.z * 90).clampLength(0, 400);

    this.ship = buildShip();
    this.ship.position.copy(this.from);
    this.beam = buildBeam();
    this.beam.position.set(target.x, groundY + HOVER_H / 2, target.z);
    this.beam.visible = false;
    scene.add(this.ship, this.beam);
  }

  update(dt, time) {
    this.t += dt;
    const ease = (k) => k * k * (3 - 2 * k);   // smoothstep

    if (this.phase === 'in') {
      const k = ease(Math.min(this.t / APPROACH_TIME, 1));
      this.ship.position.lerpVectors(this.from, this.hover, k);
      this.ship.rotation.z = Math.sin(k * Math.PI) * -0.12;   // bank on approach
      this._face(this.hover.x - this.from.x, this.hover.z - this.from.z);
      if (this.t >= APPROACH_TIME) { this.phase = 'drop'; this.t = 0; this.beam.visible = true; }
    } else if (this.phase === 'drop') {
      const k = Math.min(this.t / DROP_TIME, 1);
      this.ship.position.y = this.hover.y + Math.sin(time * 0.0016) * 0.5;
      this.beam.material.opacity = 0.35 * Math.sin(Math.min(k * Math.PI, Math.PI));
      this.beam.rotation.y += dt * 1.5;
      if (!this.dropped && k > 0.35) { this.dropped = true; this.dropFn(); }
      if (this.t >= DROP_TIME) { this.phase = 'out'; this.t = 0; this.beam.visible = false; }
    } else {
      const k = ease(Math.min(this.t / DEPART_TIME, 1));
      this.ship.position.lerpVectors(this.hover, this.away, k);
      this.ship.rotation.z = Math.sin(k * Math.PI) * 0.18;
      this._face(this.away.x - this.hover.x, this.away.z - this.hover.z);
      if (this.t >= DEPART_TIME) return this._finish();
    }
    return true;
  }

  _face(dx, dz) { this.ship.rotation.y = Math.atan2(dx, dz) - Math.PI / 2; }

  _finish() {
    this.scene.remove(this.ship, this.beam);
    this.onDone?.();
    return false;
  }

  abort() { this.scene.remove(this.ship, this.beam); }
}

export class DropshipManager {
  constructor(scene, world, enemies) {
    this.scene = scene; this.world = world; this.enemies = enemies;
    this.list = [];
    this.onDeliver = null;   // hook for audio, set by Game
  }

  /* deliver `types` near (x,z); each spawned enemy is passed to tag() */
  deliver(types, x, z, tag = null, onDone = null) {
    const p = this.world.findClear(x, z, 1.2);
    const d = new Delivery(this.scene, this.world, p, () => {
      for (const t of types) {
        const e = this.enemies.spawnNear(t, p.x, p.z, 1, 6);
        tag?.(e);
      }
    }, onDone);
    this.list.push(d);
    this.onDeliver?.();
    return d;
  }

  update(dt, time) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.list[i].update(dt, time)) this.list.splice(i, 1);
    }
  }

  clear() {
    for (const d of this.list) d.abort();
    this.list.length = 0;
  }

  get busy() { return this.list.length > 0; }
}
