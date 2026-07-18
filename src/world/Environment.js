import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise, terrainH, terrainSlope, shoreRadiusAt, sstep } from '../core/math.js';

/* ============================================================
   Environment — instanced forests, rocks, a dock+lantern, and
   atmospheric particles (mist, fireflies, pollen) + birds.
   ============================================================ */

function colorizeGeo(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function mergeParts(parts) {
  const uni = parts.map(g => g.index ? g.toNonIndexed() : g);
  return BufferGeometryUtils.mergeGeometries(uni);
}
function makePineGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.13, 0.26, 2.2, 6); trunk.translate(0, 1.1, 0);
  parts.push(colorizeGeo(trunk, new THREE.Color(0x4a3828)));
  const base = new THREE.Color(0x3f6b46), tip = new THREE.Color(0x5a8f54);
  [[2.3, 3.4, 2.6], [1.75, 2.9, 4.6], [1.15, 2.5, 6.4]].forEach(([r, h, y], i) => {
    const cone = new THREE.ConeGeometry(r, h, 8); cone.translate(0, y, 0);
    parts.push(colorizeGeo(cone, base.clone().lerp(tip, i / 2)));
  });
  return mergeParts(parts);
}
function makeBroadGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.11, 0.2, 2.6, 6); trunk.translate(0, 1.3, 0);
  parts.push(colorizeGeo(trunk, new THREE.Color(0x54402e)));
  const blob = new THREE.Color(0x5d7f42);
  [[0, 4.0, 0, 2.1], [0.9, 3.3, 0.4, 1.4], [-0.8, 3.5, -0.3, 1.3]].forEach(([x, y, z, r]) => {
    const s = new THREE.IcosahedronGeometry(r, 1); s.translate(x, y, z);
    parts.push(colorizeGeo(s, blob));
  });
  return mergeParts(parts);
}

function makeSoftSprite() {
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

export class Environment {
  constructor(scene, mobile, obstacles) {
    this.scene = scene;
    this.obstacles = obstacles;
    this.windUniform = { value: 0 };
    this.birds = [];
    this.particleUniforms = [];
    this.softTex = makeSoftSprite();

    // trunk = hard collision body, clear = canopy footprint spawns must avoid
    this._scatterTrees(makePineGeo(), mobile ? 1400 : 2300, 3.1, 0.7, 1.5, { trunk: s => 0.30 * s + 0.12, clear: s => 1.6 * s + 0.4 });
    this._scatterTrees(makeBroadGeo(), mobile ? 380 : 650, 8.7, 0.5, 1.0, { trunk: s => 0.22 * s + 0.10, clear: s => 1.1 * s + 0.3 });
    this._scatterRocks(mobile ? 110 : 170);
    this._buildDock();
    this._buildMist();
    this._buildFireflies();
    this._buildPollen();
    this._buildBirds();
  }

  _treeMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    const wind = this.windUniform;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 iwp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          float swayPh = iwp.x*0.31 + iwp.z*0.23;
          float swayAmt = smoothstep(0.5,6.0,transformed.y);
          transformed.x += (sin(uWind*1.3+swayPh)+sin(uWind*2.7+swayPh*1.7)*0.4)*0.06*swayAmt;
          transformed.z += cos(uWind*1.1+swayPh*1.3)*0.05*swayAmt;
        #endif
        `);
    };
    return m;
  }

  _scatterTrees(geo, count, seedOff, sMin, sMax, radii) {
    const inst = new THREE.InstancedMesh(geo, this._treeMaterial(), count);
    inst.castShadow = true; inst.receiveShadow = true;
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 40) {
      tries++;
      const a = Math.random() * Math.PI * 2;
      const rr = 40 + Math.pow(Math.random(), 0.72) * 330;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = terrainH(x, z);
      if (h < 0.9 || h > 46) continue;
      if (terrainSlope(x, z) > 0.62) continue;
      if (Noise.fbm(x * 0.012 + seedOff, z * 0.012 - seedOff, 3) < -0.08) continue;
      const s = sMin + Math.random() * (sMax - sMin);
      dummy.position.set(x, h - 0.15, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.scale.set(s * (0.9 + Math.random() * 0.2), s, s * (0.9 + Math.random() * 0.2));
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      col.setHSL(0.25 + Math.random() * 0.07, 0.26 + Math.random() * 0.16, 0.80 + Math.random() * 0.20);
      inst.setColorAt(placed, col);
      this.obstacles?.add(x, z, radii.trunk(s), radii.clear(s));
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.scene.add(inst);
  }

  _scatterRocks(count) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const n = 1 + Noise.fbm(v.x * 0.9 + 5, v.y * 0.9 + v.z, 3) * 0.35;
      v.multiplyScalar(n); pos.setXYZ(i, v.x, v.y * 0.72, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f6c64, roughness: 0.95 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = true; inst.receiveShadow = true;
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 40) {
      tries++;
      const a = Math.random() * Math.PI * 2;
      const shoreR = shoreRadiusAt(a);
      const rr = Math.random() < 0.65 ? shoreR + (Math.random() * 22 - 9) : 90 + Math.random() * 260;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = terrainH(x, z);
      if (h < -2.5) continue;
      const s = 0.4 + Math.pow(Math.random(), 1.8) * 2.6;
      dummy.position.set(x, h + s * 0.12, z);
      dummy.rotation.set(Math.random() * 0.4, Math.random() * Math.PI * 2, Math.random() * 0.4);
      dummy.scale.set(s * (0.7 + Math.random() * 0.7), s * (0.6 + Math.random() * 0.5), s * (0.7 + Math.random() * 0.7));
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      col.setHSL(0.08 + Math.random() * 0.04, 0.05 + Math.random() * 0.08, 0.62 + Math.random() * 0.3);
      inst.setColorAt(placed, col);
      // only boulders big enough to matter get a hard body; pebbles are walkable
      if (h > -0.5) this.obstacles?.add(x, z, s > 0.75 ? s * 0.85 : 0, Math.max(s * 1.1, 0.5));
      placed++;
    }
    inst.count = placed;
    this.scene.add(inst);
  }

  _buildDock() {
    const group = new THREE.Group();
    const DOCK_ANGLE = 1.05;
    const shoreR = shoreRadiusAt(DOCK_ANGLE);
    const dir = new THREE.Vector2(Math.cos(DOCK_ANGLE), Math.sin(DOCK_ANGLE));
    const rStart = shoreR + 7, rEnd = shoreR - 15;
    const len = rStart - rEnd, deckY = 0.62, width = 2.3;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.85, metalness: 0.02 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x6d5238, roughness: 0.9 });

    const plankGeo = new THREE.BoxGeometry(width, 0.09, 0.34);
    const nPlanks = Math.floor(len / 0.42);
    const planks = new THREE.InstancedMesh(plankGeo, woodMat, nPlanks);
    planks.castShadow = true; planks.receiveShadow = true;
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    for (let i = 0; i < nPlanks; i++) {
      const rr = rStart - i * 0.42;
      dummy.position.set(dir.x * rr, deckY, dir.y * rr);
      dummy.rotation.y = -DOCK_ANGLE + Math.PI / 2; dummy.updateMatrix();
      planks.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.075, 0.32, 0.30 + Math.random() * 0.10); planks.setColorAt(i, col);
    }
    group.add(planks);

    const stringer = new THREE.BoxGeometry(0.16, 0.2, len);
    [-width / 2 + 0.15, width / 2 - 0.15].forEach(off => {
      const m = new THREE.Mesh(stringer, woodDark);
      const mid = (rStart + rEnd) / 2, perp = new THREE.Vector2(-dir.y, dir.x);
      m.position.set(dir.x * mid + perp.x * off, deckY - 0.14, dir.y * mid + perp.y * off);
      m.rotation.y = -DOCK_ANGLE; m.castShadow = true; group.add(m);
    });
    const postGeo = new THREE.CylinderGeometry(0.11, 0.13, 3.4, 7);
    for (let i = 0; i < 4; i++) {
      const rr = rStart - 1.2 - i * (len - 2.4) / 3;
      [-width / 2 + 0.12, width / 2 - 0.12].forEach(off => {
        const perp = new THREE.Vector2(-dir.y, dir.x);
        const px = dir.x * rr + perp.x * off, pz = dir.y * rr + perp.y * off;
        const ground = terrainH(px, pz);
        const post = new THREE.Mesh(postGeo, woodDark);
        post.position.set(px, (deckY + ground - 0.4) / 2 + 0.4, pz);
        post.scale.y = (deckY - ground + 1.2) / 3.4; post.castShadow = true; group.add(post);
      });
    }
    const lp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6), woodDark);
    pole.position.y = 0.75; pole.castShadow = true;
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffb35c, emissiveIntensity: 3.2, roughness: 0.4 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), lampMat); lamp.position.y = 1.55;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 8), woodDark); cap.position.y = 1.74;
    lp.add(pole, lamp, cap);
    lp.position.set(dir.x * (rEnd + 0.6), deckY, dir.y * (rEnd + 0.6));
    group.add(lp);
    const light = new THREE.PointLight(0xffa050, 0, 26, 2);
    light.position.set(dir.x * (rEnd + 0.6), deckY + 1.6, dir.y * (rEnd + 0.6));
    group.add(light);
    this.lanternLight = light; this.lanternLamp = lampMat;
    this.scene.add(group);
  }

  _buildMist() {
    const N = 70;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N), size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, rr = shoreRadiusAt(a) + (Math.random() * 12 - 5);
      pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = 0.25 + Math.random() * 1.1; pos[i * 3 + 2] = Math.sin(a) * rr;
      seed[i] = Math.random() * 100; size[i] = 14 + Math.random() * 30;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const uni = { uTime: { value: 0 }, uOpacity: { value: 0.5 }, uDusk: { value: 0 }, tMap: { value: this.softTex } };
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aSeed; attribute float aSize; uniform float uTime; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime*0.05+aSeed)*6.0 + uTime*0.25*fract(aSeed*0.37);
          p.z += cos(uTime*0.043+aSeed*1.3)*6.0; p.y += sin(uTime*0.09+aSeed*2.1)*0.4;
          vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
          gl_PointSize = min(aSize*(180.0/-mv.z),150.0);
          vA = 0.5+0.5*sin(uTime*0.11+aSeed*3.7);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; uniform float uOpacity; uniform float uDusk; varying float vA;
        void main(){ float a=texture2D(tMap,gl_PointCoord).a;
          vec3 tint=mix(vec3(0.85,0.90,0.95),vec3(0.95,0.72,0.55),uDusk);
          gl_FragColor=vec4(tint,a*vA*uOpacity*0.06); if(gl_FragColor.a<0.004)discard; }`,
    });
    this.mist = new THREE.Points(geo, mat); this.mist.renderOrder = 3;
    this.particleUniforms.push(uni); this.scene.add(this.mist);
  }

  _buildFireflies() {
    const N = 130;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, rr = shoreRadiusAt(a) + 4 + Math.random() * 30;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      pos[i * 3] = x; pos[i * 3 + 1] = terrainH(x, z) + 0.4 + Math.random() * 2.4; pos[i * 3 + 2] = z;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const uni = { uTime: { value: 0 }, uDusk: { value: 0 }, tMap: { value: this.softTex } };
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float aSeed; uniform float uTime; varying float vB;
        void main(){ vec3 p=position;
          p.x+=sin(uTime*0.4+aSeed)*1.6; p.y+=sin(uTime*0.7+aSeed*2.0)*0.7; p.z+=cos(uTime*0.5+aSeed*1.2)*1.6;
          vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv;
          gl_PointSize=min(5.5*(60.0/-mv.z),22.0);
          float blink=sin(uTime*1.4+aSeed*7.0); vB=smoothstep(0.25,0.9,blink); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; uniform float uDusk; varying float vB;
        void main(){ float a=texture2D(tMap,gl_PointCoord).a; float vis=smoothstep(0.45,0.75,uDusk);
          gl_FragColor=vec4(vec3(0.75,1.0,0.45)*1.6,a*vB*vis); if(gl_FragColor.a<0.01)discard; }`,
    });
    this.fireflies = new THREE.Points(geo, mat); this.fireflies.renderOrder = 4;
    this.particleUniforms.push(uni); this.scene.add(this.fireflies);
  }

  _buildPollen() {
    const N = 240;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 140;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      pos[i * 3] = x; pos[i * 3 + 1] = Math.max(terrainH(x, z), 0) + 0.5 + Math.random() * 9; pos[i * 3 + 2] = z;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const uni = { uTime: { value: 0 }, tMap: { value: this.softTex } };
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float aSeed; uniform float uTime;
        void main(){ vec3 p=position;
          p.x+=sin(uTime*0.12+aSeed)*2.2; p.y+=sin(uTime*0.21+aSeed*1.7)*1.2; p.z+=cos(uTime*0.15+aSeed*0.9)*2.2;
          vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=min(2.6*(60.0/-mv.z),10.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap;
        void main(){ float a=texture2D(tMap,gl_PointCoord).a; gl_FragColor=vec4(vec3(1.0,0.92,0.72)*0.9,a*0.20); if(gl_FragColor.a<0.01)discard; }`,
    });
    this.pollen = new THREE.Points(geo, mat); this.pollen.renderOrder = 4;
    this.particleUniforms.push(uni); this.scene.add(this.pollen);
  }

  _buildBirds() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0.28, 0, 0, -0.28, -1.05, 0, 0.05,
      0, 0, -0.28, 0, 0, 0.28, 1.05, 0, 0.05,
    ]), 3));
    for (let i = 0; i < 9; i++) {
      const uPhase = { value: Math.random() * 10 };
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPhase }, side: THREE.DoubleSide,
        vertexShader: /* glsl */`
          uniform float uTime; uniform float uPhase;
          void main(){ vec3 p=position; float flap=sin(uTime*8.5+uPhase);
            p.y+=flap*abs(p.x)*0.85; p.x*=1.0-abs(flap)*0.18;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
        fragmentShader: `void main(){ gl_FragColor=vec4(0.10,0.11,0.13,1.0); }`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.userData = { mat, r: 60 + Math.random() * 70, h: 26 + Math.random() * 22, speed: (0.05 + Math.random() * 0.045) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * Math.PI * 2, scale: 1.1 + Math.random() * 0.9 };
      m.scale.setScalar(m.userData.scale);
      this.scene.add(m); this.birds.push(m);
    }
  }

  update(t, dusk) {
    this.windUniform.value = t;
    for (const u of this.particleUniforms) { u.uTime.value = t; if (u.uDusk) u.uDusk.value = dusk; }
    for (const b of this.birds) {
      const u = b.userData, a = u.ph + t * u.speed;
      b.position.set(Math.cos(a) * u.r, u.h + Math.sin(t * 0.4 + u.ph) * 3, Math.sin(a) * u.r);
      b.rotation.y = -a + (u.speed > 0 ? 0 : Math.PI);
      b.rotation.z = Math.sin(t * 0.7 + u.ph) * 0.15;
      u.mat.uniforms.uTime.value = t;
    }
    // lantern flicker at dusk/night
    const lampOn = sstep(0.45, 0.7, dusk);
    this.lanternLight.intensity = lampOn * (26 + Math.sin(t * 11.3) * 2.5 + Math.sin(t * 27.7) * 1.5);
    this.lanternLamp.emissiveIntensity = 0.4 + lampOn * (3.0 + Math.sin(t * 13.1) * 0.35);
  }

  setMistOpacity(v) { this.mist.material.uniforms.uOpacity.value = v; }
}
