import * as THREE from 'three';

/* ============================================================
   Projectiles — pooled plasma bolts for player and enemies.
   Player bolts damage enemies; enemy bolts damage the player.
   All bolts die on terrain impact or after a max lifetime.
   ============================================================ */

const SPEED = 90;
const LIFETIME = 2.2;

export class ProjectileManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.active = [];
    this.pool = [];

    this.playerMat = new THREE.MeshBasicMaterial({ color: 0x8ffcff });
    this.enemyMat = new THREE.MeshBasicMaterial({ color: 0xff4cc8 });
    this.geo = new THREE.SphereGeometry(0.16, 8, 6);
    this._v = new THREE.Vector3();
  }

  _obtain() {
    let p = this.pool.pop();
    if (!p) {
      const mesh = new THREE.Mesh(this.geo, this.playerMat);
      const light = new THREE.PointLight(0x8ffcff, 6, 10, 2);
      mesh.add(light);
      p = { mesh, light, vel: new THREE.Vector3(), life: 0, fromPlayer: true, damage: 0 };
    }
    this.scene.add(p.mesh);
    return p;
  }

  spawn(origin, dir, fromPlayer, damage) {
    const p = this._obtain();
    p.mesh.material = fromPlayer ? this.playerMat : this.enemyMat;
    p.light.color.set(fromPlayer ? 0x8ffcff : 0xff4cc8);
    p.mesh.position.copy(origin);
    p.vel.copy(dir).normalize().multiplyScalar(SPEED);
    p.life = LIFETIME;
    p.fromPlayer = fromPlayer;
    p.damage = damage;
    this.active.push(p);
  }

  _release(p, i) {
    this.scene.remove(p.mesh);
    this.active.splice(i, 1);
    this.pool.push(p);
  }

  /* update; returns nothing but applies damage via callbacks */
  update(dt, enemies, player) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const pos = p.mesh.position;

      // terrain / lifetime
      if (p.life <= 0 || pos.y < this.world.heightAt(pos.x, pos.z)) { this._release(p, i); continue; }

      if (p.fromPlayer) {
        let hit = false;
        for (const e of enemies.list) {
          if (!e.alive) continue;
          // horizontal distance to the enemy column + vertical overlap with its body
          const dx = pos.x - e.position.x, dz = pos.z - e.position.z;
          const rr = e.radius + 0.55;
          if (dx * dx + dz * dz < rr * rr && pos.y > e.position.y - 0.5 && pos.y < e.position.y + e.height + 1.0) {
            enemies.damage(e, p.damage, player);
            hit = true; break;
          }
        }
        if (hit) { this._release(p, i); continue; }
      } else {
        // enemy bolt vs player
        if (!player.dead && this._v.subVectors(pos, player.position).lengthSq() < 1.1 * 1.1) {
          player.damage(p.damage);
          this._release(p, i); continue;
        }
      }
    }
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this._release(this.active[i], i);
  }
}
