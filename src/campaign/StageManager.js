import * as THREE from 'three';
import { STAGES } from './stages.js';

/* ============================================================
   StageManager — loads campaign stages, resolves anchors,
   spawns enemies/collectibles/consoles, tracks objective
   completion, and advances the campaign. Also drives Skirmish.
   ============================================================ */

export class StageManager {
  constructor(game) {
    this.game = game;                // { world, scene, enemies, projectiles, player, cortana, hud }
    this.stageIndex = -1;
    this.stage = null;
    this.objectives = [];
    this.collectibles = [];
    this.console = null;
    this.mode = 'campaign';          // 'campaign' | 'skirmish'
    this.active = false;
    this.skirmishWave = 0;
    this._tmp = new THREE.Vector3();

    this.game.enemies.onKill = (e) => this._onKill(e);
  }

  /* ---- anchors resolved against the live world ---- */
  _anchor(name) {
    const w = this.game.world;
    switch (name) {
      case 'start': return { x: 76, z: 104 };
      case 'dock': {
        const a = 1.05, r = w.shoreRadiusAt(a) - 2;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r };
      }
      case 'shore': {
        const a = 2.4, r = w.shoreRadiusAt(a) + 20;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r };
      }
      case 'beacon': return this._highPoint();
      case 'console': {
        const a = 4.2, r = w.shoreRadiusAt(a) + 34;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r };
      }
      default: return { x: 0, z: 0 };
    }
  }

  _highPoint() {
    // find a reachable high spot within the play bowl
    let best = { x: 120, z: 0, h: -1e9 };
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const r = 150;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.game.world.heightAt(x, z);
      if (h > best.h && h < 60) best = { x, z, h };
    }
    return best;
  }

  /* ============================ CAMPAIGN ============================ */
  startCampaign(index = 0) {
    this.mode = 'campaign';
    this.loadStage(index);
  }

  loadStage(index) {
    this.stageIndex = index;
    this.stage = STAGES[index];
    this._teardown();

    const g = this.game, s = this.stage;
    g.world.setTimeOfDay(s.tod);
    g.world.setFogDensity(s.fog);
    g.world.setWaves(s.waves);

    const start = this._anchor(s.start);
    g.player.spawn(start.x, start.z, 0.63);

    // build objectives
    this.objectives = s.objectives.map(spec => this._buildObjective(spec));
    this.active = false;   // becomes true after briefing "DEPLOY"

    // briefing screen + cortana queued to play on deploy
    g.hud.showBriefing(index + 1, s.title, s.subtitle, this.objectives.map(o => o.label));
    this._pendingIntro = s.intro;
  }

  deploy() {
    this.active = true;
    this.game.hud.hideBriefing();
    this.game.hud.showHud();
    this.game.input.requestLock();
    if (this._pendingIntro) { this.game.cortana.say(this._pendingIntro); this._pendingIntro = null; }
    this._refreshHud();
  }

  _buildObjective(spec) {
    const o = { ...spec, done: false, progress: 0, marker: null };
    if (spec.type === 'reach' || spec.type === 'activate') {
      const p = this._anchor(spec.anchor);
      o.pos = new THREE.Vector3(p.x, this.game.world.heightAt(p.x, p.z), p.z);
      if (spec.type === 'activate') { this._spawnConsole(o.pos); o.locked = true; }
      o.marker = { pos: o.pos, label: spec.label, color: spec.type === 'activate' ? 0xffcf5c : 0x8ffcff };
    } else if (spec.type === 'eliminate') {
      o.remaining = spec.count;
      this._spawnEnemies(spec);
    } else if (spec.type === 'collect') {
      o.remaining = spec.count;
      this._spawnCores(spec);
    }
    return o;
  }

  _spawnEnemies(spec) {
    const s = spec.spawn; if (!s) return;
    const a = this._anchor(s.anchor);
    const half = s.boss ? s.types : s.types.slice(0, Math.ceil(s.types.length / (s.reinforce ? 2 : 1)));
    this._reinforcePool = s.reinforce ? s.types.slice(half.length) : [];
    this._reinforceSpec = s;
    for (const t of half) {
      const e = this.game.enemies.spawnNear(t, a.x, a.z, s.minR, s.maxR);
      if (s.boss) { e.health = e.maxHealth = 260; e.mesh.scale.setScalar(1.6); e.damage = 22; e.isBoss = true; }
    }
  }

  _spawnCores(spec) {
    const a = this._anchor(spec.anchor);
    const spread = spec.spread || 50;
    for (let i = 0; i < spec.count; i++) {
      const ang = (i / spec.count) * Math.PI * 2 + 0.6;
      const r = spread * (0.5 + 0.5 * Math.random());
      let x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r;
      const rr = Math.hypot(x, z); if (rr > 155) { x *= 155 / rr; z *= 155 / rr; }
      const y = Math.max(this.game.world.heightAt(x, z), 0.2) + 1.2;
      const core = this._makeCore();
      core.position.set(x, y, z);
      this.game.scene.add(core);
      this.collectibles.push({ mesh: core, pos: core.position, taken: false });
    }
  }

  _makeCore() {
    const g = new THREE.Group();
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffb020, emissiveIntensity: 2.2, roughness: 0.3 }));
    const light = new THREE.PointLight(0xffc040, 5, 14, 2);
    g.add(cube, light);
    g.userData.spin = cube;
    return g;
  }

  _spawnConsole(pos) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 1.0, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.5, metalness: 0.6 }));
    base.position.y = 0.5; base.castShadow = true;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x141a20, emissive: 0x224455, emissiveIntensity: 0.6 }));
    panel.position.set(0, 1.3, 0); panel.rotation.x = -0.5;
    g.add(base, panel);
    g.position.set(pos.x, this.game.world.heightAt(pos.x, pos.z), pos.z);
    this.game.scene.add(g);
    this.console = { group: g, panel };
  }

  _onKill(e) {
    // credit the active eliminate objective
    const obj = this.objectives.find(o => o.type === 'eliminate' && !o.done);
    if (obj) {
      obj.remaining = Math.max(0, obj.remaining - 1);
      obj.progress = obj.count - obj.remaining;
      // reinforcements
      if (this._reinforcePool && this._reinforcePool.length && obj.remaining <= this._reinforcePool.length) {
        const t = this._reinforcePool.shift();
        const a = this._anchor(this._reinforceSpec.anchor);
        this.game.enemies.spawnNear(t, a.x, a.z, this._reinforceSpec.minR, this._reinforceSpec.maxR);
      }
      if (obj.remaining === 0) this._completeObjective(obj);
    }
    if (this.mode === 'skirmish') this._maybeNextWave();
    this._refreshHud();
  }

  _completeObjective(o) {
    if (o.done) return;
    o.done = true;
    if (o.marker) o.marker = null;
    // unlock any activate objective whose requirements are now met
    for (const a of this.objectives) {
      if (a.type === 'activate' && a.locked && a.requires.every(id => this.objectives.find(x => x.id === id)?.done)) {
        a.locked = false;
        this.game.cortana.say(['The console’s unlocked, Chief. Get to it.']);
      }
    }
    this.game.hud.banner(`OBJECTIVE COMPLETE`);
    this._refreshHud();
    if (this.objectives.every(x => x.done)) this._completeStage();
  }

  _completeStage() {
    this.active = false;
    const outro = this.stage.outro || [];
    this.game.cortana.say(outro);
    const next = this.stageIndex + 1;
    setTimeout(() => {
      if (next < STAGES.length) this.loadStage(next);
      else this.game.hud.showVictory(this.game.player.score);
    }, 3600);
  }

  /* ============================ SKIRMISH ============================ */
  startSkirmish() {
    this.mode = 'skirmish';
    this._teardown();
    const g = this.game;
    g.world.setTimeOfDay(0.34);
    g.world.setFogDensity(0.42);
    g.world.setWaves(0.42);
    g.player.spawn(76, 104, 0.63);
    this.objectives = [{ id: 'wave', type: 'wave', label: 'Wave 1', done: false }];
    this.skirmishWave = 0;
    this.active = true;
    g.hud.hideBriefing();
    g.hud.showHud();
    g.input.requestLock();
    g.cortana.say(['Skirmish mode, Chief. Endless Covenant. Rack up that score.']);
    this._nextWave();
  }

  _nextWave() {
    this.skirmishWave++;
    const n = 3 + this.skirmishWave;
    for (let i = 0; i < n; i++) {
      const t = Math.random() < 0.25 + this.skirmishWave * 0.03 ? 'elite' : 'grunt';
      this.game.enemies.spawnNear(t, 0, 0, 40, 150);
    }
    this.objectives[0].label = `Wave ${this.skirmishWave}`;
    this.game.hud.banner(`WAVE ${this.skirmishWave}`);
    this._refreshHud();
  }

  _maybeNextWave() {
    if (this.game.enemies.aliveCount === 0) setTimeout(() => this.active && this._nextWave(), 2000);
  }

  /* ============================ SHARED ============================ */
  _teardown() {
    this.game.enemies.clear();
    this.game.projectiles.clear();
    for (const c of this.collectibles) this.game.scene.remove(c.mesh);
    this.collectibles.length = 0;
    if (this.console) { this.game.scene.remove(this.console.group); this.console = null; }
    this._reinforcePool = null;
  }

  _refreshHud() {
    this.game.hud.setObjectives(this.objectives, this.mode, this.game.player.score);
  }

  /* markers for the HUD waypoint compass */
  markers() {
    const out = [];
    for (const o of this.objectives) {
      if (o.done) continue;
      if ((o.type === 'reach') && o.marker) out.push(o.marker);
      if (o.type === 'activate' && !o.locked && o.marker) out.push(o.marker);
    }
    for (const c of this.collectibles) if (!c.taken) out.push({ pos: c.pos, label: 'CORE', color: 0xffc040 });
    return out;
  }

  update(dt, time) {
    if (!this.active) return;
    const player = this.game.player;

    // spin/bob collectibles + pickup
    for (const c of this.collectibles) {
      if (c.taken) continue;
      c.mesh.userData.spin.rotation.y += dt * 2;
      c.mesh.userData.spin.rotation.x += dt * 1.1;
      if (this._tmp.subVectors(c.pos, player.position).lengthSq() < 3 * 3) {
        c.taken = true;
        this.game.scene.remove(c.mesh);
        const obj = this.objectives.find(o => o.type === 'collect' && !o.done);
        if (obj) {
          obj.remaining--; obj.progress = obj.count - obj.remaining;
          this.game.cortana.say([`Core recovered. ${obj.remaining} to go.`]);
          if (obj.remaining === 0) this._completeObjective(obj);
          this._refreshHud();
        }
      }
    }

    // reach / activate proximity
    for (const o of this.objectives) {
      if (o.done) continue;
      if (o.type === 'reach' && this._tmp.subVectors(o.pos, player.position).lengthSq() < o.radius * o.radius) {
        this._completeObjective(o);
      }
      if (o.type === 'activate' && !o.locked && this._tmp.subVectors(o.pos, player.position).lengthSq() < o.radius * o.radius) {
        if (this.console) this.console.panel.material.emissive.setHex(0x33ff88);
        this._completeObjective(o);
      }
    }

    // player death -> respawn at stage start after a beat
    if (player.dead && !this._respawning) {
      this._respawning = true;
      this.game.hud.banner('YOU DIED — REGROUPING');
      this.game.cortana.say(['We’re not done yet, Chief. Back on your feet.']);
      setTimeout(() => {
        const start = this._anchor(this.mode === 'campaign' ? this.stage.start : 'start');
        player.spawn(start.x, start.z, 0.63);
        this._respawning = false;
      }, 2600);
    }
  }
}
