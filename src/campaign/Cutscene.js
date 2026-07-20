import * as THREE from 'three';

/* ============================================================
   CrashCutscene — the stage-1 opening: the Spartan's drop pod
   streaks down from the ring trailing fire, slams into the
   shore (shake, dust, boom), smokes while Cortana comes to,
   then the camera glides into the visor and hands over control.

   Driven by Game's loop: update(dt, time) returns false when
   finished. skip() jumps straight to the final state. The
   scorched pod (this.props) stays in the world as a crash-site
   prop; StageManager removes it on teardown.
   ============================================================ */

const FALL = 4.6, SETTLE = 3.8, HANDOFF = 2.4;

function softSprite() {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

function buildPod() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.55, metalness: 0.7 });
  const scorch = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.9, emissive: 0xff5a18, emissiveIntensity: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 1.7, 6, 12), hull);
  body.castShadow = true; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.9, 10), scorch);
  nose.position.y = -1.7; nose.rotation.x = Math.PI; g.add(nose);
  [-1, 1].forEach(s => {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.55), hull);
    fin.position.set(s * 0.85, 1.0, 0); fin.castShadow = true; g.add(fin);
  });
  const glowLight = new THREE.PointLight(0xff7030, 30, 30, 2);
  g.add(glowLight);
  g.userData = { scorch, glowLight };
  return g;
}

export class CrashCutscene {
  constructor(game, landing, onDone) {
    this.game = game;
    this.onDone = onDone;
    this.done = false;
    this.t = 0;
    this.impacted = false;
    this._tex = softSprite();

    this.landing = landing.clone();
    this.landing.y = game.world.heightAt(landing.x, landing.z);

    this.props = new THREE.Group();
    this.pod = buildPod();
    // fall in from high over the lake, streaking toward the shore
    const r = Math.max(Math.hypot(this.landing.x, this.landing.z), 1);
    const ox = this.landing.x / r, oz = this.landing.z / r;
    this.from = this.landing.clone().add(new THREE.Vector3(-ox * 240, 330, -oz * 240));
    this.pod.position.copy(this.from);
    this.props.add(this.pod);
    this._perp = { x: -oz, z: ox };

    // fire trail: recycled glowing points behind the pod
    const N = 70;
    this._trailPos = new Float32Array(N * 3).fill(9999);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this._trailPos, 3));
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({
      map: this._tex, color: 0xffa050, size: 5, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this._trailHead = 0;
    this.props.add(this.trail);

    // impact dust (spawned at impact) + lingering smoke column
    this.dust = null; this._dustVel = null;
    this.smoke = null;

    game.scene.add(this.props);

    // camera vantage: down the beach to the side, watching the sky
    this._camFrom = this.landing.clone().add(new THREE.Vector3(this._perp.x * 14, 0, this._perp.z * 14));
    this._camFrom.y = Math.max(this.landing.y + 6, game.world.heightAt(this._camFrom.x, this._camFrom.z) + 2.5);
    game.camera.position.copy(this._camFrom);

    document.getElementById('cine')?.classList.add('show');
    game.hud.hideHud();
    game.viewModel.visible = false;    // no rifle in a cinematic
  }

  /* returns false when the scene is over */
  update(dt, time) {
    if (this.done) return false;
    this.t += dt;
    const cam = this.game.camera, t = this.t;

    if (t < FALL) {
      // ---- fall: accelerating streak with a slight lateral arc ----
      const k = t / FALL, e = k * k;
      this.pod.position.lerpVectors(this.from, this.landing, e);
      this.pod.position.x += Math.sin(k * 2.4) * 6 * (1 - k);
      this.pod.rotation.z = 0.55 * (1 - k * 0.4);
      this.pod.rotation.y += dt * 3.5;
      this._pushTrail();
      cam.position.copy(this._camFrom);
      this._shake(cam, k * k * 0.12);
      cam.lookAt(this.pod.position);
    } else if (!this.impacted) {
      this._impact();
    } else if (t < FALL + SETTLE) {
      // ---- settle: slow orbit around the smoking pod ----
      const k = (t - FALL) / SETTLE;
      const a = Math.atan2(this._perp.z, this._perp.x) + k * 1.0;
      const cx = this.landing.x + Math.cos(a) * 8, cz = this.landing.z + Math.sin(a) * 8;
      cam.position.set(cx,
        Math.max(this.landing.y + 3.2 - k * 0.8, this.game.world.heightAt(cx, cz) + 2.0),
        cz);
      this._shake(cam, Math.max(0, 0.25 - k * 0.5));
      cam.lookAt(this.landing.x, this.landing.y + 1.0, this.landing.z);
      this._tickParticles(dt, time);
    } else if (t < FALL + SETTLE + HANDOFF) {
      // ---- handoff: glide into the visor ----
      if (!this._handFrom) {
        this._handFrom = cam.position.clone();
        this._handQuat = cam.quaternion.clone();
        const p = this.game.player;
        this._eyeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
      }
      const k = (t - FALL - SETTLE) / HANDOFF, e = k * k * (3 - 2 * k);
      cam.position.lerpVectors(this._handFrom, this.game.player.position, e);
      cam.quaternion.slerpQuaternions(this._handQuat, this._eyeQuat, e);
      this._tickParticles(dt, time);
    } else {
      this._finish();
    }
    return !this.done;
  }

  _pushTrail() {
    const p = this.pod.position, i = (this._trailHead++ % 70) * 3;
    this._trailPos[i] = p.x + (Math.random() - 0.5) * 1.4;
    this._trailPos[i + 1] = p.y + (Math.random() - 0.5) * 1.4 + 1.2;
    this._trailPos[i + 2] = p.z + (Math.random() - 0.5) * 1.4;
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  _impact() {
    this.impacted = true;
    // pod comes to rest: tilted, half-dug-in
    this.pod.position.copy(this.landing); this.pod.position.y += 0.6;
    this.pod.rotation.set(0.15, 1.2, 0.95);
    this.pod.userData.glowLight.intensity = 8;
    this.trail.material.opacity = 0;
    this.game.ambient.boom();

    // dust burst
    const N = 42, pos = new Float32Array(N * 3);
    this._dustVel = [];
    for (let i = 0; i < N; i++) {
      pos[i * 3] = this.landing.x; pos[i * 3 + 1] = this.landing.y + 0.5; pos[i * 3 + 2] = this.landing.z;
      const a = Math.random() * Math.PI * 2;
      this._dustVel.push(new THREE.Vector3(Math.cos(a) * (3 + Math.random() * 7), 1.5 + Math.random() * 4, Math.sin(a) * (3 + Math.random() * 7)));
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({
      map: this._tex, color: 0xb9a58c, size: 6, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    this.props.add(this.dust);

    // smoke column above the wreck (kept after the scene as set dressing)
    const S = 16, sp = new Float32Array(S * 3);
    for (let i = 0; i < S; i++) {
      sp[i * 3] = this.landing.x + (Math.random() - 0.5) * 1.2;
      sp[i * 3 + 1] = this.landing.y + 1 + i * 0.55;
      sp[i * 3 + 2] = this.landing.z + (Math.random() - 0.5) * 1.2;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({
      map: this._tex, color: 0x555a60, size: 4.5, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    this.props.add(this.smoke);
  }

  _tickParticles(dt, time) {
    if (this.dust) {
      const p = this.dust.geometry.attributes.position;
      for (let i = 0; i < this._dustVel.length; i++) {
        const v = this._dustVel[i];
        p.array[i * 3] += v.x * dt; p.array[i * 3 + 1] += v.y * dt; p.array[i * 3 + 2] += v.z * dt;
        v.multiplyScalar(0.94); v.y -= 2.5 * dt;
      }
      p.needsUpdate = true;
      this.dust.material.opacity = Math.max(0, this.dust.material.opacity - dt * 0.22);
    }
    if (this.smoke) this.smoke.rotation.y = Math.sin(time * 0.0004) * 0.2;
    const glow = this.pod.userData.glowLight;
    glow.intensity = Math.max(1.2, glow.intensity - dt * 1.5);
  }

  _shake(cam, amt) {
    cam.position.x += (Math.random() - 0.5) * amt;
    cam.position.y += (Math.random() - 0.5) * amt;
    cam.position.z += (Math.random() - 0.5) * amt;
  }

  /* jump straight to the end state (tap/key to skip).
     A stray tap right after DEPLOY used to skip the scene at frame zero
     ("cutscene never played") — so user skips are ignored for the first
     second. force=true (stage teardown) always finalizes. */
  skip(force = false) {
    if (this.done) return;
    if (!force && this.t < 1.0) return;
    if (!this.impacted) this._impact();
    if (this.dust) { this.props.remove(this.dust); this.dust = null; }
    this._finish();
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    if (this.dust) { this.props.remove(this.dust); this.dust = null; }
    this.pod.userData.glowLight.intensity = 1.0;
    document.getElementById('cine')?.classList.remove('show');
    this.game.viewModel.visible = true;
    this.game.hud.showHud();
    this.game.input.consumeLook();     // drop any look queued during the scene
    this.onDone?.();
  }
}
