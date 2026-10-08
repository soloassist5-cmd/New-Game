import * as THREE from 'three';

/** Final full-screen pass: shockwave, chromatic aberration (events only), vignette, danger tint, flash, grain. */
export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uDanger: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 0.2, 0.2) },
    uAberr: { value: 0 },
    uShock: { value: 0 },
    uGrain: { value: 0.018 },
    uRes: { value: new THREE.Vector2(1280, 720) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDanger, uFlash, uAberr, uShock, uGrain;
    uniform vec3 uFlashColor;
    uniform vec2 uRes;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      c.x *= uRes.x / uRes.y;
      float r = length(c);
      if (uShock > 0.0 && uShock < 1.0) {
        float ring = uShock * 1.1;
        float d = r - ring;
        float k = exp(-d * d / 0.004) * (1.0 - uShock) * 0.018;
        uv += normalize(c + 1e-5) * k * vec2(uRes.y / uRes.x, 1.0);
      }
      float ab = uAberr * (0.0015 + 0.01 * r * r);
      vec2 dir = normalize(c + 1e-5) * vec2(uRes.y / uRes.x, 1.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;
      float v = smoothstep(1.05, 0.25, r);
      col *= mix(1.0, v, 0.7 + 0.25 * uDanger);
      col += vec3(0.45, 0.0, 0.02) * uDanger * 0.13 * (1.0 - v);
      col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
      float n = fract(sin(dot(floor(uv * uRes) + fract(uTime * 7.13) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
