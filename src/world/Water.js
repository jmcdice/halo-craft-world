import * as THREE from 'three';
import { WATER_LEVEL } from '../core/math.js';
import { HMAP_EXT } from './Terrain.js';

/* ============================================================
   Water — Gerstner-wave surface with planar reflection,
   fresnel, depth-based absorption and shoreline foam.
   ============================================================ */

export class Water {
  constructor(renderer, scene, camera, heightMap, waterNormal, mobile, shot = false) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const REFL_RES = shot ? 1024 : (mobile ? 1024 : 2048);
    this.reflRT = new THREE.WebGLRenderTarget(REFL_RES, REFL_RES, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.reflMatrix = new THREE.Matrix4();
    this.mirrorCam = new THREE.PerspectiveCamera();

    this.uniforms = {
      uTime: { value: 0 },
      uWave: { value: 0.12 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uDusk: { value: 0 },
      tReflect: { value: this.reflRT.texture },
      tNormal: { value: waterNormal },
      tHeight: { value: heightMap },
      uHmapExt: { value: HMAP_EXT },
      uReflMatrix: { value: this.reflMatrix },
      uDeep: { value: new THREE.Color(0x0a2e3c) },
      uShallow: { value: new THREE.Color(0x1f5a50) },
      uFogColor: { value: new THREE.Color(0xbcd0e0) },
      uFogNear: { value: 260 },
      uFogFar: { value: 1600 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      fog: false,
      vertexShader: /* glsl */`
        uniform float uTime;
        uniform float uWave;
        uniform mat4 uReflMatrix;
        varying vec3 vWorld;
        varying vec3 vNrm;
        varying vec4 vReflUv;
        varying float vCrest;
        void gerstner(in vec2 p, out vec3 disp, out vec3 nrm, out float crest){
          disp = vec3(0.0); nrm = vec3(0.0, 1.0, 0.0); crest = 0.0;
          const vec2 D[6] = vec2[6](
            normalize(vec2( 1.0, 0.18)), normalize(vec2( 0.72, 0.69)), normalize(vec2(-0.42, 0.91)),
            normalize(vec2( 0.88,-0.47)), normalize(vec2(-0.76,-0.39)), normalize(vec2( 0.16,-0.99))
          );
          const float L[6] = float[6](15.0, 9.2, 6.1, 4.4, 3.2, 2.4);
          const float A[6] = float[6](0.30, 0.23, 0.17, 0.12, 0.09, 0.07);
          for (int i=0;i<6;i++){
            float k = 6.28318 / L[i];
            float c = sqrt(9.8 / k);
            float a = A[i] * uWave;
            float q = 0.22 / (k * a * 6.0 + 1e-4);
            float f = k * (dot(D[i], p) - c * uTime);
            float sf = sin(f), cf = cos(f);
            disp.x += q * a * D[i].x * cf;
            disp.z += q * a * D[i].y * cf;
            disp.y += a * sf;
            nrm.x -= D[i].x * k * a * cf;
            nrm.z -= D[i].y * k * a * cf;
            nrm.y -= q * k * a * sf;
            crest += sf * (A[i] / 0.30);
          }
        }
        void main(){
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 disp, nrm; float crest;
          gerstner(wp.xz, disp, nrm, crest);
          wp += disp;
          vWorld = wp;
          vNrm = normalize(nrm);
          vCrest = crest;
          vReflUv = uReflMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform float uWave;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uDusk;
        uniform sampler2D tReflect;
        uniform sampler2D tNormal;
        uniform sampler2D tHeight;
        uniform float uHmapExt;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec3 vWorld;
        varying vec3 vNrm;
        varying vec4 vReflUv;
        varying float vCrest;
        vec3 sampleNrm(vec2 uv){
          vec3 t = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
          t.xy *= 0.45 + uWave * 1.8;
          return t;
        }
        void main(){
          float camDist = length(cameraPosition - vWorld);
          vec2 huv = vWorld.xz / (2.0 * uHmapExt) + 0.5;
          float ground = texture2D(tHeight, huv).r;
          float depth = -ground;
          vec3 gN = normalize(vNrm);
          float detailFade = exp(-camDist * 0.010);
          vec3 d1 = sampleNrm(vWorld.xz * 0.055 + uTime * vec2(0.021, 0.013));
          vec3 d2 = sampleNrm(vWorld.zx * 0.031 - uTime * vec2(0.011, 0.019) + 0.37);
          vec3 d3 = sampleNrm((vWorld.xz * mat2(0.8, -0.6, 0.6, 0.8)) * 0.013 + uTime * vec2(-0.006, 0.009) + 0.61);
          vec3 dN = normalize(vec3(d1.xy + d2.xy + d3.xy, d1.z * d2.z * d3.z));
          vec3 N = normalize(vec3(gN.x + dN.x * detailFade, gN.y, gN.z + dN.y * detailFade));
          vec3 V = normalize(cameraPosition - vWorld);
          float NdV = max(dot(N, V), 0.0);
          float fresnel = 0.025 + 0.975 * pow(1.0 - NdV, 5.0);
          vec2 ruv = vReflUv.xy / vReflUv.w;
          ruv += N.xz * (0.016 + 0.034 * uWave) * (0.25 + 0.75 * detailFade);
          ruv = clamp(ruv, vec2(0.001), vec2(0.999));
          vec3 refl = texture2D(tReflect, ruv).rgb;
          vec3 absorb = exp(-max(depth, 0.0) * vec3(0.42, 0.20, 0.15));
          vec3 body = mix(uDeep, uShallow, absorb.g);
          vec3 sandCol = vec3(0.42, 0.38, 0.26) * (0.55 + 0.45 * absorb);
          body = mix(sandCol, body, smoothstep(0.05, 1.4, depth));
          body = mix(body, body * vec3(1.15, 0.85, 0.7), uDusk * 0.5);
          vec3 col = mix(body, refl, clamp(fresnel * 1.5 + 0.08, 0.0, 1.0));
          vec3 H = normalize(V + uSunDir);
          vec3 Ng = normalize(vec3(gN.x + (d3.x * 0.5 + d2.x * 0.2) * detailFade, gN.y, gN.z + (d3.y * 0.5 + d2.y * 0.2) * detailFade));
          float NdH = max(dot(Ng, H), 0.0);
          float glint = pow(NdH, 340.0) * 2.6 + pow(NdH, 64.0) * 0.16;
          col += uSunColor * glint * smoothstep(0.0, 0.06, uSunDir.y);
          float foamN = texture2D(tNormal, vWorld.xz * 0.11 + uTime * vec2(0.008, -0.011)).g;
          float band = 1.0 - smoothstep(0.0, 1.15, depth);
          float stripe = sin(depth * 16.0 - uTime * 1.7 + foamN * 6.0) * 0.5 + 0.5;
          float foam = band * smoothstep(0.35, 0.85, stripe * (0.55 + 0.45 * foamN));
          foam *= exp(-camDist * 0.004);
          foam += (1.0 - smoothstep(0.0, 0.35, depth)) * 0.55 * foamN;
          foam += smoothstep(0.90, 1.0, vCrest * 0.5 + 0.5) * 0.16 * foamN * smoothstep(0.6, 1.0, uWave * 6.0);
          col = mix(col, vec3(0.88, 0.92, 0.93), clamp(foam, 0.0, 1.0) * 0.55);
          float fogF = smoothstep(uFogNear, uFogFar, camDist);
          col = mix(col, uFogColor, fogF);
          float alpha = mix(0.86, 0.985, smoothstep(0.0, 2.5, depth));
          alpha *= smoothstep(-0.25, 0.3, depth);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const geo = new THREE.PlaneGeometry(2 * HMAP_EXT, 2 * HMAP_EXT, mobile ? 220 : 300, mobile ? 220 : 300);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    // reflection scratch
    this._plane = new THREE.Plane();
    this._normal = new THREE.Vector3(0, 1, 0);
    this._mirrorPos = new THREE.Vector3(0, WATER_LEVEL, 0);
    this._camPos = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._look = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  renderReflection() {
    const { renderer, camera, scene, mirrorCam, reflMatrix, reflRT } = this;
    this._camPos.setFromMatrixPosition(camera.matrixWorld);
    this._view.subVectors(this._mirrorPos, this._camPos);
    if (this._view.dot(this._normal) > 0) return;
    this._view.reflect(this._normal).negate().add(this._mirrorPos);
    this._rot.extractRotation(camera.matrixWorld);
    this._look.set(0, 0, -1).applyMatrix4(this._rot).add(this._camPos);
    this._target.subVectors(this._mirrorPos, this._look);
    this._target.reflect(this._normal).negate().add(this._mirrorPos);
    mirrorCam.position.copy(this._view);
    mirrorCam.up.set(0, 1, 0).reflect(this._normal);
    mirrorCam.lookAt(this._target);
    mirrorCam.far = camera.far;
    mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
    reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    reflMatrix.multiply(mirrorCam.projectionMatrix);
    reflMatrix.multiply(mirrorCam.matrixWorldInverse);
    this._plane.setFromNormalAndCoplanarPoint(this._normal, this._mirrorPos);
    this._plane.applyMatrix4(mirrorCam.matrixWorldInverse);
    this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = mirrorCam.projectionMatrix;
    this._q.x = (Math.sign(this._clip.x) + pm.elements[8]) / pm.elements[0];
    this._q.y = (Math.sign(this._clip.y) + pm.elements[9]) / pm.elements[5];
    this._q.z = -1.0;
    this._q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    this._clip.multiplyScalar(2.0 / this._clip.dot(this._q));
    pm.elements[2] = this._clip.x;
    pm.elements[6] = this._clip.y;
    pm.elements[10] = this._clip.z + 1.0 - 0.003;
    pm.elements[14] = this._clip.w;
    this.mesh.visible = false;
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(reflRT);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, mirrorCam);
    renderer.setRenderTarget(prevRT);
    this.mesh.visible = true;
  }
}
