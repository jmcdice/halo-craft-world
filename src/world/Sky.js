import * as THREE from 'three';

/* ============================================================
   Sky — gradient dome (sun, FBM clouds, dusk stars) plus the
   iconic Halo ring arcing across the sky.
   ============================================================ */

export function buildSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTime: { value: 0 },
    uDusk: { value: 0 },
    uCloud: { value: 0.55 },
    uFogColor: { value: new THREE.Color(0xbcd0e0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir; uniform float uTime; uniform float uDusk;
      uniform float uCloud; uniform vec3 uFogColor;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.04+vec2(13.7,7.1); a*=0.5; } return s; }
      void main(){
        vec3 dir = normalize(vDir);
        float sunH = uSunDir.y; float dusk = uDusk;
        vec3 dayZen = vec3(0.16,0.38,0.72), dayHor = vec3(0.58,0.73,0.88);
        vec3 setZen = vec3(0.13,0.13,0.34), setHor = vec3(1.10,0.42,0.13);
        vec3 zen = mix(dayZen,setZen,dusk), hor = mix(dayHor,setHor,dusk);
        float t = pow(clamp(dir.y,0.0,1.0),0.48);
        vec3 col = mix(hor,zen,t);
        col = mix(uFogColor*0.92, col, smoothstep(-0.08,0.06,dir.y));
        float sd = max(dot(dir,uSunDir),0.0);
        vec3 sunTint = mix(vec3(1.0,0.95,0.82), vec3(1.0,0.55,0.25), dusk);
        float disc = smoothstep(0.99935,0.99965,sd);
        float glow = pow(sd,90.0)*0.9 + pow(sd,7.0)*(0.16+0.30*dusk);
        col += sunTint*glow;
        if (dir.y > 0.015){
          vec2 cuv = dir.xz/max(dir.y+0.10,0.05)*0.42; cuv += uTime*vec2(0.0055,0.0021);
          float warp = fbm(cuv*1.7+4.7);
          float q = fbm(cuv*1.15+warp*0.85);
          float cov = smoothstep(0.54,0.78,q)*smoothstep(0.015,0.16,dir.y)*uCloud;
          vec2 soff = normalize(uSunDir.xz+vec2(1e-4,0.0))*0.22;
          float q2 = fbm((cuv+soff)*1.15+warp*0.85);
          float litF = clamp(0.5+(q-q2)*5.0,0.0,1.0);
          float sunProx = pow(sd,3.0);
          vec3 shadeCol = mix(vec3(0.52,0.56,0.66), vec3(0.38,0.30,0.42), dusk);
          vec3 litCol = mix(vec3(1.04,1.0,0.96), vec3(1.15,0.62,0.40), dusk*(0.35+0.65*sunProx));
          vec3 cloudCol = mix(shadeCol,litCol,litF);
          col = mix(col,cloudCol,cov*0.88);
          disc *= 1.0 - cov*0.95;
        }
        col += sunTint*disc*5.0;
        float starVis = smoothstep(0.04,-0.06,sunH);
        if (starVis > 0.001 && dir.y > 0.05){
          vec2 sp = dir.xz/dir.y*90.0; vec2 cell = floor(sp); float h = hash(cell);
          if (h > 0.985){
            vec2 pos = fract(sp)-0.5;
            float star = smoothstep(0.08,0.0,length(pos));
            float tw = 0.6+0.4*sin(uTime*2.4+h*40.0);
            col += vec3(0.9,0.95,1.0)*star*tw*starVis*smoothstep(0.05,0.3,dir.y);
          }
        }
        gl_FragColor = vec4(col,1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/* ---------------- Halo ring texture (the inner landscape band) ---------------- */
function makeRingTexture() {
  const w = 4096, h = 384;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  // base ocean
  ctx.fillStyle = '#2c536f'; ctx.fillRect(0, 0, w, h);
  const rnd = (() => { let s = 991; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  // landmasses — organic green/tan blobs across the strip
  for (let i = 0; i < 520; i++) {
    const x = rnd() * w, y = 40 + rnd() * (h - 80);
    const r = 12 + rnd() * 90;
    const g = rnd();
    const col = g < 0.55 ? `rgba(${46 + rnd() * 40 | 0},${92 + rnd() * 50 | 0},${40 + rnd() * 30 | 0},0.55)`
      : g < 0.8 ? `rgba(${140 + rnd() * 40 | 0},${125 + rnd() * 30 | 0},${80 + rnd() * 30 | 0},0.5)`
        : `rgba(${210 + rnd() * 40 | 0},${215 + rnd() * 30 | 0},${220 + rnd() * 30 | 0},0.35)`; // snow/cloud
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + rnd() * 0.6), rnd() * 6.28, 0, 6.28); ctx.fill();
  }
  // cloud wisps
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.10})`;
    ctx.beginPath(); ctx.ellipse(rnd() * w, rnd() * h, 30 + rnd() * 120, 8 + rnd() * 22, 0, 0, 6.28); ctx.fill();
  }
  // structural walls at the ring edges (darker metallic rim)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, 'rgba(30,34,40,1)');
  grad.addColorStop(0.10, 'rgba(30,34,40,0)');
  grad.addColorStop(0.90, 'rgba(30,34,40,0)');
  grad.addColorStop(1.0, 'rgba(30,34,40,1)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------- Halo ring ---------------- */
export function buildHaloRing() {
  const R = 2400, bandWidth = 620, seg = 240;
  // open cylinder = a flat ribbon band; axis rotated horizontal so it arcs overhead
  const geo = new THREE.CylinderGeometry(R, R, bandWidth, seg, 1, true);
  geo.rotateZ(Math.PI / 2);        // axis Y -> X (arc rises in +Y, passes over head along X)
  const tex = makeRingTexture();
  tex.repeat.set(6, 1);            // wrap the landscape several times around
  const uniforms = {
    map: { value: tex },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uDusk: { value: 0 },
    uFogColor: { value: new THREE.Color(0xbcd0e0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    fog: false,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vN;
      void main(){
        vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
        vWorld = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 uSunDir; uniform float uDusk; uniform vec3 uFogColor;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vN;
      void main(){
        vec3 dir = normalize(vWorld);
        // fade the ring out near/below the horizon so it reads as sky, not a wall
        float horizon = smoothstep(-0.02, 0.16, dir.y);
        if (horizon < 0.004) discard;
        vec3 tex = texture2D(map, vUv).rgb;
        // simple sun shading on the inner surface
        float lit = clamp(0.35 + 0.65 * max(dot(normalize(vN), uSunDir), 0.0), 0.25, 1.15);
        vec3 col = tex * lit * 1.28;
        col = mix(col, col * vec3(1.1, 0.8, 0.62), uDusk * 0.6);   // warm at dusk
        // atmospheric haze toward the far end + blend to sky/fog low down
        col = mix(uFogColor, col, horizon);
        float alpha = horizon * 0.96;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // optional URL tuning: ?rx=&ry=&rz=&py=  (radians / metres)
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
  mesh.position.set(0, num('py', 290), 0);
  // turn the ring plane diagonal to the default view + tilt, so it reads as a
  // sweeping arc across the sky instead of an edge-on column.
  mesh.rotation.set(num('rx', -0.1), num('ry', 0.5), num('rz', 0.33));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;            // after sky dome, before scene depth writes matter
  return { mesh, uniforms };
}
