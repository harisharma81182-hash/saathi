import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HUES } from './Face.jsx';

// Saathi's face in 3D (React Three Fiber): a golden orb lit from inside, with a warm rim light and
// a slow swirl, soft breathing, eyes that blink and follow the cursor, a mouth, and the same
// expressions and mood colours as the 2D face. Loaded lazily, only on Home (the one 3D view on
// screen at a time), and it renders nothing while the tab is hidden or the face is off screen.
//
// Props match the 2D face: expression, state (idle | thinking | speaking | listening | error), size.

// Per expression: eyes (open 0..1.4), happy eye arcs (0..1), gaze, mouth curve (+ smile, - frown),
// mouth width, mouth opening (0..1), cheeks.
const LOOKS = {
  happy: { eye: 1, arcs: 0, curve: 1, width: 1, open: 0, cheeks: 1 },
  excited: { eye: 1.25, arcs: 0, curve: 1, width: 1.1, open: 0.55, cheeks: 1 },
  laughing: { eye: 0, arcs: 1, curve: 1, width: 1.15, open: 0.8, cheeks: 1 },
  proud: { eye: 0, arcs: 1, curve: 0.9, width: 1, open: 0, cheeks: 1 },
  surprised: { eye: 1.4, arcs: 0, curve: 0, width: 0.45, open: 0.75, cheeks: 0 },
  thinking: { eye: 1, arcs: 0, gaze: [-0.55, 0.5], curve: 0.15, width: 0.55, open: 0, cheeks: 0 },
  concerned: { eye: 0.9, arcs: 0, gaze: [0, -0.15], curve: -0.7, width: 0.8, open: 0, cheeks: 0 },
  sorry: { eye: 0.75, arcs: 0, gaze: [0, -0.55], curve: -0.8, width: 0.7, open: 0, cheeks: 0 },
  sleepy: { eye: 0.22, arcs: 0, gaze: [0, -0.3], curve: 0.2, width: 0.5, open: 0, cheeks: 0 },
  listening: { eye: 1.15, arcs: 0, curve: 0.4, width: 0.6, open: 0.3, cheeks: 0 },
  error: { eye: 0.9, arcs: 0, curve: -0.8, width: 0.8, open: 0, cheeks: 0 },
};

const FEATURE = '#2a190b';

export default function Face3D({ expression = 'happy', state = 'idle', size = 148 }) {
  const wrap = useRef(null);
  const [active, setActive] = useState(true);

  // Render only while the tab is visible and the face is on screen.
  useEffect(() => {
    let onScreen = true;
    const update = () => setActive(onScreen && !document.hidden);
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      update();
    });
    io.observe(wrap.current);
    document.addEventListener('visibilitychange', update);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const mood = state === 'listening' || state === 'error' ? state : state === 'thinking' ? 'thinking' : expression;
  const box = Math.round(size * 1.35); // a little room around the orb for the rim glow

  return (
    <div ref={wrap} className="relative" style={{ width: size, height: size }} role="img" aria-label={`Saathi looks ${mood}`}>
      <div className="absolute" style={{ width: box, height: box, left: (size - box) / 2, top: (size - box) / 2 }}>
        {/* flat: no tone mapping, so the gold matches the 2D face and the rest of the design */}
        {/* offsetSize: measure the box without CSS transforms, so the canvas stays right while the
            hero shrinks with a layout animation */}
        <Canvas
          flat
          resize={{ offsetSize: true, scroll: false }}
          dpr={[1, 1.5]}
          frameloop={active ? 'always' : 'never'}
          gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
          camera={{ position: [0, 0, 5.2], fov: 30 }}
          style={{ pointerEvents: 'none' }}
        >
          <Orb mood={mood} state={state} />
        </Canvas>
      </div>
    </div>
  );
}

// The cursor position over the whole window (-1..1), shared by every frame.
const pointer = new THREE.Vector2();
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (e) => pointer.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)),
    { passive: true },
  );
}

function Orb({ mood, state }) {
  const group = useRef();
  const face = useRef();
  const eyes = useRef([]);
  const arcs = useRef([]);
  const smile = useRef();
  const mouthOpen = useRef();
  const cheeks = useRef([]);
  const glow = useRef();

  const look = LOOKS[mood] ?? LOOKS.happy;
  const hue = HUES[mood] ?? HUES.happy;

  // Colours and expression values ease toward their targets every frame (smooth mood changes).
  const now = useRef({ eye: 1, arcs: 0, curve: 1, width: 1, open: 0, cheeks: 1, gx: 0, gy: 0, blink: 1 });
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLight: { value: new THREE.Color(hue[0]) },
      uMid: { value: new THREE.Color(hue[1]) },
      uDeep: { value: new THREE.Color(hue[2]) },
      uSwirl: { value: 0.35 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const target = useMemo(() => hue.map((c) => new THREE.Color(c)), [hue]);

  // Blink every 3 to 6 seconds.
  const nextBlink = useRef(2);
  const glowTexture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const t = (uniforms.uTime.value += dt);
    const k = 1 - Math.exp(-dt * 8); // easing factor, frame-rate independent
    const n = now.current;

    for (let i = 0; i < 3; i++) [uniforms.uLight, uniforms.uMid, uniforms.uDeep][i].value.lerp(target[i], 1 - Math.exp(-dt * 3));
    uniforms.uSwirl.value += ((state === 'thinking' ? 1.1 : 0.35) - uniforms.uSwirl.value) * k;

    // Blink
    nextBlink.current -= dt;
    if (nextBlink.current < 0) {
      n.blink = 0;
      nextBlink.current = 3 + Math.random() * 3;
    }
    n.blink += (1 - n.blink) * (1 - Math.exp(-dt * 14));

    // Expression
    const speakOpen = state === 'speaking' ? 0.25 + 0.35 * Math.abs(Math.sin(t * 11) * Math.sin(t * 4.3)) : 0;
    n.eye += (look.eye - n.eye) * k;
    n.arcs += (look.arcs - n.arcs) * k;
    n.curve += (look.curve - n.curve) * k;
    n.width += (look.width - n.width) * k;
    n.open += (Math.max(look.open, speakOpen) - n.open) * (state === 'speaking' ? 1 - Math.exp(-dt * 20) : k);
    n.cheeks += (look.cheeks - n.cheeks) * k;

    // Where to look: a fixed glance for some moods, otherwise the cursor
    const [gx, gy] = look.gaze ?? [pointer.x, pointer.y];
    n.gx += (gx - n.gx) * (1 - Math.exp(-dt * 5));
    n.gy += (gy - n.gy) * (1 - Math.exp(-dt * 5));

    // Breathing and a gentle float; the face turns a little toward where it looks
    const breath = 1 + Math.sin(t * 1.25) * 0.018;
    group.current.scale.setScalar(breath);
    group.current.position.y = Math.sin(t * 0.9) * 0.04;
    face.current.rotation.y = n.gx * 0.32;
    face.current.rotation.x = -n.gy * 0.22;

    const open = Math.max(0.05, n.eye) * Math.max(0.06, n.blink);
    eyes.current.forEach((e) => {
      e.scale.set(1, open * (1 - n.arcs), 1);
      e.visible = open * (1 - n.arcs) > 0.02;
    });
    arcs.current.forEach((a) => a.scale.setScalar(Math.max(0.0001, n.arcs)));

    // Mouth: one arc that bends from smile (curve 1) through flat (0) to frown (-1), plus a dark
    // opening for excited, laughing, surprised and speaking.
    const c = n.curve;
    smile.current.rotation.z = c >= 0 ? Math.PI : 0;
    smile.current.scale.set(n.width, Math.max(0.12, Math.abs(c)), 1);
    smile.current.position.y = c >= 0 ? -0.2 : -0.36;
    smile.current.visible = n.open < 0.5;
    mouthOpen.current.scale.set(0.11 * n.width + 0.05, 0.02 + n.open * 0.13, 0.04);
    mouthOpen.current.visible = n.open > 0.05;

    cheeks.current.forEach((ch) => (ch.material.opacity = 0.28 * n.cheeks));
    glow.current.material.color.copy(uniforms.uMid.value);
    glow.current.material.opacity = 0.55 + Math.sin(t * 1.25) * 0.08;
  });

  // Features sit on the sphere's front surface.
  const onSurface = (x, y) => [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)) * 0.995];

  return (
    <group ref={group}>
      <sprite ref={glow} scale={[3.1, 3.1, 1]} renderOrder={-1}>
        <spriteMaterial map={glowTexture} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <mesh>
        <sphereGeometry args={[1, 64, 64]} />
        <shaderMaterial uniforms={uniforms} vertexShader={ORB_VERT} fragmentShader={ORB_FRAG} />
      </mesh>
      <group ref={face}>
        {[-1, 1].map((side, i) => (
          <group key={side} position={onSurface(side * 0.3, 0.12)}>
            {/* open eye */}
            <mesh ref={(m) => (eyes.current[i] = m)} scale={[1, 1, 1]}>
              <sphereGeometry args={[0.085, 20, 20]} />
              <meshBasicMaterial color={FEATURE} />
            </mesh>
            {/* happy closed eye: an upside-down arc ^ */}
            <mesh ref={(m) => (arcs.current[i] = m)} position={[0, -0.03, 0]}>
              <torusGeometry args={[0.085, 0.024, 8, 24, Math.PI]} />
              <meshBasicMaterial color={FEATURE} />
            </mesh>
          </group>
        ))}
        <group position={onSurface(0, -0.08)}>
          <mesh ref={smile}>
            <torusGeometry args={[0.17, 0.026, 8, 32, Math.PI]} />
            <meshBasicMaterial color={FEATURE} />
          </mesh>
          <mesh ref={mouthOpen} position={[0, -0.24, 0.0]}>
            <sphereGeometry args={[1, 24, 24]} />
            <meshBasicMaterial color={FEATURE} />
          </mesh>
        </group>
        {[-1, 1].map((side, i) => (
          <mesh key={side} ref={(m) => (cheeks.current[i] = m)} position={onSurface(side * 0.5, -0.12)} scale={[1, 0.6, 1]}>
            <circleGeometry args={[0.1, 24]} />
            <meshBasicMaterial color="#ff8a5c" transparent opacity={0.28} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

const ORB_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vP; varying vec3 vView;
  void main() {
    vN = normalize(normalMatrix * normal);
    vP = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

// Lit from inside: a hot core that fades to a deep, darker edge (depth), a slow swirl of light
// moving underneath, a small bright glint at the upper left (glass catching light) and a warm rim.
const ORB_FRAG = /* glsl */ `
  uniform float uTime; uniform float uSwirl;
  uniform vec3 uLight; uniform vec3 uMid; uniform vec3 uDeep;
  varying vec3 vN; varying vec3 vP; varying vec3 vView;
  void main() {
    vec3 n = normalize(vN);
    float facing = max(dot(n, vView), 0.0);
    float fres = pow(1.0 - facing, 2.2);
    float t = uTime * uSwirl;
    float s = sin(vP.x * 2.6 + t) * sin(vP.y * 3.1 - t * 1.3) * sin(vP.z * 2.2 + t * 0.7);
    s += 0.5 * sin(vP.x * 5.1 - t * 1.7 + vP.y * 2.3) * sin(vP.z * 4.3 + t);

    // body: a deep edge into rich gold (most of the orb is the middle colour, like the 2D face)
    vec3 col = mix(uDeep, uMid, smoothstep(0.0, 0.55, facing));
    // light from inside, brightest toward the upper left; the swirl moves through it
    vec3 keyDir = normalize(vec3(-0.45, 0.6, 0.66));
    float key = max(dot(n, keyDir), 0.0);
    col = mix(col, uLight, pow(key, 2.2) * 0.62 + 0.07 * s * facing);
    // a small glint, like glass catching light
    col += vec3(1.0, 0.97, 0.9) * pow(key, 48.0) * 0.5;
    // warm rim light wrapping round the edge
    col += uMid * fres * 0.55;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;
