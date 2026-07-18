import * as THREE from 'three';

/* ============================================================
   Enemies — Covenant grunts and elites with articulated
   low-poly bodies (head, glowing eyes, arms, legs, grunt
   methane tank), a walk cycle, patrol/chase/attack AI that
   actively roams and hunts, and a floating health bar that
   depletes as they take damage.
   ============================================================ */

const STATE = { PATROL: 0, CHASE: 1, ATTACK: 2 };

const TYPES = {
  grunt: { health: 40, speed: 3.8, sight: 90, range: 32, cooldown: 1100, damage: 8, radius: 0.6, height: 1.5, score: 10, color: 0xd98a2b, accent: 0x5a3410, eye: 0xff7a1a },
  elite: { health: 120, speed: 4.6, sight: 110, range: 40, cooldown: 850, damage: 14, radius: 0.7, height: 2.2, score: 30, color: 0x3550c8, accent: 0x161f52, eye: 0x66ddff },
  drone: { health: 30, speed: 7.5, sight: 110, range: 26, cooldown: 650, damage: 6, radius: 0.5, height: 1.0, score: 15, color: 0x8a93a8, accent: 0x2a3140, eye: 0xff3355, hover: 3.4 },
};

function mat(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...opts }); }

/* build an articulated body; returns { group, parts } */
function buildBody(type) {
  const t = TYPES[type];
  const g = new THREE.Group();
  const parts = {};
  const skin = mat(t.color), dark = mat(t.accent);
  const eyeMat = new THREE.MeshStandardMaterial({ color: t.eye, emissive: t.eye, emissiveIntensity: 1.6, roughness: 0.3 });

  if (type === 'drone') {
    // Sentinel-style flyer: metal core, red eye, side fins, spinning vane
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), skin);
    core.scale.set(1, 0.75, 1.4); core.castShadow = true; g.add(core);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), eyeMat);
    eye.position.set(0, 0, 0.55); g.add(eye);
    [-1, 1].forEach(s => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.34), dark);
      fin.position.set(s * 0.62, 0.12, -0.1); fin.rotation.z = s * 0.35; fin.castShadow = true; g.add(fin);
    });
    const vane = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 12), dark);
    vane.rotation.x = Math.PI / 2; vane.position.y = 0.34; g.add(vane);
    parts.vane = vane;
    return { group: g, parts };
  }
  if (type === 'grunt') {
    // hunched torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.4, 4, 8), skin);
    torso.position.y = 0.85; torso.rotation.x = 0.35; torso.castShadow = true; g.add(torso);
    // methane tank on the back
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 8), mat(0x2aa888));
    tank.position.set(0, 0.95, -0.34); tank.rotation.x = 0.2; tank.castShadow = true; g.add(tank);
    // head + gas mask
    const head = new THREE.Group(); head.position.set(0, 1.2, 0.18);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), dark); skull.castShadow = true;
    const maskA = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), mat(0x888888)); maskA.position.set(0, -0.02, 0.16);
    const eyeGeo = new THREE.BoxGeometry(0.09, 0.09, 0.04);
    const le = new THREE.Mesh(eyeGeo, eyeMat), re = new THREE.Mesh(eyeGeo, eyeMat);
    le.position.set(-0.1, 0.06, 0.3); re.position.set(0.1, 0.06, 0.3);
    head.add(skull, maskA, le, re); g.add(head); parts.head = head;
    // arms + legs
    parts.armL = limb(0.13, 0.5, dark, -0.42, 0.95, 0.1, g);
    parts.armR = limb(0.13, 0.5, dark, 0.42, 0.95, 0.1, g);
    parts.legL = limb(0.16, 0.45, dark, -0.2, 0.45, 0, g);
    parts.legR = limb(0.16, 0.45, dark, 0.2, 0.45, 0, g);
  } else {
    // tall, upright elite
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.8, 4, 10), skin);
    torso.position.y = 1.35; torso.castShadow = true; g.add(torso);
    [-1, 1].forEach(s => {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), dark);
      p.position.set(s * 0.5, 1.75, 0); p.castShadow = true; g.add(p);
    });
    const head = new THREE.Group(); head.position.set(0, 2.0, 0.05);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), dark); skull.scale.z = 1.3; skull.castShadow = true;
    const eyeGeo = new THREE.BoxGeometry(0.07, 0.05, 0.04);
    const le = new THREE.Mesh(eyeGeo, eyeMat), re = new THREE.Mesh(eyeGeo, eyeMat);
    le.position.set(-0.09, 0.02, 0.26); re.position.set(0.09, 0.02, 0.26);
    head.add(skull, le, re); g.add(head); parts.head = head;
    parts.armL = limb(0.15, 0.75, skin, -0.52, 1.5, 0, g);
    parts.armR = limb(0.15, 0.75, skin, 0.52, 1.5, 0, g);
    parts.legL = limb(0.19, 0.7, dark, -0.24, 0.7, 0, g);
    parts.legR = limb(0.19, 0.7, dark, 0.24, 0.7, 0, g);
  }
  return { group: g, parts };
}

/* a limb pivoting from its top so it swings like a leg/arm */
function limb(r, len, material, x, y, z, parent) {
  const pivot = new THREE.Group(); pivot.position.set(x, y, z);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 6), material);
  m.position.y = -len / 2; m.castShadow = true;
  pivot.add(m); parent.add(pivot);
  return pivot;
}

class Enemy {
  constructor(type, position) {
    const t = TYPES[type];
    Object.assign(this, {
      type, position: position.clone(), velocity: new THREE.Vector3(),
      health: t.health, maxHealth: t.health, speed: t.speed, sight: t.sight,
      range: t.range, cooldown: t.cooldown, damage: t.damage, radius: t.radius,
      height: t.height, score: t.score, state: STATE.PATROL, lastShot: 0,
      patrolTarget: null, alive: true, animPhase: Math.random() * 6, moving: false,
      hitFlash: 0, hover: t.hover || 0, objectiveId: null,
    });
    const body = buildBody(type);
    this.mesh = body.group; this.parts = body.parts;
    this.mesh.position.copy(position);
    this._buildHealthBar();
  }

  _buildHealthBar() {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 10;
    this.hpCanvas = cv; this.hpCtx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
    this.hpTex = tex;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(1.3, 0.2, 1);
    spr.position.set(0, this.height + 0.55, 0);
    spr.visible = false;
    this.hpBar = spr; this.mesh.add(spr);
    this._drawHealth();
  }

  _drawHealth() {
    const ctx = this.hpCtx, frac = Math.max(0, this.health / this.maxHealth);
    ctx.clearRect(0, 0, 64, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, 64, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 63, 9);
    const col = frac > 0.5 ? '#7de08a' : frac > 0.22 ? '#ffd23b' : '#ff3b3b';
    ctx.fillStyle = col; ctx.fillRect(2, 2, (64 - 4) * frac, 6);
    this.hpTex.needsUpdate = true;
  }
}

export class EnemyManager {
  constructor(scene, world, projectiles, camera) {
    this.scene = scene;
    this.world = world;
    this.projectiles = projectiles;
    this.camera = camera;
    this.list = [];
    this.onKill = null;
    this._dir = new THREE.Vector3();
    this._sep = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
  }

  spawn(type, x, z) {
    const y = Math.max(this.world.heightAt(x, z), this.world.waterLevel) + (TYPES[type].hover || 0);
    const e = new Enemy(type, new THREE.Vector3(x, y, z));
    this.scene.add(e.mesh);
    this.list.push(e);
    return e;
  }

  spawnNear(type, cx, cz, minR, maxR) {
    const clearance = TYPES[type].radius + 0.4;
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2;
      const rr = minR + Math.random() * (maxR - minR);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      if (Math.hypot(x, z) > 160) continue;
      if (this.world.heightAt(x, z) < 0.6) continue;
      if (!this.world.isClear(x, z, clearance)) continue;   // don't spawn inside trees/rocks
      return this.spawn(type, x, z);
    }
    // dense forest or open water around the anchor: spiral out until land+clearance
    const p = this.world.findClear(cx, cz, clearance, maxR + 80);
    return this.spawn(type, p.x, p.z);
  }

  damage(e, amount, player) {
    if (!e.alive) return;
    e.health -= amount;
    e.hitFlash = 1;
    e.hpBar.visible = true;
    e._drawHealth();
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

      // hit-flash recovery on the torso
      if (e.hitFlash > 0) {
        e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
        const m = e.mesh.children[0].material;
        if (m.emissive) m.emissive.setRGB(e.hitFlash, e.hitFlash, e.hitFlash);
      }

      const toPlayer = this._dir.subVectors(player.position, e.position);
      const dist = toPlayer.length();
      const canSee = !player.dead && dist < e.sight;

      if (canSee && dist < e.range) e.state = STATE.ATTACK;
      else if (canSee) e.state = STATE.CHASE;
      else e.state = STATE.PATROL;

      let moveVec = null;
      if (e.state === STATE.CHASE || (e.state === STATE.ATTACK && dist > e.range * 0.6)) {
        toPlayer.y = 0; toPlayer.normalize();
        moveVec = toPlayer;
        e.hpBar.visible = true;   // reveal bar once engaged
      } else if (e.state === STATE.ATTACK) {
        // in range: strafe sideways to feel alive (drones orbit harder)
        toPlayer.y = 0; toPlayer.normalize();
        const orbit = e.hover ? 1 : Math.sin(time * 0.002 + e.animPhase);
        moveVec = this._sep.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(orbit);
      } else {
        // patrol: keep wandering to fresh points so they always move
        if (!e.patrolTarget || e.position.distanceTo(e.patrolTarget) < 2.5) {
          const a = Math.random() * Math.PI * 2, rr = 8 + Math.random() * 20;
          let tx = e.position.x + Math.cos(a) * rr, tz = e.position.z + Math.sin(a) * rr;
          const R = Math.hypot(tx, tz); if (R > 155) { tx *= 155 / R; tz *= 155 / R; }
          e.patrolTarget = new THREE.Vector3(tx, 0, tz);
        }
        moveVec = this._sep.subVectors(e.patrolTarget, e.position); moveVec.y = 0; moveVec.normalize().multiplyScalar(0.55);
      }

      // apply movement; walkers avoid deep water, drones fly over it
      const spd = e.speed * (e.state === STATE.PATROL ? 1 : 1);
      let nx = e.position.x + moveVec.x * spd * dt;
      let nz = e.position.z + moveVec.z * spd * dt;
      if (!e.hover && this.world.heightAt(nx, nz) < 0.4) { e.patrolTarget = null; nx = e.position.x; nz = e.position.z; }
      { // slide around tree trunks / boulders instead of clipping through
        const c = this.world.collide(nx, nz, e.radius);
        if ((c.x !== nx || c.z !== nz) && e.state === STATE.PATROL && Math.random() < dt * 2) e.patrolTarget = null;
        nx = c.x; nz = c.z;
      }
      const R = Math.hypot(nx, nz); if (R > 158) { nx *= 158 / R; nz *= 158 / R; }
      const speedNow = Math.hypot(nx - e.position.x, nz - e.position.z) / (dt || 1e-3);
      e.position.x = nx; e.position.z = nz;
      const groundY = Math.max(this.world.heightAt(e.position.x, e.position.z), this.world.waterLevel);
      if (e.hover) {
        const targetY = groundY + e.hover + Math.sin(time * 0.0021 + e.animPhase) * 0.6;
        e.position.y += (targetY - e.position.y) * Math.min(1, dt * 3);
      } else {
        e.position.y = groundY;
      }
      e.mesh.position.copy(e.position);

      // face travel / player
      if (e.state !== STATE.PATROL) e.mesh.rotation.y = Math.atan2(player.position.x - e.position.x, player.position.z - e.position.z);
      else if (moveVec.lengthSq() > 1e-4) e.mesh.rotation.y = Math.atan2(moveVec.x, moveVec.z);

      // ---- walk animation ----
      e.moving = speedNow > 0.3;
      if (e.moving) e.animPhase += dt * (6 + speedNow);
      const sw = e.moving ? Math.sin(e.animPhase) * 0.6 : Math.sin(time * 0.003 + e.animPhase) * 0.06;
      const sw2 = e.moving ? Math.sin(e.animPhase + Math.PI) * 0.6 : -Math.sin(time * 0.003 + e.animPhase) * 0.06;
      if (e.parts.legL) { e.parts.legL.rotation.x = sw; e.parts.legR.rotation.x = sw2; }
      if (e.parts.armL) { e.parts.armL.rotation.x = sw2 * 0.7; e.parts.armR.rotation.x = sw * 0.7; }
      if (e.parts.head && e.state !== STATE.PATROL) e.parts.head.rotation.x = 0.1;
      if (e.parts.vane) { e.parts.vane.rotation.z += dt * 9; e.mesh.rotation.z = Math.sin(time * 0.0018 + e.animPhase) * 0.14; }

      // health bar faces camera automatically (Sprite); keep it slightly above
      // shoot
      if (e.state === STATE.ATTACK && time - e.lastShot > e.cooldown) {
        e.lastShot = time;
        this._muzzle.set(e.position.x, e.position.y + e.height * 0.72, e.position.z);
        const aim = new THREE.Vector3().subVectors(player.position, this._muzzle);
        aim.x += (Math.random() - 0.5) * 1.6; aim.y += (Math.random() - 0.5) * 1.6; aim.z += (Math.random() - 0.5) * 1.6;
        this.projectiles.spawn(this._muzzle, aim, false, e.damage);
      }
    }
  }
}
