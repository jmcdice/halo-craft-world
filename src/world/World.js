import * as THREE from 'three';
import { clamp, lerp, sstep, terrainH, terrainSlope, terrainNormal, shoreRadiusAt, WATER_LEVEL } from '../core/math.js';
import { buildTerrain, buildHeightMap } from './Terrain.js';
import { Water } from './Water.js';
import { buildSky, buildHaloRing } from './Sky.js';
import { Environment } from './Environment.js';
import { ObstacleField } from './Obstacles.js';

/* ============================================================
   World — assembles terrain, water, sky+ring, environment and
   lighting, and owns the time-of-day system.
   Exposes ground queries used by player/enemy collision.
   ============================================================ */

export class World {
  constructor(renderer, scene, camera, mobile) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.mobile = mobile;

    scene.fog = new THREE.Fog(0xbcd0e0, 260, 1600);

    // terrain + height map
    this.heightMap = buildHeightMap();
    this.terrain = buildTerrain(mobile);
    scene.add(this.terrain);

    // sky dome + halo ring
    const sky = buildSky(); this.skyUniforms = sky.uniforms; scene.add(sky.mesh);
    const ring = buildHaloRing(); this.ringUniforms = ring.uniforms; this.ring = ring.mesh; scene.add(ring.mesh);

    // water (needs normal map, loaded async but fine)
    const waterNrm = new THREE.TextureLoader().load('./textures/waternormals.jpg');
    waterNrm.wrapS = waterNrm.wrapT = THREE.RepeatWrapping;
    this.water = new Water(renderer, scene, camera, this.heightMap, waterNrm, mobile);

    // environment (registers its trees/rocks into the obstacle field)
    this.obstacles = new ObstacleField();
    this.env = new Environment(scene, mobile, this.obstacles);
    this._colOut = { x: 0, z: 0 };

    // lighting
    this._buildLights();

    // scratch
    this._sunDir = new THREE.Vector3();
    this._c1 = new THREE.Color(); this._c2 = new THREE.Color(); this._fogC = new THREE.Color();
    this._n = new THREE.Vector3();

    // playable boundary; stages may widen it (e.g. into the mountains)
    this.playRadius = 165;

    this.currentDusk = 0;
    this.setTimeOfDay(0.32);   // default: bright morning for combat readability
    this.setFogDensity(0.42);
    this.setWaves(0.42);
  }

  _buildLights() {
    const shot = false, mobile = this.mobile;
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.castShadow = true;
    const sm = mobile ? 2048 : 4096;
    this.sunLight.shadow.mapSize.set(sm, sm);
    const s = this.sunLight.shadow.camera;
    s.left = -300; s.right = 300; s.top = 300; s.bottom = -300; s.near = 10; s.far = 1200;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 1.5;
    this.scene.add(this.sunLight, this.sunLight.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4e8, 0x4a463a, 0.55);
    this.amb = new THREE.AmbientLight(0x30405a, 0.25);
    this.bounce = new THREE.DirectionalLight(0xff9a5a, 0.0);
    this.bounce.position.set(-200, 80, -120);
    this.scene.add(this.hemi, this.amb, this.bounce);
  }

  /* tt: 0=dawn -> 0.45=noon -> 0.85=dusk -> 1=night */
  setTimeOfDay(tt) {
    this.timeOfDay = tt;
    let elev;
    if (tt < 0.45) elev = lerp(11, 54, tt / 0.45);
    else elev = lerp(54, -5, (tt - 0.45) / 0.55);
    const azim = lerp(72, 288, tt);
    const el = THREE.MathUtils.degToRad(elev), az = THREE.MathUtils.degToRad(azim);
    this._sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    const sunH = this._sunDir.y;
    const dusk = sstep(0.45, 0.06, sunH);
    this.currentDusk = dusk;

    this.sunLight.position.copy(this._sunDir).multiplyScalar(420);
    this.sunLight.intensity = 3.6 * clamp(sunH * 3.5 + 0.25, 0.38, 1.0);
    this._c1.set(0xfff3e0).lerp(this._c2.set(0xff7a28), dusk);
    this.sunLight.color.copy(this._c1);

    this.hemi.intensity = lerp(0.75, 0.85, dusk);
    this._c1.set(0xbcd4e8).lerp(this._c2.set(0x6a6a9a), dusk); this.hemi.color.copy(this._c1);
    this._c1.set(0x55503f).lerp(this._c2.set(0x453a48), dusk); this.hemi.groundColor.copy(this._c1);
    this.amb.intensity = lerp(0.30, 0.60, dusk);
    this.bounce.intensity = lerp(0.0, 0.55, dusk);
    this.bounce.position.set(-this._sunDir.x * 300, 90, -this._sunDir.z * 300);

    this._c1.set(0x93b2cc).lerp(this._c2.set(0xd8865a), dusk);
    this._fogC.copy(this._c1).lerp(this._c2.set(0x8a7a9a), dusk * dusk * 0.35);
    this.scene.fog.color.copy(this._fogC);

    this.skyUniforms.uSunDir.value.copy(this._sunDir);
    this.skyUniforms.uDusk.value = dusk;
    this.skyUniforms.uFogColor.value.copy(this._fogC);
    this.ringUniforms.uSunDir.value.copy(this._sunDir);
    this.ringUniforms.uDusk.value = dusk;
    this.ringUniforms.uFogColor.value.copy(this._fogC);
    this.water.uniforms.uSunDir.value.copy(this._sunDir);
    this.water.uniforms.uSunColor.value.copy(this.sunLight.color).multiplyScalar(clamp(this.sunLight.intensity / 3, 0.3, 1.2));
    this.water.uniforms.uDusk.value = dusk;
    this.water.uniforms.uFogColor.value.copy(this._fogC);
  }

  setFogDensity(f) {
    this.scene.fog.near = lerp(520, 130, f);
    this.scene.fog.far = lerp(2400, 780, f);
    this.water.uniforms.uFogNear.value = this.scene.fog.near;
    this.water.uniforms.uFogFar.value = this.scene.fog.far;
    this.env.setMistOpacity(lerp(0.15, 1.0, f));
  }

  setWaves(v) { this.water.uniforms.uWave.value = lerp(0.03, 0.30, v); }

  /* ---- ground queries (shared collision) ---- */
  heightAt(x, z) { return terrainH(x, z); }
  slopeAt(x, z) { return terrainSlope(x, z); }
  normalAt(x, z) { return terrainNormal(x, z, this._n); }
  shoreRadiusAt(a) { return shoreRadiusAt(a); }
  get waterLevel() { return WATER_LEVEL; }

  /* ---- obstacle queries (trees / rocks) ---- */
  isClear(x, z, radius) { return this.obstacles.isClear(x, z, radius); }
  /* nearest obstacle-free spot that is also on dry land */
  findClear(x, z, radius, maxDist) {
    return this.obstacles.findClear(x, z, radius, maxDist, (px, pz) => terrainH(px, pz) > 0.4);
  }
  /* push a mover of `radius` out of hard bodies; returns shared {x,z} scratch */
  collide(x, z, radius) { return this.obstacles.collideCircle(x, z, radius, this._colOut); }

  update(t, dt) {
    this.water.uniforms.uTime.value = t;
    this.skyUniforms.uTime.value = t;
    this.env.update(t, this.currentDusk);
    // keep the ring "infinitely far" so the player never approaches it
    this.ring.position.x = this.camera.position.x;
    this.ring.position.z = this.camera.position.z;
  }

  renderReflection() { this.water.renderReflection(); }
}
