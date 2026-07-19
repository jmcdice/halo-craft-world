import * as THREE from 'three';

/* ============================================================
   Sky — gradient dome (sun, FBM clouds) that turns into deep
   space after sundown: a dense multi-layer starfield, a milky-
   way band with dust lanes, faint nebula colour, and a banded
   gas giant ("Threshold") that hangs in the sky day and night —
   pale like a daytime moon, looming after dark. Plus the iconic
   Halo ring arcing across the sky.
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
      /* one hashed star layer over a planar sky projection */
      vec3 starLayer(vec2 sp, float density, float size){
        vec2 cell = floor(sp); float h = hash(cell);
        if (h < 1.0 - density) return vec3(0.0);
        vec2 jit = vec2(hash(cell+7.31), hash(cell+3.17)) - 0.5;
        vec2 pos = fract(sp) - 0.5 - jit*0.55;
        float star = smoothstep(size, 0.0, length(pos));
        float tw = 0.55 + 0.45*sin(uTime*(1.4+h*2.2) + h*47.0);
        // colour cast: most white, some blue giants, some warm
        float hc = hash(cell+11.7);
        vec3 tint = hc < 0.6 ? vec3(0.92,0.95,1.0) : hc < 0.85 ? vec3(0.70,0.82,1.0) : vec3(1.0,0.85,0.65);
        return tint * star * tw * (0.35 + 0.65*h);
      }
      void main(){
        vec3 dir = normalize(vDir);
        float sunH = uSunDir.y; float dusk = uDusk;
        float night = smoothstep(0.03, -0.10, sunH);   // 0 day -> 1 deep night
        vec3 dayZen = vec3(0.16,0.38,0.72), dayHor = vec3(0.58,0.73,0.88);
        vec3 setZen = vec3(0.13,0.13,0.34), setHor = vec3(1.10,0.42,0.13);
        vec3 zen = mix(dayZen,setZen,dusk), hor = mix(dayHor,setHor,dusk);
        // after sundown the dome drops to near-black space
        zen = mix(zen, vec3(0.012,0.018,0.05), night*0.9);
        hor = mix(hor, vec3(0.03,0.045,0.10), night*0.85);
        float t = pow(clamp(dir.y,0.0,1.0),0.48);
        vec3 col = mix(hor,zen,t);
        col = mix(uFogColor*mix(0.92,0.30,night), col, smoothstep(-0.08,0.06,dir.y));
        float sd = max(dot(dir,uSunDir),0.0);
        vec3 sunTint = mix(vec3(1.0,0.95,0.82), vec3(1.0,0.55,0.25), dusk);
        float disc = smoothstep(0.99935,0.99965,sd);
        float glow = pow(sd,90.0)*0.9 + pow(sd,7.0)*(0.16+0.30*dusk);
        col += sunTint*glow*(1.0-night);

        /* ---- deep-space layer (fades in through dusk) ---- */
        float starVis = smoothstep(0.04,-0.06,sunH);
        if (starVis > 0.001 && dir.y > 0.02){
          float horizFade = smoothstep(0.02,0.22,dir.y);
          vec2 sp = dir.xz/(dir.y+0.18);
          // milky-way band: bright ridge with fbm structure and dark dust lanes
          vec3 mwAxis = normalize(vec3(0.58,0.30,-0.75));
          float bd = dot(dir, mwAxis);
          float band = exp(-bd*bd*22.0);
          vec2 mp = sp*3.1 + 11.3;
          float wisp = fbm(mp);
          float dust = fbm(mp*2.3 + 31.7);
          float mw = band*(0.25 + wisp*0.75)*(1.0 - smoothstep(0.45,0.8,dust)*0.85);
          col += vec3(0.62,0.66,0.82)*mw*0.16*starVis*horizFade;
          // faint nebula colour blotches
          float neb = fbm(sp*1.3 + 57.1);
          vec3 nebCol = mix(vec3(0.10,0.04,0.16), vec3(0.03,0.10,0.14), vnoise(sp*0.7+3.0));
          col += nebCol*smoothstep(0.55,0.9,neb)*0.35*starVis*horizFade;
          // three star layers: fine dust, mid field, bright heroes
          vec3 stars = starLayer(sp*260.0, 0.06, 0.42)*0.35
                     + starLayer(sp*130.0, 0.035, 0.30)*0.7
                     + starLayer(sp*55.0, 0.018, 0.16)*1.25;
          stars *= 1.0 + band*1.6;                    // field thickens inside the band
          col += stars*starVis*horizFade;
        }

        /* ---- gas giant "Threshold": banded planet, day-and-night ---- */
        {
          vec3 pDir = normalize(vec3(-0.50, 0.46, -0.74));
          float pRad = 0.16;
          float d = length(dir - pDir);
          float glowP = exp(-max(d-pRad,0.0)*55.0);
          float inside = smoothstep(pRad, pRad*0.988, d);
          vec3 e1 = normalize(cross(pDir, vec3(0.0,1.0,0.0)));
          vec3 e2 = cross(e1, pDir);
          if (inside > 0.001){
            float u = dot(dir-pDir, e1)/pRad, v = dot(dir-pDir, e2)/pRad;
            float zz = sqrt(max(1.0 - u*u - v*v, 0.0));
            // tilted latitude bands with turbulent edges
            float lat = v*0.92 + u*0.22;
            float turb = fbm(vec2(u*2.6, lat*4.2))*0.35;
            float bandN = vnoise(vec2((lat+turb)*7.0, 3.3))*0.62 + vnoise(vec2((lat+turb)*16.0, 8.7))*0.38;
            vec3 pcol = mix(vec3(0.84,0.72,0.55), vec3(0.48,0.36,0.30), bandN);
            pcol = mix(pcol, vec3(0.72,0.50,0.38), smoothstep(0.62,0.9,vnoise(vec2(lat*3.1,1.2)))*0.6);
            // sun-lit hemisphere + limb darkening
            vec3 nrm = e1*u + e2*v + pDir*zz;
            float lit = clamp(dot(nrm, uSunDir)*0.85 + 0.15, 0.0, 1.15);
            pcol *= (0.25 + 0.75*lit) * (0.55 + 0.45*zz);
            pcol += vec3(0.30,0.42,0.65)*pow(1.0-zz,2.5)*0.5;   // atmosphere limb
            // by day it washes toward the sky like a daytime moon
            float presence = mix(0.42, 1.0, night);
            col = mix(col, pcol, inside*presence);
          }
          col += vec3(0.55,0.65,0.95)*glowP*0.10*(0.35+0.65*night);
        }

        if (dir.y > 0.015){
          vec2 cuv = dir.xz/max(dir.y+0.10,0.05)*0.42; cuv += uTime*vec2(0.0055,0.0021);
          float warp = fbm(cuv*1.7+4.7);
          float q = fbm(cuv*1.15+warp*0.85);
          float cov = smoothstep(0.54,0.78,q)*smoothstep(0.015,0.16,dir.y)*uCloud;
          cov *= 1.0 - night*0.55;                    // thinner cloud deck at night
          vec2 soff = normalize(uSunDir.xz+vec2(1e-4,0.0))*0.22;
          float q2 = fbm((cuv+soff)*1.15+warp*0.85);
          float litF = clamp(0.5+(q-q2)*5.0,0.0,1.0);
          float sunProx = pow(sd,3.0);
          vec3 shadeCol = mix(vec3(0.52,0.56,0.66), vec3(0.38,0.30,0.42), dusk);
          shadeCol = mix(shadeCol, vec3(0.05,0.06,0.10), night*0.9);
          vec3 litCol = mix(vec3(1.04,1.0,0.96), vec3(1.15,0.62,0.40), dusk*(0.35+0.65*sunProx));
          litCol = mix(litCol, vec3(0.10,0.12,0.20), night*0.85);
          vec3 cloudCol = mix(shadeCol,litCol,litF);
          col = mix(col,cloudCol,cov*0.88);
          disc *= 1.0 - cov*0.95;
        }
        col += sunTint*disc*5.0*(1.0-night);
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
        // after sundown the ring goes dim and cool — starlit, not sunlit
        float night = smoothstep(0.03, -0.10, uSunDir.y);
        col = mix(col, col * vec3(0.30, 0.36, 0.52), night * 0.85);
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
