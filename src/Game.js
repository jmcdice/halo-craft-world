import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Input } from './core/Input.js';
import { World } from './world/World.js';
import { Player } from './entities/Player.js';
import { ProjectileManager } from './entities/Projectiles.js';
import { EnemyManager } from './entities/Enemies.js';
import { DropshipManager } from './entities/Dropship.js';
import { HUD } from './ui/HUD.js';
import { Cortana } from './ui/Cortana.js';
import { Ambient } from './audio/Ambient.js';
import { StageManager } from './campaign/StageManager.js';

const WEAPON = { name: 'MA5B', clip: 32, reserve: Infinity, clipSize: 32, damage: 13, fireRate: 95, reloadTime: 1500 };

export class Game {
  constructor() {
    const q = new URLSearchParams(location.search);
    const ua = navigator.userAgent;
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.mobile = q.get('mobile') === '1' ? true
      : q.get('mobile') === '0' ? false
      : (/Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 0 && coarse));
    this.canvas = document.getElementById('scene');

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.0 : 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 4200);
    this.camera.position.set(76, 22, 104);

    this.input = new Input(this.canvas, this.mobile);
    this.input.onReload = () => this.reload();
    this.world = new World(this.renderer, this.scene, this.camera, this.mobile);
    this.player = new Player(this.world, this.camera, this.input);
    this.projectiles = new ProjectileManager(this.scene, this.world);
    this.enemies = new EnemyManager(this.scene, this.world, this.projectiles, this.camera);
    this.dropships = new DropshipManager(this.scene, this.world, this.enemies);
    this.hud = new HUD(this.camera);
    this.cortana = new Cortana(document.getElementById('cortana'), document.getElementById('cortana-text'));
    this.ambient = new Ambient();
    this.dropships.onDeliver = () => this.ambient.rumble();
    this.stages = new StageManager(this);

    this._buildViewModel();
    this._buildComposer();

    this.weapon = { ...WEAPON };
    this.lastShot = 0;
    this.reloading = false;
    this.running = false;

    this.clock = new THREE.Clock();
    this._muzzle = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    addEventListener('resize', () => this._onResize());
    addEventListener('keydown', (e) => { if (e.code === 'KeyR') this.reload(); });
    this.canvas.addEventListener('click', () => { if (this.running && !this.input.locked) this.input.requestLock(); });

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _buildComposer() {
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(db.x, db.y, { type: THREE.HalfFloatType, samples: this.mobile ? 2 : 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(db.x, db.y), 0.30, 0.55, 0.86));
    this.composer.addPass(new OutputPass());
  }

  _buildViewModel() {
    // simple first-person weapon silhouette parented to the camera
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.5, metalness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), mat); body.position.set(0, 0, -0.2);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), mat);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.55);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.12), mat); mag.position.set(0, -0.14, -0.1);
    g.add(body, barrel, mag);
    g.position.set(0.22, -0.2, -0.35);
    this.viewModel = g;
    this.camera.add(g);
    this.scene.add(this.camera);
    // muzzle flash
    this.muzzleFlash = new THREE.PointLight(0x9ff, 0, 6, 2);
    this.muzzleFlash.position.set(0, 0.02, -0.8);
    g.add(this.muzzleFlash);
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  /* ---- weapon ---- */
  fire(time) {
    if (this.reloading || this.player.dead) return;
    if (time - this.lastShot < this.weapon.fireRate) return;
    if (this.weapon.clip <= 0) { this.reload(); return; }
    this.lastShot = time;
    this.weapon.clip--;
    this.hud.setAmmo(this.weapon.clip, this.weapon.reserve);

    this.camera.getWorldDirection(this._dir);
    this._muzzle.copy(this.camera.position).addScaledVector(this._dir, 0.6);
    // slight spread
    this._dir.x += (Math.random() - 0.5) * 0.012;
    this._dir.y += (Math.random() - 0.5) * 0.012;
    this.projectiles.spawn(this._muzzle, this._dir, true, this.weapon.damage);
    this.ambient.shoot();
    this.muzzleFlash.intensity = 5;
    this.viewModel.position.z = -0.28;   // recoil kick
  }

  reload() {
    if (this.reloading || this.weapon.clip === this.weapon.clipSize || this.weapon.reserve <= 0) return;
    this.reloading = true;
    this.hud.el.weaponName.textContent = 'RELOADING…';
    setTimeout(() => {
      const need = this.weapon.clipSize - this.weapon.clip;
      const take = Math.min(need, this.weapon.reserve);
      this.weapon.clip += take; this.weapon.reserve -= take;
      this.reloading = false;
      this.hud.setWeapon(this.weapon.name, this.weapon.clip, this.weapon.reserve);
    }, this.weapon.reloadTime);
  }

  resetWeapon() {
    this.weapon = { ...WEAPON };
    this.hud.setWeapon(this.weapon.name, this.weapon.clip, this.weapon.reserve);
  }

  /* ---- lifecycle ---- */
  _showTouch() { if (this.mobile) document.getElementById('touch-controls').classList.remove('hidden'); }
  startCampaign(stageIndex = 0) { this.running = true; this.resetWeapon(); this.ambient.enable(); this.hud.hideMenu(); this._showTouch(); this.stages.startCampaign(stageIndex); }
  startSkirmish() { this.running = true; this.resetWeapon(); this.ambient.enable(); this.hud.hideMenu(); this._showTouch(); this.stages.startSkirmish(); }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const time = performance.now();

    if (this.running && this.stages.active && this.input.locked) {
      this.player.update(dt);
      if (this.input.mouseDown) this.fire(time);
      this.dropships.update(dt, time);
      this.enemies.update(dt, this.player, time);
      this.projectiles.update(dt, this.enemies, this.player);
      this.stages.update(dt, time);
      this.hud.updatePlayer(this.player);
      this.hud.updateWaypoints(this.stages.markers(), this.player.position);
      this.hud.updateRadar(this.player, this.enemies, this.stages.markers(), dt);

      // score follows the fight: intensity from how many enemies are engaged
      if (time - (this._musicTick || 0) > 800) {
        this._musicTick = time;
        let engaged = 0;
        for (const e of this.enemies.list) if (e.alive && e.state > 0) engaged++;
        this.ambient.setMusicIntensity(Math.min(1, engaged / 3));
      }
    } else if (this.running) {
      // keep entities idle-updating for reflection consistency but don't advance combat hard
      this.projectiles.update(dt, this.enemies, this.player);
    }

    // decay viewmodel recoil + muzzle flash
    this.viewModel.position.z += (-0.35 - this.viewModel.position.z) * 0.35;
    this.muzzleFlash.intensity *= 0.6;

    this.world.update(t, dt);
    this.renderer.shadowMap.needsUpdate = true;
    this.camera.updateMatrixWorld();
    this.world.renderReflection();
    this.composer.render();
  }
}
