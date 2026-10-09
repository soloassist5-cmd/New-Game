import * as THREE from 'three';
import type { Rgb } from './palette';

/**
 * A single GPU point cloud backed by a ring buffer. Points are never removed — they age out in the
 * shader (birth + life) and get overwritten. No allocations per frame; uploads only the dirty range.
 */
const VERT = /* glsl */ `
attribute vec3 color;
attribute float birth;
attribute float life;
attribute float size;
attribute float shape;
uniform float uTime;
uniform float uScale;
uniform float uShapes;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  float age = uTime - birth;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float k = age / life;
  float flash = 1.0 + 1.3 * exp(-age * 10.0);
  vAlpha = pow(1.0 - k, 1.7) * flash;
  vColor = color;
  vShape = shape > 0.5 && shape < 1.5 ? uShapes : shape;
  vec3 pos = position;
  if (shape > 0.5 && shape < 1.5) {
    // Monster points never sit still: a constant tremor plus rare glitch jumps.
    float hsh = fract(sin(dot(position.xz + position.y, vec2(12.9898, 78.233))) * 43758.5453);
    float glitch = step(0.94, fract(uTime * 1.3 + hsh * 7.0));
    pos += vec3(sin(uTime * 23.0 + hsh * 40.0), sin(uTime * 17.0 + hsh * 31.0) * 0.6, cos(uTime * 19.0 + hsh * 27.0))
      * (0.012 + 0.09 * glitch);
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = size * uScale / max(0.25, -mv.z) * (1.0 + 0.6 * exp(-age * 9.0));
  gl_PointSize = clamp(s, 1.0, vShape > 0.5 ? 14.0 : 7.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a;
  if (vShape < 0.5) {
    a = 1.0 - smoothstep(0.25, 1.0, dot(c, c));
  } else if (vShape < 1.5) {
    float d = min(abs(c.x - c.y), abs(c.x + c.y));
    a = (1.0 - smoothstep(0.18, 0.4, d)) * step(dot(c, c), 1.0);
  } else if (vShape < 2.5) {
    a = 1.0 - smoothstep(0.55, 1.0, abs(c.x) + abs(c.y));
  } else {
    a = 1.0 - smoothstep(0.1, 0.32, abs(length(c) - 0.62));
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor * vAlpha * a, 1.0);
}
`;

export class PointCloud {
  readonly capacity: number;
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private birth: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private shape: Float32Array;
  private geo: THREE.BufferGeometry;
  private head = 0;
  private dirtyStart = -1;
  private dirtyEnd = -1;
  private wrapped = false;
  /** Total points written (for debug stats). */
  written = 0;

  constructor(capacity = 220_000) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.birth = new Float32Array(capacity).fill(-1e9);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    const attr = (arr: Float32Array, n: number): THREE.BufferAttribute => {
      const a = new THREE.BufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    g.setAttribute('position', attr(this.pos, 3));
    g.setAttribute('color', attr(this.col, 3));
    g.setAttribute('birth', attr(this.birth, 1));
    g.setAttribute('life', attr(this.life, 1));
    g.setAttribute('size', attr(this.size, 1));
    g.setAttribute('shape', attr(this.shape, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 300 }, uShapes: { value: 0 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      transparent: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
  }

  add(x: number, y: number, z: number, c: Rgb, intensity: number, birth: number, life: number, size: number, shape = 0): void {
    const i = this.head;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.col[i3] = c[0] * intensity;
    this.col[i3 + 1] = c[1] * intensity;
    this.col[i3 + 2] = c[2] * intensity;
    this.birth[i] = birth;
    this.life[i] = life;
    this.size[i] = size;
    this.shape[i] = shape;
    if (this.dirtyStart < 0) this.dirtyStart = i;
    this.dirtyEnd = i;
    this.head++;
    this.written++;
    if (this.head >= this.capacity) {
      this.head = 0;
      this.wrapped = true;
    }
  }

  /** Upload dirty ranges. Call once per frame before rendering. */
  flush(): void {
    if (this.dirtyStart < 0) return;
    const ranges: Array<[number, number]> = [];
    if (this.wrapped) {
      // Wrapped this frame: writes went [dirtyStart, cap) then [0, head).
      ranges.push([this.dirtyStart, this.capacity - this.dirtyStart]);
      if (this.head > 0) ranges.push([0, this.head]);
    } else {
      ranges.push([this.dirtyStart, this.dirtyEnd - this.dirtyStart + 1]);
    }
    for (const name of ['position', 'color', 'birth', 'life', 'size', 'shape']) {
      const a = this.geo.getAttribute(name) as THREE.BufferAttribute;
      for (const [s, n] of ranges) a.addUpdateRange(s * a.itemSize, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyStart = -1;
    this.dirtyEnd = -1;
    this.wrapped = false;
  }

  /** Hide everything (new level). */
  clear(): void {
    this.birth.fill(-1e9);
    const a = this.geo.getAttribute('birth') as THREE.BufferAttribute;
    a.clearUpdateRanges();
    a.needsUpdate = true;
    this.head = 0;
    this.dirtyStart = -1;
    this.wrapped = false;
  }

  /** Approximate number of currently visible points (debug only, O(n)). */
  aliveCount(now: number): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const age = now - this.birth[i];
      if (age >= 0 && age <= this.life[i]) n++;
    }
    return n;
  }
}
