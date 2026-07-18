import * as THREE from 'three';

/* ============================================================
   Enemies — Covenant grunts and elites with patrol / chase /
   attack AI that walks the terrain and fires plasma at the
   player. The manager owns spawning, damage, death and the
   onKill callback used by the campaign objective system.
   ============================================================ */

const STATE = { PATROL: 0, CHASE: 1, ATTACK: 2 };

const TYPES = {
  grunt: { health: 30, speed: 3.4, sight: 55, range: 34, cooldown: 1100, damage: 9, radius: 0.6, height: 1.2, score: 10, color: 0xd98a2b, accent: 0x6a3d12 },
  elite: { health: 90, speed: 4.2, sight: 70, range: 42, cooldown: 850, damage: 15, radius: 0.7, height: 1.9, score: 30, color: 0x3a55c8, accent: 0x1b2a63 },
};

function buildEnemyMesh(type) {
  const t = TYPES[type];
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(t.radius * 0.7, t.height * 0.5, 4, 8),
    new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.6, metalness: 0.2 }));
  body.position.y = t.height * 0.55; body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(t.radius * 0.5, 10, 8),
    new THREE.MeshStandardMaterial({ color: t.accent, roughness: 0.5, emissive: t.color, emissiveIntensity: 0.25 }));
  head.position.y = t.height * 0.98; head.castShadow = true;
  g.add(body, head);
  if (type === 'elite') {
    // shoulder pauldrons for silhouette
    [-1, 1].forEach(s => {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(t.radius * 0.45, 0),
        new THREE.MeshStandardMaterial({ color: t.accent, roughness: 0.5 }));
      p.position.set(s * t.radius * 0.7, t.height * 0.75, 0); g.add(p);
    });
  }
  return g;
}

class Enemy {
  constructor(type, position) {
    const t = TYPES[type];
    this.type = type;
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.health = t.health; this.maxHealth = t.health;
    this.speed = t.speed; this.sight = t.sight; this.range = t.range;
    this.cooldown = t.cooldown; this.damage = t.damage;
    this.radius = t.radius; this.height = t.height; this.score = t.score;
    this.state = STATE.PATROL;
    this.lastShot = 0;
    this.patrolTarget = null;
    this.alive = true;
    this.mesh = buildEnemyMesh(type);
    this.mesh.position.copy(position);
  }
}

export class EnemyManager {
  constructor(scene, world, projectiles) {
    this.scene = scene;
    this.world = world;
    this.projectiles = projectiles;
    this.list = [];
    this.onKill = null;      // (enemy) => void
    this._dir = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
  }

  spawn(type, x, z) {
    const y = this.world.heightAt(x, z);
    const e = new Enemy(type, new THREE.Vector3(x, y, z));
    this.scene.add(e.mesh);
    this.list.push(e);
    return e;
  }

  /* spawn near a world position, on valid ground, avoiding water */
  spawnNear(type, cx, cz, minR, maxR) {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2;
      const rr = minR + Math.random() * (maxR - minR);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      if (Math.hypot(x, z) > 160) continue;
      if (this.world.heightAt(x, z) < 0.6) continue;   // not in the lake
      return this.spawn(type, x, z);
    }
    return this.spawn(type, cx + minR, cz);
  }

  damage(e, amount, player) {
    if (!e.alive) return;
    e.health -= amount;
    // hit flash
    e.mesh.children[0].material.emissive?.setRGB(1, 1, 1);
    if (e.health <= 0) this._kill(e, player);
  }

  _kill(e, player) {
    e.alive = false;
    this.scene.remove(e.mesh);
    if (player) player.addScore(e.score);
    if (this.onKill) this.onKill(e);
  }

  get aliveCount() { return this.list.reduce((n, e) => n + (e.alive ? 1 : 0), 0); }

  clear() {
    for (const e of this.list) if (e.alive) this.scene.remove(e.mesh);
    this.list.length = 0;
  }

  update(dt, player, time) {
    for (const e of this.list) {
      if (!e.alive) continue;
      // recover hit-flash toward base color
      const bodyMat = e.mesh.children[0].material;
      if (bodyMat.emissive) bodyMat.emissive.lerp(new THREE.Color(0, 0, 0), 0.25);

      const toPlayer = this._dir.subVectors(player.position, e.position);
      const dist = toPlayer.length();
      const canSee = !player.dead && dist < e.sight;

      if (canSee && dist < e.range) e.state = STATE.ATTACK;
      else if (canSee) e.state = STATE.CHASE;
      else e.state = STATE.PATROL;

      if (e.state === STATE.CHASE || e.state === STATE.ATTACK) {
        // move toward player but stop at ~70% of range to strafe/shoot
        if (dist > e.range * 0.7) {
          toPlayer.y = 0; toPlayer.normalize();
          e.position.x += toPlayer.x * e.speed * dt;
          e.position.z += toPlayer.z * e.speed * dt;
        }
        // face player
        e.mesh.rotation.y = Math.atan2(player.position.x - e.position.x, player.position.z - e.position.z);
      } else {
        // patrol: wander to random nearby points
        if (!e.patrolTarget || e.position.distanceTo(e.patrolTarget) < 2) {
          const a = Math.random() * Math.PI * 2, rr = 6 + Math.random() * 14;
          e.patrolTarget = new THREE.Vector3(e.position.x + Math.cos(a) * rr, 0, e.position.z + Math.sin(a) * rr);
        }
        const to = this._dir.subVectors(e.patrolTarget, e.position); to.y = 0;
        if (to.lengthSq() > 0.01) {
          to.normalize();
          e.position.x += to.x * e.speed * 0.5 * dt;
          e.position.z += to.z * e.speed * 0.5 * dt;
          e.mesh.rotation.y = Math.atan2(to.x, to.z);
        }
      }

      // stick to terrain, keep out of deep water
      const gy = Math.max(this.world.heightAt(e.position.x, e.position.z), this.world.waterLevel);
      e.position.y = gy;
      e.mesh.position.copy(e.position);

      // shoot
      if (e.state === STATE.ATTACK && time - e.lastShot > e.cooldown) {
        e.lastShot = time;
        this._muzzle.set(e.position.x, e.position.y + e.height * 0.8, e.position.z);
        const aim = new THREE.Vector3().subVectors(player.position, this._muzzle);
        // small inaccuracy
        aim.x += (Math.random() - 0.5) * 2; aim.y += (Math.random() - 0.5) * 2; aim.z += (Math.random() - 0.5) * 2;
        this.projectiles.spawn(this._muzzle, aim, false, e.damage);
      }
    }
  }
}
