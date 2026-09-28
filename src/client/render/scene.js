// Renderer, scene, lighting and sky. Light count is fixed for the whole
// session so shaders compile once.

import * as THREE from 'three';
import { LIGHTS } from '../../shared/map.js';
import { makeTvPass } from './retro.js';

// lines: internal vertical resolution of the retro (1997 TV) frame.
const QUALITY = {
  low: { ratio: 0.75, maxRatio: 1, aniso: 2, lines: 240 },
  medium: { ratio: 1, maxRatio: 1.5, aniso: 4, lines: 300 },
  high: { ratio: 1, maxRatio: 2, aniso: 8, lines: 360 },
};

export class SceneRig {
  constructor(canvas, quality = 'medium') {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.fogColor = new THREE.Color(0x0d1117);
    this.scene.background = this.fogColor.clone();
    this.scene.fog = new THREE.FogExp2(this.fogColor, 0.032);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 260);
    this.camera.rotation.order = 'YXZ';

    // Moonlight and sky fill.
    this.hemi = new THREE.HemisphereLight(0x6f84aa, 0x2a231b, 1.1);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9fb4e0, 1.3);
    this.moon.position.set(-30, 60, -40);
    this.scene.add(this.moon);
    this.ambient = new THREE.AmbientLight(0x3a342c, 0.6);
    this.scene.add(this.ambient);

    this.bulbs = LIGHTS.map((l, i) => {
      const light = new THREE.PointLight(l.color, l.intensity, l.distance, 1.6);
      light.position.set(...l.pos);
      this.scene.add(light);
      return { light, base: l.intensity, flicker: l.flicker, fire: !!l.fire, seed: i * 17.3, level: 1, bulb: null };
    });
    // Muzzle flash / explosion light (always present, intensity toggled).
    this.flash = new THREE.PointLight(0xffc27a, 0, 9, 1.8);
    this.scene.add(this.flash);
    this.flashT = 0;
    this.boom = new THREE.PointLight(0xff8a3a, 0, 16, 1.6);
    this.scene.add(this.boom);
    this.boomT = 0;
    // Hound-round lightning and the easter-egg glow. Always present (intensity
    // toggled) so the light count, and therefore every shader, never changes.
    this.bolt = new THREE.PointLight(0xc9dbff, 0, 34, 1.2);
    this.scene.add(this.bolt);
    this.boltT = 0;
    this.eggLight = new THREE.PointLight(0xffc35a, 0, 4.5, 1.6);
    this.scene.add(this.eggLight);
    // Dread: hound-round fog and dimmed bulbs (0 normal .. 1 full).
    this.dread = 0;
    this.dreadTarget = 0;
    this.baseFog = this.fogColor.clone();
    this.dreadFog = new THREE.Color(0x2b2824); // lighter haze: reads as fog, not just darkness

    this.sky = makeSky();
    this.scene.add(this.sky);

    this.setQuality(quality);
    this.resize();
    this._flick = 0;
    this.frameTimes = [];
    this.dynScale = 1;
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'medium';
    this.q = QUALITY[this.quality];
    this.dynScale = 1;
    this.resize();
  }

  // The 1997 look: render into a small target and let the TV pass present it.
  // amt 0..1 is the player's TV effect strength: 0 is off, and weaker settings
  // also render more lines, so the picture sharpens as the effect fades.
  setCrt(amt) {
    this.crt = Math.max(0, Math.min(1, amt));
    this.retro = this.crt > 0;
    if (this.retro && !this.tv) {
      this.tv = makeTvPass();
      this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
      this.rt.texture.minFilter = THREE.LinearFilter;
      this.rt.texture.magFilter = THREE.LinearFilter;
      this.rt.texture.generateMipmaps = false;
      this.tv.material.uniforms.tScene.value = this.rt.texture;
    }
    if (this.tv) this.tv.material.uniforms.uAmt.value = this.crt;
    this.resize();
  }

  // Start a frame: the scene and viewmodel render into whatever this selects.
  beginFrame() {
    this.renderer.setRenderTarget(this.retro ? this.rt : null);
    this.renderer.clear();
  }

  // Present: the TV pass draws the small frame to the screen.
  endFrame() {
    if (!this.retro) return;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.tv.scene, this.tv.camera);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // In retro mode the canvas only draws the TV quad, so it can use the full
    // device resolution cheaply (sharp scanlines); the 3D scene is small.
    const ratio = this.retro
      ? Math.min(window.devicePixelRatio || 1, 2)
      : Math.min(window.devicePixelRatio || 1, this.q.maxRatio) * this.q.ratio * this.dynScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    if (this.retro && this.rt) {
      // A fixed number of lines (fewer while frames run long), width by aspect.
      const sharpen = 1 + (1 - this.crt) * 1.1;
      const lines = Math.min(Math.round(h * ratio), Math.max(200, Math.round(this.q.lines * sharpen * (0.55 + this.dynScale * 0.45))));
      const rw = Math.round(lines * (w / h));
      this.rt.setSize(rw, lines);
      this.tv.material.uniforms.uRes.value.set(rw, lines);
      // Scanlines only where there are enough real pixels per line to draw them.
      this.tv.material.uniforms.uScan.value = (h * ratio) / lines >= 2 ? 0.16 : 0;
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Adaptive resolution: shrink when frames run long, recover slowly.
  adapt(dt) {
    const f = this.frameTimes;
    f.push(dt);
    if (f.length < 90) return;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    const prev = this.dynScale;
    if (avg > 1 / 45 && this.dynScale > 0.55) this.dynScale = Math.max(0.55, this.dynScale - 0.12);
    else if (avg < 1 / 75 && this.dynScale < 1) this.dynScale = Math.min(1, this.dynScale + 0.06);
    if (prev !== this.dynScale) this.resize();
  }

  // A short point-light flash: gunfire (warm) or an electric arc (pass a blue colour).
  muzzleFlash(pos, strength = 1, color = 0xffc27a, time = 0.05) {
    this.flash.position.copy(pos);
    this.flash.color.setHex(color);
    this.flash.intensity = 5 * strength * (this.calm ? 0.5 : 1);
    this.flashT = time;
  }

  explosionFlash(pos) {
    this.boom.position.copy(pos);
    this.boom.intensity = this.calm ? 22 : 60;
    this.boomT = 0.45;
  }

  // A lightning strike: a hard blue-white flash with a double flicker.
  lightning(pos) {
    this.bolt.position.set(pos.x, pos.y + 4, pos.z);
    this.boltT = 0.42;
  }

  setDread(on) { this.dreadTarget = on ? 1 : 0; }

  update(dt, time) {
    // Fog rolls in over ~3 s and lifts over ~5 s.
    const rate = this.dreadTarget > this.dread ? 0.35 : 0.2;
    this.dread += Math.max(-rate * dt, Math.min(rate * dt, this.dreadTarget - this.dread));
    const dr = this.dread;
    if (dr > 0 || this._dreadWas) {
      this.fogColor.copy(this.baseFog).lerp(this.dreadFog, dr);
      this.scene.fog.color.copy(this.fogColor);
      this.scene.background.copy(this.fogColor);
      this.scene.fog.density = 0.032 + dr * 0.068;
      this.hemi.intensity = 1.1 * (1 - dr * 0.45);
      this.moon.intensity = 1.3 * (1 - dr * 0.7);
      this._dreadWas = dr > 0;
    }
    for (const b of this.bulbs) {
      let k;
      if (b.fire) {
        k = 0.75 + 0.18 * Math.sin(time * 9 + b.seed) + 0.12 * Math.sin(time * 23.7 + b.seed * 2);
      } else {
        const n = Math.sin(time * 2.3 + b.seed) * Math.sin(time * 5.1 + b.seed * 0.7);
        const flick = b.flicker + dr * 0.8;
        // A failing bulb stutters; with reduced flashing it only dims.
        const failing = flick > 0.5 && Math.sin(time * (0.9 + dr * 1.7) + b.seed) > 0.97 - dr * 0.06;
        const cut = !failing ? 1 : this.calm ? 0.6 : Math.sin(time * 60) > 0 ? 0.1 : 1;
        k = (0.92 + 0.08 * n * flick) * cut * (1 - dr * 0.42);
      }
      b.level = k;
      b.light.intensity = b.base * k;
      if (b.bulb) b.bulb.material.color.setScalar(0.5 + k * 0.9);
    }
    if (this.boltT > 0) {
      this.boltT -= dt;
      const u = Math.max(0, this.boltT) / 0.42;
      const flick = this.calm ? u * 0.3 : u > 0.75 ? 1 : u > 0.6 ? 0.15 : u > 0.45 ? 0.8 : u * 1.4;
      this.bolt.intensity = 140 * flick;
      if (this.boltT <= 0) this.bolt.intensity = 0;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.intensity = 0;
    }
    if (this.boomT > 0) {
      this.boomT -= dt;
      this.boom.intensity = Math.max(0, this.boomT / 0.45) * (this.calm ? 22 : 60);
    }
    this.sky.position.copy(this.camera.position);
  }

  // Rough brightness at a point for lighting the viewmodel.
  lightAt(p) {
    let sum = 0.18;
    for (const b of this.bulbs) {
      const d = b.light.position.distanceTo(p);
      if (d < b.light.distance) sum += (b.light.intensity / 26) * Math.pow(1 - d / b.light.distance, 1.6);
    }
    return Math.min(1.6, sum);
  }
}

function makeSky() {
  const geo = new THREE.SphereGeometry(200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { moonDir: { value: new THREE.Vector3(-0.42, 0.55, -0.72).normalize() } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 moonDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 horizon = vec3(0.055, 0.068, 0.09);
        vec3 zenith = vec3(0.012, 0.016, 0.028);
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.6, h));
        float m = max(dot(d, moonDir), 0.0);
        col += vec3(0.55, 0.62, 0.75) * smoothstep(0.9993, 0.9997, m);   // moon disc
        col += vec3(0.10, 0.13, 0.19) * pow(m, 40.0);                    // halo
        float c = noise(d * 6.0) * 0.6 + noise(d * 13.0) * 0.4;
        float clouds = smoothstep(0.45, 0.8, c) * smoothstep(0.02, 0.3, h);
        col = mix(col, vec3(0.05, 0.055, 0.065) + vec3(0.08, 0.09, 0.11) * pow(m, 6.0), clouds * 0.85);
        float stars = step(0.9985, hash(floor(d * 380.0))) * smoothstep(0.1, 0.5, h) * (1.0 - clouds);
        col += stars * 0.35;
        col = mix(col, vec3(0.05, 0.066, 0.09), smoothstep(0.08, -0.05, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
