import * as THREE from 'three';

// Saathi Orbit: the landing page's space scene, ported from design/saathi-orbit.html (Himanshu's
// prototype). Saathi's glowing gold core in the centre, its features orbiting as dotted planets
// with atmosphere rims, glowing orbit lines, a dust ring and a moon, three layers of twinkling
// stars, nebula haze, shooting stars, a slow camera drift with mouse parallax, and dots that light
// up near the cursor. Fixed speed, labels always on.
//
// Made to be light on memory (Himanshu's laptop has limited RAM):
//  - "lite" mode on low-memory devices: fewer stars and planet dots, lower resolution
//  - the render loop STOPS (no frames at all) while the tab is hidden or the canvas is off screen
//  - dispose() frees every geometry, material, texture and the WebGL context
//
// createOrbitScene({ canvas, labels }) -> { dispose }   (throws if WebGL is not available)

export function createOrbitScene({ canvas, labels: labelsEl }) {
  const lite = (navigator.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4;
  const density = lite ? 0.55 : 1;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The prototype was tuned on three r149, before colour management existed. Keep its exact colours:
  // hex colours are used as is (no sRGB -> linear conversion) and the output is not converted either.
  // (React Three Fiber turns colour management back on for the Home face; only one 3D view is ever
  // on screen at a time.)
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, alpha: false, powerPreference: lite ? 'low-power' : 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const DPR = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5);
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x05060d, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060d, 0.0035);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 3000);

  // Everything created here is listed, so dispose() can free it.
  const owned = [];
  const own = (x) => (owned.push(x), x);

  // ---------- helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  function glowTexture(stops) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(([o, col]) => grad.addColorStop(o, col));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return own(new THREE.CanvasTexture(c));
  }
  // Small 3D value noise for continent masks on dotted planets.
  function hash(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    let r = 0;
    for (let dx = 0; dx < 2; dx++)
      for (let dy = 0; dy < 2; dy++)
        for (let dz = 0; dz < 2; dz++) r += (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w) * hash(xi + dx, yi + dy, zi + dz);
    return r;
  }
  const fbm = (x, y, z) => noise3(x, y, z) * 0.6 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.1;
  const smooth = (e0, e1, x) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  };

  const uniformsShared = {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(9, 9) }, // NDC; far away until the mouse moves
    uAspect: { value: 1 },
    uPixelRatio: { value: DPR },
  };

  // ---------- twinkling starfield (3 depth layers) ----------
  function makeStars(count, rMin, rMax, sizeMin, sizeMax) {
    count = Math.round(count * density);
    const pos = new Float32Array(count * 3), size = new Float32Array(count), phase = new Float32Array(count),
      speed = new Float32Array(count), col = new Float32Array(count * 3);
    const palette = [[1, 0.96, 0.9], [0.8, 0.86, 1], [1, 0.85, 0.65], [0.85, 0.75, 1]];
    for (let i = 0; i < count; i++) {
      const u = Math.random(), v = Math.random();
      const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1), r = rand(rMin, rMax);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.8;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      size[i] = Math.pow(Math.random(), 3) * (sizeMax - sizeMin) + sizeMin;
      phase[i] = Math.random() * Math.PI * 2;
      speed[i] = rand(0.6, 2.8);
      col.set(palette[Math.random() < 0.7 ? 0 : 1 + Math.floor(Math.random() * 3)], i * 3);
    }
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const mat = own(
      new THREE.ShaderMaterial({
        uniforms: uniformsShared,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
        attribute float aSize; attribute float aPhase; attribute float aSpeed; attribute vec3 aColor;
        uniform float uTime; uniform float uPixelRatio;
        varying float vAlpha; varying vec3 vColor; varying float vBig;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float tw = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
          tw = 0.25 + 0.75 * pow(tw, 2.0);
          vAlpha = tw; vColor = aColor; vBig = step(2.6, aSize);
          gl_PointSize = aSize * uPixelRatio * (0.65 + 0.55 * tw) * (420.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
        fragmentShader: `
        varying float vAlpha; varying vec3 vColor; varying float vBig;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          float core = pow(smoothstep(0.5, 0.0, d), 2.2);
          // bright stars get a soft 4-point glint
          float glint = vBig * (smoothstep(0.06, 0.0, abs(p.x)) + smoothstep(0.06, 0.0, abs(p.y))) * smoothstep(0.5, 0.1, d) * 0.6;
          float a = (core + glint) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      }),
    );
    return new THREE.Points(geo, mat);
  }
  const starsFar = makeStars(4200, 700, 1100, 0.8, 2.4);
  const starsMid = makeStars(1600, 380, 650, 1.0, 3.2);
  const starsNear = makeStars(380, 180, 320, 1.2, 4.0);
  scene.add(starsFar, starsMid, starsNear);

  // ---------- nebula haze ----------
  const nebula = new THREE.Group();
  [
    [0x6b3cff, -260, 60, -520, 520, 0.18],
    [0x1f4dff, 300, -40, -600, 620, 0.16],
    [0xff8a3d, 80, 140, -700, 460, 0.08],
    [0x3fd0c9, -380, -120, -520, 380, 0.07],
  ].forEach(([c, x, y, z, s, o]) => {
    const col = new THREE.Color(c);
    const rgb = `${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0}`;
    const tex = glowTexture([[0, `rgba(${rgb},1)`], [0.45, `rgba(${rgb},0.35)`], [1, 'rgba(0,0,0,0)']]);
    const spr = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    spr.position.set(x, y, z);
    spr.scale.set(s, s * 0.7, 1);
    nebula.add(spr);
  });
  scene.add(nebula);

  // ---------- the solar system ----------
  const system = new THREE.Group();
  system.rotation.x = 0.28; // tilt the orbital plane toward the camera
  system.rotation.z = -0.08;
  scene.add(system);

  // Saathi core: glowing orb with a living swirl and a fresnel rim
  const coreUniforms = { uTime: uniformsShared.uTime, uHover: { value: 0 } };
  const core = new THREE.Mesh(
    own(new THREE.SphereGeometry(2.6, lite ? 48 : 96, lite ? 48 : 96)),
    own(
      new THREE.ShaderMaterial({
        uniforms: coreUniforms,
        vertexShader: `
        varying vec3 vN; varying vec3 vP; varying vec3 vView;
        void main() {
          vN = normalize(normalMatrix * normal);
          vP = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
        fragmentShader: `
        uniform float uTime; uniform float uHover;
        varying vec3 vN; varying vec3 vP; varying vec3 vView;
        float swirl(vec3 p) {
          float t = uTime * 0.35;
          float s = sin(p.x * 1.7 + t) * sin(p.y * 2.1 - t * 1.3) * sin(p.z * 1.5 + t * 0.7);
          s += 0.5 * sin(p.x * 3.9 - t * 1.7 + p.y * 2.0) * sin(p.z * 3.3 + t);
          return s;
        }
        void main() {
          float fres = pow(1.0 - max(dot(vN, vView), 0.0), 2.4);
          float s = swirl(vP * 0.9);
          vec3 deep = vec3(0.55, 0.22, 0.05);
          vec3 gold = vec3(1.0, 0.68, 0.26);
          vec3 hot = vec3(1.0, 0.93, 0.75);
          vec3 violet = vec3(0.66, 0.42, 1.0);
          vec3 col = mix(deep, gold, 0.55 + 0.45 * s);
          col = mix(col, hot, smoothstep(0.55, 1.2, s));
          col += violet * fres * (0.55 + 0.35 * sin(uTime * 0.8));
          col += gold * fres * 0.9;
          col *= 1.0 + uHover * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }`,
      }),
    ),
  );
  system.add(core);
  const coronaTex = glowTexture([[0, 'rgba(255,214,150,1)'], [0.18, 'rgba(242,165,65,0.75)'], [0.45, 'rgba(168,107,255,0.18)'], [1, 'rgba(0,0,0,0)']]);
  const corona = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: coronaTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
  corona.scale.set(17, 17, 1);
  system.add(corona);

  // Dotted planets with atmosphere rims; each is one of Saathi's features.
  const FEATURES = [
    { name: 'Tasks', color: 0x5aa8ff, radius: 0.95, a: 6.2, b: 5.6, speed: 0.42, tilt: 0.05, phase: 0.4, dots: 2600 },
    { name: 'Reminders', color: 0xff9d5c, radius: 0.75, a: 8.6, b: 7.9, speed: -0.31, tilt: -0.08, phase: 2.2, dots: 2000 },
    { name: 'Study plan', color: 0x9b7bff, radius: 1.35, a: 11.6, b: 10.4, speed: 0.22, tilt: 0.1, phase: 4.1, dots: 4200, ring: true },
    { name: 'Memory', color: 0x47d6c3, radius: 1.05, a: 14.8, b: 13.6, speed: 0.15, tilt: -0.05, phase: 5.3, dots: 3200, moon: true },
    { name: 'Voice', color: 0xff6fb5, radius: 0.85, a: 18.2, b: 16.9, speed: -0.11, tilt: 0.07, phase: 1.1, dots: 2400 },
  ];

  function dottedPlanet(f) {
    const n = Math.round(f.dots * density), pos = new Float32Array(n * 3), land = new Float32Array(n);
    const seed = Math.random() * 50;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      pos.set([x * f.radius, y * f.radius, z * f.radius], i * 3);
      land[i] = smooth(0.48, 0.6, fbm(x * 1.6 + seed, y * 1.6 + seed, z * 1.6 + seed));
    }
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLand', new THREE.BufferAttribute(land, 1));
    const mat = own(
      new THREE.ShaderMaterial({
        uniforms: { ...uniformsShared, uColor: { value: new THREE.Color(f.color) }, uRadius: { value: f.radius } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
        attribute float aLand;
        uniform vec2 uMouse; uniform float uAspect; uniform float uPixelRatio; uniform float uRadius;
        varying float vB; varying float vLand;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normalize(position));
          float facing = dot(n, normalize(-mv.xyz));
          vec4 clip = projectionMatrix * mv;
          vec2 ndc = clip.xy / clip.w;
          vec2 d = ndc - uMouse; d.x *= uAspect;
          float near = smoothstep(0.16, 0.0, length(d)) * step(0.0, facing);
          float rim = pow(1.0 - abs(facing), 3.0);
          vLand = aLand;
          vB = ((0.12 + 0.58 * aLand) * (0.3 + 0.7 * max(facing, 0.0)) + rim * 0.5) * 0.75 + near * 1.3;
          vB *= step(-0.15, facing);   // hide most of the back side
          gl_PointSize = uPixelRatio * (0.8 + aLand * 0.9 + near * 2.0) * (60.0 / -mv.z) * (0.6 + uRadius * 0.4);
          gl_Position = clip;
        }`,
        fragmentShader: `
        uniform vec3 uColor; varying float vB; varying float vLand;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vB;
          if (a < 0.02) discard;
          vec3 col = mix(uColor * 0.6, mix(uColor, vec3(1.0), 0.18), vLand);
          gl_FragColor = vec4(col, a);
        }`,
      }),
    );
    return new THREE.Points(geo, mat);
  }

  function atmosphere(f, scale, power, strength) {
    return new THREE.Mesh(
      own(new THREE.SphereGeometry(f.radius * scale, 32, 32)),
      own(
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(f.color) } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          vertexShader: `varying vec3 vN; varying vec3 vView;
          void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vView = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vView;
          void main(){ float i = pow(max(0.0, 0.62 + dot(vN, vView)), ${power.toFixed(1)}) * ${strength.toFixed(2)}; gl_FragColor = vec4(uColor * i, i); }`,
        }),
      ),
    );
  }

  function orbitRing(f) {
    const segments = lite ? 200 : 320;
    const line = new THREE.Mesh(
      own(new THREE.TorusGeometry(1, 0.0045, 6, segments)),
      own(new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    line.rotation.x = Math.PI / 2;
    line.scale.set(f.a, f.b, 1 / Math.max(f.a, f.b));
    // a fainter, wider halo copy makes the line read as glowing
    const halo = new THREE.Mesh(
      own(new THREE.TorusGeometry(1, 0.016, 6, segments)),
      own(new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    halo.rotation.x = Math.PI / 2;
    halo.scale.copy(line.scale);
    const g = new THREE.Group();
    g.add(line, halo);
    return g;
  }

  function dustRing(f) {
    const n = Math.round(2600 * density), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, r = f.radius * rand(1.55, 2.35);
      pos.set([Math.cos(th) * r, rand(-0.02, 0.02), Math.sin(th) * r], i * 3);
    }
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, own(new THREE.PointsMaterial({ color: f.color, size: 0.035, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })));
    pts.rotation.x = 0.45;
    pts.rotation.z = 0.2;
    return pts;
  }

  const planets = FEATURES.map((f) => {
    const orbit = new THREE.Group();
    orbit.rotation.z = f.tilt;
    orbit.add(orbitRing(f));
    const body = new THREE.Group();
    body.add(dottedPlanet(f));
    body.add(atmosphere(f, 1.22, 2.6, 1.3));
    if (f.ring) body.add(dustRing(f));
    let moon = null;
    if (f.moon) {
      moon = new THREE.Mesh(own(new THREE.SphereGeometry(0.18, 16, 16)), own(new THREE.MeshBasicMaterial({ color: 0xdfe6ff })));
      body.add(moon);
    }
    orbit.add(body);
    system.add(orbit);
    // Planet label, always shown.
    const tag = document.createElement('div');
    tag.className = 'orbit-tag';
    const dot = document.createElement('b');
    dot.style.background = `#${new THREE.Color(f.color).getHexString()}`;
    tag.append(dot, f.name);
    labelsEl.appendChild(tag);
    return { f, body, moon, tag, angle: f.phase, spin: rand(0.15, 0.35) };
  });

  // ---------- shooting stars ----------
  const streakTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 8;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.85, 'rgba(190,210,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 2, 256, 4);
    return own(new THREE.CanvasTexture(c));
  })();
  const streakGeo = own(new THREE.PlaneGeometry(1, 1));
  const streaks = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(streakGeo, own(new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    scene.add(m);
    streaks.push({ m, life: 0, dur: 1, next: rand(1, 5) });
  }
  function launchStreak(s) {
    const from = new THREE.Vector3(rand(-260, 260), rand(40, 170), rand(-420, -260));
    const dir = new THREE.Vector3(rand(-1, -0.4) * (Math.random() < 0.5 ? -1 : 1), rand(-0.45, -0.15), 0).normalize();
    Object.assign(s, { from, dir, life: 0, dur: rand(0.9, 1.6), dist: rand(140, 260) });
    s.m.scale.set(rand(40, 80), 1.2, 1);
    s.m.rotation.z = Math.atan2(dir.y, dir.x);
  }

  // ---------- interaction ----------
  const mouse = new THREE.Vector2(0, 0), mouseTarget = new THREE.Vector2(0, 0), farAway = new THREE.Vector2(9, 9);
  let mouseActive = false;
  const onPointerMove = (e) => {
    mouseTarget.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    mouseActive = true;
  };
  const onPointerLeave = () => {
    mouseActive = false;
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);

  // Fixed speed; slower when the visitor asked for reduced motion.
  const speed = reduceMotion ? 0.25 : 1;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 62 : 42; // keep the outer orbit in frame on tall phone screens
    camera.updateProjectionMatrix();
    uniformsShared.uAspect.value = w / h;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- loop: runs only while the page is visible and the canvas is on screen ----------
  // Frame timing (THREE.Clock is deprecated in current three.js).
  let last = performance.now();
  const delta = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    return dt;
  };
  const tmp = new THREE.Vector3();
  let simTime = 0;
  let raf = 0;
  let onScreen = true;

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(delta(), 0.05);
    simTime += dt * speed;
    uniformsShared.uTime.value += dt * Math.max(speed, 0.35);

    mouse.lerp(mouseTarget, 0.06);
    uniformsShared.uMouse.value.copy(mouseActive ? mouseTarget : farAway);

    for (const p of planets) {
      p.angle += dt * speed * p.f.speed;
      p.body.position.set(Math.cos(p.angle) * p.f.a, 0, Math.sin(p.angle) * p.f.b);
      p.body.rotation.y += dt * speed * p.spin;
      if (p.moon) {
        const ma = simTime * 1.6;
        p.moon.position.set(Math.cos(ma) * p.f.radius * 1.9, Math.sin(ma * 0.7) * 0.25, Math.sin(ma) * p.f.radius * 1.9);
      }
      // label above each planet
      p.body.getWorldPosition(tmp);
      tmp.y += p.f.radius * 1.6;
      tmp.project(camera);
      p.tag.style.opacity = tmp.z > 1 ? 0 : 1;
      p.tag.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${(-tmp.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
    }

    // the core breathes, and brightens when the cursor is near it
    const coreScreen = core.getWorldPosition(tmp).project(camera);
    const dc = Math.hypot((coreScreen.x - mouseTarget.x) * camera.aspect, coreScreen.y - mouseTarget.y);
    coreUniforms.uHover.value += ((mouseActive && dc < 0.25 ? 1 : 0) - coreUniforms.uHover.value) * 0.08;
    const breath = 1 + Math.sin(uniformsShared.uTime.value * 1.3) * 0.04;
    core.scale.setScalar(breath);
    corona.scale.setScalar(17 * (breath + coreUniforms.uHover.value * 0.12));
    core.rotation.y += dt * speed * 0.08;

    // slow cinematic camera drift + mouse parallax
    const t = reduceMotion ? 0 : uniformsShared.uTime.value;
    const drift = reduceMotion ? 0 : 1;
    const radius = (camera.aspect < 0.8 ? 60 : 36) + Math.sin(t * 0.09) * 2.5 * drift;
    const ang = 0.35 + Math.sin(t * 0.045) * 0.35 * drift;
    camera.position.set(Math.sin(ang) * radius + mouse.x * 2.2, 9.5 + Math.sin(t * 0.07) * 1.4 * drift + mouse.y * 1.6, Math.cos(ang) * radius);
    camera.lookAt(0, camera.aspect < 0.8 ? -6 : -3, 0);

    // star layers move at different rates for depth
    starsNear.rotation.y = mouse.x * 0.06 + t * 0.004;
    starsMid.rotation.y = mouse.x * 0.03 + t * 0.002;
    starsFar.rotation.y = mouse.x * 0.012 + t * 0.001;
    nebula.rotation.z = t * 0.003;

    for (const s of streaks) {
      if (reduceMotion) {
        s.m.material.opacity = 0;
        continue;
      }
      s.next -= dt;
      if (s.next <= 0 && s.life === 0) {
        launchStreak(s);
        s.life = 0.0001;
      }
      if (s.life > 0) {
        s.life += dt / s.dur;
        const p = Math.min(s.life, 1);
        s.m.position.copy(s.from).addScaledVector(s.dir, p * s.dist);
        s.m.material.opacity = Math.sin(p * Math.PI) * 0.75;
        if (s.life >= 1) {
          s.life = 0;
          s.next = rand(2.5, 7);
          s.m.material.opacity = 0;
        }
      }
    }

    renderer.render(scene, camera);
  }

  // Start or stop the loop. Stopped means no requestAnimationFrame at all: zero GPU and CPU work.
  function update() {
    const shouldRun = !document.hidden && onScreen;
    if (shouldRun && !raf) {
      delta(); // don't jump ahead by the time spent paused
      raf = requestAnimationFrame(frame);
    } else if (!shouldRun && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  document.addEventListener('visibilitychange', update);
  const observer = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    update();
  });
  observer.observe(canvas);
  update();

  return {
    lite,
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      for (const x of owned) x.dispose();
      for (const p of planets) p.tag.remove();
      renderer.dispose();
      renderer.forceContextLoss(); // give the GPU memory back now, not whenever the browser decides
    },
  };
}
