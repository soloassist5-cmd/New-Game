import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BALANCE } from '../game/config';
import { isWallCell, type Level } from '../game/level';
import { damp, lerp } from '../core/math';
import type { World } from '../game/types';
import { PointCloud } from './pointcloud';
import { EchoPainter } from './echo';
import { FinalShader } from './post';
import { ScareFace } from './scare';

const CELL = BALANCE.world.cellSize;
const H = BALANCE.world.wallHeight;

export interface ViewSettings {
  fov: number;
  shake: number; // 0..1
  reduceFlashes: boolean;
  shapes: boolean;
}

/**
 * Owns the WebGL side: renderer, camera, the point cloud, an invisible depth-only wall mesh
 * (so points behind walls are hidden) and post-processing. Game-feel state (trauma, flashes,
 * FOV punch, kill-cam) lives here because it is presentation only.
 */
export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene = new THREE.Scene();
  readonly cloud = new PointCloud();
  readonly echo = new EchoPainter(this.cloud);
  readonly scare = new ScareFace();
  /** Real (unscaled) clock — the screamer must not play in slow motion. */
  private realTime = 0;
  private sprintFov = 0;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  private occluder: THREE.Mesh | null = null;
  /** Visual clock (s). Scaled by slow-mo, frozen when paused. Point births use this clock. */
  time = 0;
  settings: ViewSettings = { fov: 75, shake: 1, reduceFlashes: false, shapes: false };

  // Game-feel state.
  private trauma = 0;
  private fovPunch = 0;
  private flash = 0;
  private flashColor = new THREE.Color();
  private aberr = 0;
  private shock = -1;
  private bobPhase = 0;
  danger = 0;
  private killCam: { x: number; y: number; t: number } | null = null;
  private exitCam = 0;

  constructor(canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 1);
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.cloud.points);
    this.scene.add(this.camera);
    this.camera.add(this.scare.points);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(640, 360), 0.85, 0.45, 0.12);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    (this.final.uniforms.uRes.value as THREE.Vector2).set(w, h);
    // Point size scale ∝ viewport height so points look the same at any resolution.
    this.cloud.material.uniforms.uScale.value = h * this.renderer.getPixelRatio() * 0.0125;
  }

  /** Builds the invisible occluder from wall faces adjacent to floor. */
  setLevel(level: Level): void {
    if (this.occluder) {
      this.scene.remove(this.occluder);
      this.occluder.geometry.dispose();
    }
    const pos: number[] = [];
    const quad = (ax: number, az: number, bx: number, bz: number): void => {
      pos.push(ax, 0, az, bx, 0, bz, bx, H, bz, ax, 0, az, bx, H, bz, ax, H, az);
    };
    for (let y = 0; y < level.h; y++)
      for (let x = 0; x < level.w; x++) {
        if (!isWallCell(level, x, y)) continue;
        const x0 = x * CELL;
        const x1 = x0 + CELL;
        const z0 = y * CELL;
        const z1 = z0 + CELL;
        if (!isWallCell(level, x, y - 1)) quad(x0, z0, x1, z0);
        if (!isWallCell(level, x, y + 1)) quad(x1, z1, x0, z1);
        if (!isWallCell(level, x - 1, y)) quad(x0, z1, x0, z0);
        if (!isWallCell(level, x + 1, y)) quad(x1, z0, x1, z1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.occluder = new THREE.Mesh(g, m);
    this.occluder.renderOrder = 0;
    this.scene.add(this.occluder);
    this.cloud.clear();
    this.scare.reset();
    this.killCam = null;
    this.exitCam = 0;
    this.danger = 0;
  }

  // ---- game-feel triggers ----
  addTrauma(v: number): void {
    this.trauma = Math.min(1, this.trauma + v);
  }
  punchFov(deg: number): void {
    this.fovPunch += deg;
  }
  flashScreen(color: THREE.ColorRepresentation, amount: number): void {
    const a = this.settings.reduceFlashes ? amount * 0.25 : amount;
    this.flashColor.set(color);
    this.flash = Math.max(this.flash, a);
  }
  aberration(v: number): void {
    this.aberr = Math.max(this.aberr, this.settings.reduceFlashes ? v * 0.3 : v);
  }
  shockwave(): void {
    this.shock = 0;
  }
  startKillCam(x: number, y: number): void {
    this.killCam = { x, y, t: 0 };
  }
  /** Jump scare. Returns false if disabled in settings. */
  screamer(): void {
    this.scare.trigger(this.realTime);
    this.flashScreen(0xffffff, 0.6);
    this.aberration(1.6);
    this.addTrauma(1);
  }
  /** Trailer capture: bigger points and stronger bloom read better after video compression. */
  tuneForVideo(): void {
    this.bloom.strength = 1.15;
    // Film grain is incompressible noise for a video encoder; the codec adds its own texture.
    this.final.uniforms.uGrain.value = 0;
    this.cloud.material.uniforms.uScale.value *= 1.35;
  }

  get scareActive(): boolean {
    return this.scare.active(this.realTime);
  }
  startExitCam(): void {
    this.exitCam = 0.0001;
  }

  /**
   * @param alpha interpolation between previous and current sim state
   * @param dt real frame time; @param scaledDt frame time × time scale (0 when paused)
   * @param lookDX pending (not yet simulated) mouse yaw, applied visually to hide one tick of latency
   */
  render(world: World | null, alpha: number, dt: number, scaledDt: number, lookDX = 0, lookDY = 0): void {
    this.time += scaledDt;
    this.realTime += dt;
    const cam = this.camera;
    if (world) {
      const p = world.player;
      this.echo.viewer.x = p.x;
      this.echo.viewer.y = p.y;
      // Sprint: wider FOV and a heavier bob sell the speed.
      this.sprintFov = damp(this.sprintFov, p.sprinting ? 8 : 0, 6, dt);
      const x = lerp(p.prevX, p.x, alpha);
      const y = lerp(p.prevY, p.y, alpha);
      let yaw = p.yaw + lookDX;
      let pitch = Math.max(-1.35, Math.min(1.35, p.pitch + lookDY));
      // Head bob, scaled by the shake/motion setting.
      this.bobPhase += scaledDt * (p.sneaking ? 6 : p.sprinting ? 13 : 9.5) * p.moving;
      const bob = Math.sin(this.bobPhase) * (p.sprinting ? 0.06 : 0.035) * p.moving * this.settings.shake;
      let eye = BALANCE.world.eyeHeight + bob - (p.sneaking ? 0.25 : 0);
      if (this.killCam) {
        this.killCam.t += dt;
        const target = Math.atan2(this.killCam.y - y, this.killCam.x - x);
        const k = Math.min(1, this.killCam.t / 0.45);
        yaw = yaw + wrap(target - yaw) * easeOut(k);
        pitch = lerp(pitch, 0.12, easeOut(k));
        eye -= 0.5 * easeOut(Math.min(1, this.killCam.t / 1.2));
      }
      if (this.exitCam > 0) {
        this.exitCam += dt;
        eye += Math.min(1, this.exitCam) * 0.6;
        pitch = lerp(pitch, 0.6, Math.min(1, this.exitCam));
      }
      cam.position.set(x, eye, y);
      cam.rotation.set(pitch, -yaw - Math.PI / 2, 0);
      // Trauma shake: offset ∝ trauma², decays ~1.5/s.
      const s = this.trauma * this.trauma * this.settings.shake;
      if (s > 0) {
        const tt = this.time * 40;
        cam.position.x += Math.sin(tt * 1.3) * 0.05 * s;
        cam.position.y += Math.sin(tt * 1.7 + 1) * 0.04 * s;
        cam.rotation.z += Math.sin(tt * 1.1 + 2) * 0.03 * s;
      }
    }
    this.trauma = Math.max(0, this.trauma - 1.5 * dt);
    this.fovPunch = damp(this.fovPunch, 0, 7, dt);
    const fov = this.settings.fov + this.fovPunch + this.sprintFov;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.flash = damp(this.flash, 0, 6, dt);
    this.aberr = damp(this.aberr, 0, 4, dt);
    if (this.shock >= 0) {
      this.shock += dt * 1.6;
      if (this.shock >= 1) this.shock = -1;
    }
    const u = this.final.uniforms;
    u.uTime.value = this.time;
    u.uDanger.value = this.danger;
    u.uFlash.value = this.flash;
    (u.uFlashColor.value as THREE.Color).copy(this.flashColor);
    u.uAberr.value = this.aberr + this.danger * 0.35 * (this.settings.reduceFlashes ? 0.3 : 1);
    u.uShock.value = this.settings.reduceFlashes ? -1 : this.shock;
    this.cloud.material.uniforms.uTime.value = this.time;
    this.cloud.material.uniforms.uShapes.value = this.settings.shapes ? 1 : 0;
    this.cloud.flush();
    this.scare.update(this.realTime, this.renderer.domElement.height);
    this.composer.render(dt);
  }
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
