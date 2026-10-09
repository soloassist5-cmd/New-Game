import * as THREE from 'three';

/**
 * The screamer: a face made of points, attached to the camera, that slams toward the viewer when a
 * monster catches the player. Static geometry built once; one uniform (uStart) triggers it.
 */
const VERT = /* glsl */ `
attribute vec3 color;
attribute float seed;
uniform float uTime;
uniform float uStart;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float t = uTime - uStart;
  if (t < 0.0 || t > 0.95) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float grow = 1.0 - pow(1.0 - min(t / 0.11, 1.0), 3.0);
  float s = mix(0.35, 1.0, grow) + 0.06 * sin(t * 60.0);
  vec3 p = position * s;
  // Violent shake + per-point glitch.
  float g = step(0.8, fract(t * 9.0 + seed * 3.0));
  p.xy += vec2(sin(t * 87.0 + seed * 50.0), cos(t * 71.0 + seed * 41.0)) * (0.004 + 0.03 * g);
  p.x += sin(t * 41.0) * 0.012;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uScale * 0.006 / max(0.05, -mv.z), 1.0, 9.0);
  vColor = color;
  vAlpha = (t < 0.75 ? 1.0 : 1.0 - (t - 0.75) / 0.2) * (0.85 + 0.3 * fract(seed * 13.0 + t * 20.0));
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = 1.0 - smoothstep(0.3, 1.0, dot(c, c));
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor * vAlpha * a, 1.0);
}
`;

/** Builds the face in camera space (metres, facing -Z). Deterministic so screenshots are stable. */
function buildFace(): { pos: Float32Array; col: Float32Array; seed: Float32Array } {
  let s = 1337;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pos: number[] = [];
  const col: number[] = [];
  const seed: number[] = [];
  const RED: [number, number, number] = [1.0, 0.16, 0.12];
  const HOT: [number, number, number] = [2.2, 0.7, 0.55];
  const push = (x: number, y: number, z: number, c: [number, number, number], k: number): void => {
    pos.push(x, y, z);
    col.push(c[0] * k, c[1] * k, c[2] * k);
    seed.push(rnd());
  };
  const Z = -0.55;
  const rx = 0.2;
  const ry = 0.29;
  const inEllipse = (x: number, y: number, cx: number, cy: number, ax: number, ay: number): number =>
    ((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2;
  // Skull: dense outline + sparse fill; eye sockets and the mouth stay empty (black holes read as horror).
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() * 2 - 1) * rx;
    const y = (rnd() * 2 - 1) * ry;
    const e = inEllipse(x, y, 0, 0, rx, ry * (y < 0 ? 1.15 : 1));
    if (e > 1) continue;
    const socket = Math.min(inEllipse(x, y, -0.075, 0.06, 0.055, 0.07), inEllipse(x, y, 0.075, 0.06, 0.055, 0.07));
    const mouth = inEllipse(x, y, 0, -0.15, 0.06 + (y + 0.15) * 0.2, 0.13);
    if (socket < 1 || mouth < 1) continue;
    const rim = e > 0.82 || socket < 1.5 || mouth < 1.4;
    if (!rim && rnd() > 0.35) continue;
    const z = Z + (1 - e) * 0.06; // bulge toward the viewer
    push(x, y, z, RED, rim ? 1.0 : 0.45);
  }
  // Teeth: jagged vertical strokes on both lips of the stretched mouth.
  for (let k = 0; k < 9; k++) {
    const x = -0.05 + (k / 8) * 0.1;
    const top = -0.15 + 0.12;
    const bottom = -0.15 - 0.12;
    const len = 0.03 + rnd() * 0.035;
    for (let j = 0; j < 7; j++) {
      push(x + (rnd() - 0.5) * 0.004, top - (j / 6) * len, Z + 0.04, RED, 1.3);
      push(x + (rnd() - 0.5) * 0.004, bottom + (j / 6) * len, Z + 0.04, RED, 1.3);
    }
  }
  // Pupils: tiny white-hot points deep in the sockets, looking straight at you.
  for (const ex of [-0.075, 0.075]) for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.007;
    push(ex + Math.cos(a) * r, 0.055 + Math.sin(a) * r, Z + 0.01, HOT, 1);
  }
  // Black "tears" running down from the sockets toward the jaw.
  for (const side of [-1, 1]) {
    let x = side * 0.075;
    let y = 0.0;
    for (let i = 0; i < 45; i++) {
      x += side * 0.0008 + (rnd() - 0.5) * 0.004;
      y -= 0.0042;
      push(x, y, Z + 0.035, RED, 1.1);
    }
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col), seed: new Float32Array(seed) };
}

export class ScareFace {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor() {
    const f = buildFace();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(f.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(f.col, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(f.seed, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uStart: { value: -100 }, uScale: { value: 1000 } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  get pointCount(): number {
    return (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).count;
  }

  trigger(now: number): void {
    this.material.uniforms.uStart.value = now;
  }

  reset(): void {
    this.material.uniforms.uStart.value = -100;
  }

  update(now: number, viewportH: number): void {
    this.material.uniforms.uTime.value = now;
    this.material.uniforms.uScale.value = viewportH * 1.4;
  }

  active(now: number): boolean {
    const t = now - this.material.uniforms.uStart.value;
    return t >= 0 && t <= 0.95;
  }
}
