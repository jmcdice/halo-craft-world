import * as THREE from 'three';
import { clamp } from '../core/math.js';

/* ============================================================
   Player — first-person controller that walks the smooth
   terrain heightfield. Halo-style regenerating shields over
   health, gravity + jump, sprint, and step-up on slopes.
   ============================================================ */

const EYE = 1.65;
const RADIUS = 0.5;
const GRAVITY = 26;
const JUMP = 9.5;
const WALK = 7.0;
const SPRINT = 11.5;
const AIR_CONTROL = 0.35;

export class Player {
  constructor(world, camera, input) {
    this.world = world;
    this.camera = camera;
    this.input = input;

    this.position = new THREE.Vector3(76, 0, 104);
    this.velocity = new THREE.Vector3();
    this.yaw = 0.63;  // face the lake/valley at spawn
    this.pitch = -0.05;
    this.onGround = false;

    this.maxHealth = 100; this.health = 100;
    this.maxShield = 100; this.shield = 100;
    this.shieldRechargeDelay = 4500;
    this.shieldRechargeRate = 45;    // pts/sec
    this.lastDamageTime = -1e9;
    this.dead = false;
    this.score = 0;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._snapToGround();
  }

  spawn(x, z, yaw = this.yaw) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this._snapToGround();
    this.health = this.maxHealth; this.shield = this.maxShield;
    this.dead = false;
  }

  _groundY(x, z) {
    return Math.max(this.world.heightAt(x, z), this.world.waterLevel - 0.4);
  }
  _snapToGround() {
    this.position.y = this._groundY(this.position.x, this.position.z) + EYE;
  }

  /* forward vector on the horizontal plane, from yaw */
  forwardDir(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  damage(amount) {
    if (this.dead) return;
    this.lastDamageTime = performance.now();
    if (this.shield > 0) {
      this.shield -= amount;
      if (this.shield < 0) { this.health += this.shield; this.shield = 0; }
    } else {
      this.health -= amount;
    }
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  addScore(n) { this.score += n; }

  update(dt) {
    // ---- look ----
    const [lx, ly] = this.input.consumeLook();
    this.yaw -= lx;
    this.pitch = clamp(this.pitch - ly, -1.45, 1.45);

    // ---- movement input ----
    const input = this.input;
    let mf = 0, ms = 0;
    if (input.down('KeyW')) mf += 1;
    if (input.down('KeyS')) mf -= 1;
    if (input.down('KeyD')) ms += 1;
    if (input.down('KeyA')) ms -= 1;
    const sprinting = input.down('ShiftLeft') && mf > 0;
    const speed = sprinting ? SPRINT : WALK;

    this.forwardDir(this._fwd);
    this._right.set(this._fwd.z, 0, -this._fwd.x); // right = fwd rotated -90 on Y

    const wish = new THREE.Vector3()
      .addScaledVector(this._fwd, mf)
      .addScaledVector(this._right, ms);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    if (this.onGround) {
      this.velocity.x = wish.x;
      this.velocity.z = wish.z;
      if (input.down('Space')) { this.velocity.y = JUMP; this.onGround = false; }
    } else {
      this.velocity.x += wish.x * AIR_CONTROL * dt;
      this.velocity.z += wish.z * AIR_CONTROL * dt;
    }

    // ---- gravity + integrate ----
    this.velocity.y -= GRAVITY * dt;
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;

    // horizontal move with a simple slope block: don't climb near-vertical walls
    const curGround = this._groundY(this.position.x, this.position.z);
    const nextGround = this._groundY(nx, nz);
    const rise = nextGround - curGround;
    const horizDist = Math.hypot(nx - this.position.x, nz - this.position.z) + 1e-5;
    if (rise / horizDist < 2.2) {           // walkable slope / step
      this.position.x = nx;
      this.position.z = nz;
    } else {
      this.velocity.x *= 0.2; this.velocity.z *= 0.2;
    }

    // keep inside the playable bowl
    const maxR = 165;
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > maxR) { this.position.x *= maxR / r; this.position.z *= maxR / r; }

    // ---- vertical: land on terrain ----
    this.position.y += this.velocity.y * dt;
    const floor = this._groundY(this.position.x, this.position.z) + EYE;
    if (this.position.y <= floor) {
      this.position.y = floor;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // ---- shield regen ----
    if (!this.dead && performance.now() - this.lastDamageTime > this.shieldRechargeDelay) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRechargeRate * dt);
    }

    // ---- apply to camera ----
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
