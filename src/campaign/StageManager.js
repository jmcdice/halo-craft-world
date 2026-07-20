import * as THREE from 'three';
import { STAGES } from './stages.js';
import { CrashCutscene } from './Cutscene.js';

/* ============================================================
   StageManager — loads campaign stages, resolves anchors,
   spawns enemies/collectibles/consoles, tracks objective
   completion, and advances the campaign. Also drives Skirmish.

   Set-piece layer:
   - a declarative event engine (stage.events): zone / delay /
     objectiveDone / progress triggers firing say / banner /
     spawn / dropship actions
   - deferred eliminate spawns (spec.spawn.after) so encounters
     start when the script says, not at stage load
   - 'defend' objectives: hold a glowing zone while timed waves
     arrive by dropship
   - boss phases: dropship arrival, HUD health bar, enrage +
     summons at half health
   ============================================================ */

export class StageManager {
  constructor(game) {
    this.game = game;                // { world, scene, enemies, projectiles, player, cortana, hud, dropships }
    this.stageIndex = -1;
    this.stage = null;
    this.objectives = [];
    this.collectibles = [];
    this.console = null;
    this.mode = 'campaign';          // 'campaign' | 'skirmish'
    this.active = false;
    this.skirmishWave = 0;
    this.boss = null;
    this._events = [];
    this._elapsed = 0;
    this._hudTick = 0;
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
      case 'midway_dock': return this._midpoint('start', 'dock');
      case 'midway_shore': return this._midpoint('start', 'shore');
      case 'midway_beacon': return this._midpoint('start', 'beacon');
      case 'pass': return this._mountainPoint();
      case 'ridge': {
        const p = this._mountainPoint();
        const r = 200 / Math.max(Math.hypot(p.x, p.z), 1);
        return { x: p.x * r, z: p.z * r };
      }
      default: return { x: 0, z: 0 };
    }
  }

  _midpoint(a, b) {
    const p = this._anchor(a), q = this._anchor(b);
    return { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
  }

  /* nudge a point out of trees/rocks (and keep it on land) */
  _clearPoint(p, radius) {
    const w = this.game.world;
    if (w.isClear(p.x, p.z, radius) && w.heightAt(p.x, p.z) > 0.3) return p;
    const c = w.findClear(p.x, p.z, radius);
    return w.heightAt(c.x, c.z) > 0.3 ? c : p;
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

  /* a summit out in the true mountains (r≈240), climbable from the bowl */
  _mountainPoint() {
    if (this._passCache) return this._passCache;
    let best = { x: 240, z: 0, h: -1e9 };
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const x = Math.cos(a) * 240, z = Math.sin(a) * 240;
      const h = this.game.world.heightAt(x, z);
      if (h > best.h && h < 70) best = { x, z, h };
    }
    this._passCache = best;
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
    g.world.playRadius = s.playRadius || 165;

    const start = this._clearPoint(this._anchor(s.start), 0.8);
    g.player.spawn(start.x, start.z, 0.63);

    // build objectives + scripted events
    this.objectives = s.objectives.map(spec => this._buildObjective(spec));
    this._initEvents();
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
    const intro = this._pendingIntro; this._pendingIntro = null;
    if (this.stage?.cutscene === 'crash' && this.mode === 'campaign') {
      // marooned: watch your own pod come down over the water and plough
      // into the beach — open ground, so the camera never sits in a tree
      const p = this.game.player.position;
      const a = Math.atan2(p.z, p.x);
      const shoreR = this.game.world.shoreRadiusAt(a) + 7;
      let landing = { x: Math.cos(a) * shoreR, z: Math.sin(a) * shoreR };
      landing = this.game.world.findClear(landing.x, landing.z, 9, 26);
      const cs = new CrashCutscene(this.game,
        new THREE.Vector3(landing.x, 0, landing.z),
        () => { if (intro) this.game.cortana.say(intro); });
      this._cutsceneProps = cs.props;
      this.game.cutscene = cs;
    } else if (intro) {
      this.game.cortana.say(intro);
    }
    this._refreshHud();
  }

  _buildObjective(spec) {
    const o = { ...spec, done: false, progress: 0, marker: null, baseLabel: spec.label };
    if (spec.requires?.length) o.locked = true;
    if (spec.type === 'reach' || spec.type === 'activate') {
      const p = this._anchor(spec.anchor);
      o.pos = new THREE.Vector3(p.x, this.game.world.heightAt(p.x, p.z), p.z);
      if (spec.type === 'activate') { this._spawnConsole(o.pos); o.locked = true; }
      o.marker = { pos: o.pos, label: spec.label, color: spec.type === 'activate' ? 0xffcf5c : 0x8ffcff };
    } else if (spec.type === 'eliminate') {
      o.remaining = spec.count;
      if (!spec.spawn?.after) this._spawnEnemies(spec);   // scripted specs wait for their cue
    } else if (spec.type === 'collect') {
      o.remaining = spec.count;
      this._spawnCores(spec);
    } else if (spec.type === 'defend') {
      const p = this._clearPoint(this._anchor(spec.anchor), 2.5);
      o.pos = new THREE.Vector3(p.x, this.game.world.heightAt(p.x, p.z), p.z);
      o.timer = spec.duration;
      o.marker = { pos: o.pos, label: spec.label, color: 0x8ffcff };
      o._waveIdx = 0; o._waveIn = 0;   // first wave fires as soon as it activates
      if (!o.locked) this._activateDefend(o);
    }
    return o;
  }

  /* ---- enemy groups (instant or by dropship) ---- */
  _spawnEnemies(spec) {
    const s = spec.spawn; if (!s) return;
    const a = this._anchor(s.anchor);
    const half = s.boss ? s.types : s.types.slice(0, Math.ceil(s.types.length / (s.reinforce ? 2 : 1)));
    this._reinforcePool = s.reinforce ? s.types.slice(half.length) : [];
    this._reinforceSpec = s;
    this._reinforceId = spec.id;
    const group = { types: half, x: a.x, z: a.z, minR: s.minR, maxR: s.maxR, credit: spec.id, boss: s.boss };
    if (s.via === 'dropship') this._deliverGroup(group);
    else this._spawnGroup(group);
  }

  _tagger(credit, boss) {
    return (e) => {
      e.objectiveId = credit || 'none';
      if (boss) {
        e.health = e.maxHealth = 320;
        e.mesh.scale.setScalar(1.6);
        e.damage = 22; e.speed *= 1.05; e.isBoss = true;
        this.boss = e;
        this.game.hud.showBoss('FIELD MARSHAL');
      }
    };
  }

  _spawnGroup({ types, anchor, x, z, minR = 8, maxR = 20, credit = null, boss = false }) {
    if (anchor) ({ x, z } = this._anchor(anchor));
    const tag = this._tagger(credit, boss);
    for (const t of types) tag(this.game.enemies.spawnNear(t, x, z, minR, maxR));
  }

  _deliverGroup({ types, anchor, x, z, minR = 8, maxR = 20, credit = null, boss = false }) {
    if (anchor) ({ x, z } = this._anchor(anchor));
    const ang = Math.random() * Math.PI * 2, rr = minR + Math.random() * (maxR - minR);
    this.game.dropships.deliver(types, x + Math.cos(ang) * rr, z + Math.sin(ang) * rr, this._tagger(credit, boss));
  }

  /* ---- scripted events ---- */
  _initEvents() {
    this._elapsed = 0;
    this._events = (this.stage?.events || []).map(ev => {
      const e = { ...ev, fired: false };
      if (e.zone) e.zonePos = this._anchor(e.zone);
      return e;
    });
  }

  _checkEvents() {
    const player = this.game.player;
    for (const ev of this._events) {
      if (ev.fired) continue;
      let hit = false;
      if (ev.zone) hit = Math.hypot(player.position.x - ev.zonePos.x, player.position.z - ev.zonePos.z) < ev.radius;
      else if (ev.delay !== undefined) hit = this._elapsed >= ev.delay;
      else if (ev.objectiveDone) hit = this.objectives.find(o => o.id === ev.objectiveDone)?.done === true;
      else if (ev.progress) hit = (this.objectives.find(o => o.id === ev.progress.id)?.progress || 0) >= ev.progress.count;
      if (!hit) continue;
      ev.fired = true;
      this._runActions(ev.do || []);
    }
  }

  _runActions(actions) {
    for (const a of actions) {
      if (a.say) this.game.cortana.say(a.say);
      if (a.banner) this.game.hud.banner(a.banner);
      if (a.spawn) this._spawnGroup(a.spawn);
      if (a.dropship) this._deliverGroup(a.dropship);
    }
  }

  /* ---- defend zones ---- */
  _activateDefend(o) {
    o.locked = false;
    const geo = new THREE.RingGeometry(o.radius - 0.9, o.radius, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8ffcff, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    o.ring = new THREE.Mesh(geo, mat);
    o.ring.rotation.x = -Math.PI / 2;
    o.ring.position.set(o.pos.x, o.pos.y + 0.4, o.pos.z);
    this.game.scene.add(o.ring);
  }

  _updateDefend(o, dt, time) {
    const player = this.game.player;
    const inside = !player.dead &&
      Math.hypot(player.position.x - o.pos.x, player.position.z - o.pos.z) < o.radius;

    if (inside) o.timer = Math.max(0, o.timer - dt);
    if (o.ring) {
      o.ring.material.color.setHex(inside ? 0x8ffcff : 0xffb04c);
      o.ring.material.opacity = 0.35 + 0.2 * Math.sin(time * 0.004);
    }

    // timed waves, delivered by dropship, capped so it never floods
    o._waveIn -= dt;
    if (o.timer > 3 && o._waveIn <= 0 && this.game.enemies.aliveCount < 7) {
      const waves = o.waves.types;
      const types = waves[o._waveIdx % waves.length];
      o._waveIdx++;
      o._waveIn = o.waves.every;
      this._deliverGroup({ types, x: o.pos.x, z: o.pos.z, minR: o.waves.minR ?? 16, maxR: o.waves.maxR ?? 28 });
    }

    // live countdown in the objective list (throttled)
    const t = Math.ceil(o.timer);
    o.label = `${o.baseLabel} — ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}${inside ? '' : ' · RETURN TO THE ZONE'}`;

    if (o.timer <= 0) {
      if (o.ring) { this.game.scene.remove(o.ring); o.ring = null; }
      this._completeObjective(o);
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
      ({ x, z } = this._clearPoint({ x, z }, 1.0));
      const y = Math.max(this.game.world.heightAt(x, z), 0.2) + 1.2;
      const core = this._makeCore();
      core.position.set(x, y, z);
      this.game.scene.add(core);
      this.collectibles.push({ mesh: core, pos: core.position, taken: false });
      // every core is guarded — recovering them is a fight, not a stroll
      if (spec.guards) this._spawnGroup({ types: spec.guards, x, z, minR: 5, maxR: 12 });
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
    const cp = this._clearPoint({ x: pos.x, z: pos.z }, 2.4);
    pos.x = cp.x; pos.z = cp.z; pos.y = this.game.world.heightAt(cp.x, cp.z);
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
    // tagged kills credit their own objective; untagged fall back to the
    // first active eliminate (skirmish, legacy, and test spawns)
    let obj;
    if (e.objectiveId) obj = this.objectives.find(o => o.id === e.objectiveId && !o.done);
    else obj = this.objectives.find(o => o.type === 'eliminate' && !o.done);
    if (obj && obj.type === 'eliminate') {
      obj.remaining = Math.max(0, obj.remaining - 1);
      obj.progress = obj.count - obj.remaining;
      // reinforcements arrive as one dramatic batch when the field thins out
      if (this._reinforcePool?.length && obj.id === this._reinforceId &&
          obj.remaining <= this._reinforcePool.length + 1) {
        const s = this._reinforceSpec, a = this._anchor(s.anchor);
        const group = { types: this._reinforcePool, x: a.x, z: a.z, minR: s.minR, maxR: s.maxR, credit: obj.id };
        this._reinforcePool = [];
        if (s.via === 'dropship') this._deliverGroup(group);
        else this._spawnGroup(group);
      }
      if (obj.remaining === 0) this._completeObjective(obj);
    }
    if (e.isBoss) { this.boss = null; this.game.hud.hideBoss(); }
    if (this.mode === 'skirmish') this._maybeNextWave();
    this._refreshHud();
  }

  _completeObjective(o) {
    if (o.done) return;
    o.done = true;
    if (o.marker) o.marker = null;
    if (o.ring) { this.game.scene.remove(o.ring); o.ring = null; }
    // unlock anything whose requirements are now met
    for (const a of this.objectives) {
      if (!a.locked || !a.requires) continue;
      if (!a.requires.every(id => this.objectives.find(x => x.id === id)?.done)) continue;
      if (a.type === 'activate') {
        a.locked = false;
        this.game.cortana.say(['The console’s unlocked, Chief. Get to it.']);
      } else if (a.type === 'defend') {
        this._activateDefend(a);
      } else {
        a.locked = false;
      }
    }
    // deferred eliminate spawns cued off this objective
    for (const a of this.objectives) {
      if (a.type === 'eliminate' && !a.done && a.spawn?.after === o.id && !a._spawned) {
        a._spawned = true;
        this._spawnEnemies(a);
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
      // free the cursor so the next briefing's DEPLOY button is clickable
      this.game.input.exitLock();
      if (next < STAGES.length) this.loadStage(next);
      else this.game.hud.showVictory(this.game.player.score);
    }, 3600);
  }

  /* ============================ SKIRMISH ============================ */
  startSkirmish() {
    this.mode = 'skirmish';
    this.stage = null;
    this._teardown();
    const g = this.game;
    g.world.setTimeOfDay(0.34);
    g.world.setFogDensity(0.42);
    g.world.setWaves(0.42);
    g.world.playRadius = 165;
    const sp = this._clearPoint({ x: 76, z: 104 }, 0.8);
    g.player.spawn(sp.x, sp.z, 0.63);
    this.objectives = [{ id: 'wave', type: 'wave', label: 'Wave 1', done: false }];
    this.skirmishWave = 0;
    this._initEvents();
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
    const roll = () => {
      const r = Math.random();
      if (r < 0.12 + this.skirmishWave * 0.01) return 'drone';
      return r < 0.35 + this.skirmishWave * 0.03 ? 'elite' : 'grunt';
    };
    // half arrive by dropship for the show, half are already in the field
    const shipped = [];
    for (let i = 0; i < n; i++) {
      if (i < Math.min(3, n / 2)) shipped.push(roll());
      else this.game.enemies.spawnNear(roll(), 0, 0, 60, 150);
    }
    if (shipped.length) {
      const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 60;
      this.game.dropships.deliver(shipped, Math.cos(a) * r, Math.sin(a) * r, null);
    }
    this.objectives[0].label = `Wave ${this.skirmishWave}`;
    this.game.hud.banner(`WAVE ${this.skirmishWave}`);
    this._refreshHud();
  }

  _maybeNextWave() {
    if (this.game.enemies.aliveCount === 0 && !this.game.dropships.busy)
      setTimeout(() => this.active && this._nextWave(), 2000);
  }

  /* ============================ SHARED ============================ */
  _teardown() {
    this.game.enemies.clear();
    this.game.projectiles.clear();
    this.game.dropships.clear();
    if (this.game.cutscene) { this.game.cutscene.skip(); this.game.cutscene = null; }
    if (this._cutsceneProps) { this.game.scene.remove(this._cutsceneProps); this._cutsceneProps = null; }
    for (const c of this.collectibles) this.game.scene.remove(c.mesh);
    this.collectibles.length = 0;
    for (const o of this.objectives) if (o.ring) this.game.scene.remove(o.ring);
    if (this.console) { this.game.scene.remove(this.console.group); this.console = null; }
    this.boss = null;
    this.game.hud.hideBoss();
    this._reinforcePool = null;
    this._events = [];
  }

  _refreshHud() {
    this.game.hud.setObjectives(this.objectives, this.mode, this.game.player.score);
  }

  /* markers for the HUD waypoint compass */
  markers() {
    const out = [];
    for (const o of this.objectives) {
      if (o.done) continue;
      if (o.type === 'reach' && !o.locked && o.marker) out.push(o.marker);
      if (o.type === 'defend' && !o.locked && o.marker) out.push(o.marker);
      if (o.type === 'activate' && !o.locked && o.marker) out.push(o.marker);
    }
    for (const c of this.collectibles) if (!c.taken) out.push({ pos: c.pos, label: 'CORE', color: 0xffc040 });
    return out;
  }

  update(dt, time) {
    if (!this.active) return;
    const player = this.game.player;
    this._elapsed += dt;
    this._checkEvents();

    // defend zones tick + countdown HUD (throttled to 4 Hz)
    let defendLive = false;
    for (const o of this.objectives) {
      if (o.type === 'defend' && !o.done && !o.locked) { this._updateDefend(o, dt, time); defendLive = true; }
    }
    if (defendLive && time - this._hudTick > 250) { this._hudTick = time; this._refreshHud(); }

    // boss health bar + enrage phase at half health
    if (this.boss?.alive) {
      const frac = this.boss.health / this.boss.maxHealth;
      this.game.hud.updateBoss(frac);
      if (!this.boss._enraged && frac < 0.55) {
        this.boss._enraged = true;
        this.boss.speed *= 1.35;
        this.boss.cooldown *= 0.62;
        this.game.hud.banner('THE MARSHAL IS ENRAGED');
        this.game.cortana.say(['He’s tearing his armor off — watch it, Chief, he’s faster now!']);
        this._deliverGroup({ types: ['grunt', 'grunt'], x: this.boss.position.x, z: this.boss.position.z, minR: 10, maxR: 18 });
      }
    }

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
      if (o.type === 'reach' && !o.locked && this._tmp.subVectors(o.pos, player.position).lengthSq() < o.radius * o.radius) {
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
        const start = this._clearPoint(this._anchor(this.mode === 'campaign' ? this.stage.start : 'start'), 0.8);
        player.spawn(start.x, start.z, 0.63);
        this._respawning = false;
      }, 2600);
    }
  }
}
