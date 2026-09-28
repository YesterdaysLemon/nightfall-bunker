// The "1997" look (art/STYLE.md): world textures reduced to small palettes at a
// quarter of their size with crisp texels, and a TV pass that turns the
// low-resolution frame into a soft composite picture instead of hard squares.

import * as THREE from 'three';
import { mulberry32 as rng } from '../../shared/rng.js';

// --- Textures -----------------------------------------------------------------------------

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);


// Small k-means palette over the opaque pixels.
function palette(px, k, seed) {
  const n = px.length / 4;
  const R = rng(seed);
  const cent = [];
  for (let i = 0; i < k; i++) {
    let j = Math.floor(R() * n) * 4;
    for (let tries = 0; tries < 8 && px[j + 3] < 128; tries++) j = Math.floor(R() * n) * 4;
    cent.push([px[j], px[j + 1], px[j + 2]]);
  }
  const sum = new Float64Array(k * 3), cnt = new Uint32Array(k);
  for (let it = 0; it < 7; it++) {
    sum.fill(0); cnt.fill(0);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = px[i] - cent[c][0], dg = px[i + 1] - cent[c][1], db = px[i + 2] - cent[c][2];
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bd) { bd = d; best = c; }
      }
      sum[best * 3] += px[i]; sum[best * 3 + 1] += px[i + 1]; sum[best * 3 + 2] += px[i + 2]; cnt[best]++;
    }
    for (let c = 0; c < k; c++) if (cnt[c]) cent[c] = [sum[c * 3] / cnt[c], sum[c * 3 + 1] / cnt[c], sum[c * 3 + 2] / cnt[c]];
  }
  return cent;
}

function retroCanvas(src, size, colors, seed, cutout) {
  const w = size, h = Math.max(1, Math.round(size * src.height / src.width));
  // Step down in halves so the average is a true box filter, not a skipped sample.
  let cur = src;
  while (cur.width / 2 >= w) {
    const c = document.createElement('canvas');
    c.width = Math.max(w, Math.round(cur.width / 2)); c.height = Math.max(h, Math.round(cur.height / 2));
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const pal = palette(px, colors, seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = BAYER4[(y & 3) * 4 + (x & 3)] * 10; // gentle ordered dither between palette steps
      const r = px[i] + d, g = px[i + 1] + d, b = px[i + 2] + d;
      let best = pal[0], bd = Infinity;
      for (const c of pal) {
        const dr = r - c[0], dg = g - c[1], db = b - c[2];
        const dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (dd < bd) { bd = dd; best = c; }
      }
      px[i] = best[0]; px[i + 1] = best[1]; px[i + 2] = best[2];
      // Hard-edged transparency, like the era's one-bit cut-outs (dithered at the edge).
      if (cutout) px[i + 3] = px[i + 3] / 255 + BAYER4[(y & 3) * 4 + (x & 3)] * 0.5 > 0.5 ? 255 : 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

const CUTOUT = new Set(['bloodDecal', 'scorch']);

// Prepare low-res versions of every world texture once, then swap with setRetroTextures().
export function prepareRetroTextures(tex) {
  let seed = 11;
  for (const [name, t] of Object.entries(tex)) {
    const src = t.image;
    if (!src || !src.width || t.userData.lo) continue;
    // A quarter of the size (128 texels a tile for the big surfaces), at least 64.
    const size = Math.max(64, Math.round(src.width / 4));
    t.userData.hi = src;
    t.userData.hiFilter = [t.magFilter, t.minFilter, t.anisotropy];
    // A hand-painted low-res version (textures.js sets userData.painted) wins
    // over the automatic palette reduction.
    t.userData.lo = t.userData.painted
      || retroCanvas(src, size, name.includes('uniform') || name === 'skin' ? 20 : 24, seed++, CUTOUT.has(name));
  }
}

export function setRetroTextures(tex, on) {
  for (const t of Object.values(tex)) {
    const u = t.userData;
    if (!u.lo) continue;
    const want = on ? u.lo : u.hi;
    if (t.image === want) continue;
    t.image = want;
    if (on) {
      // World surfaces are procedural noise, not painted clusters: blend when
      // magnified (no blown-up squares on a wall in your face), stay crisp when
      // minified. The low-res frame and TV pass supply the era's grain.
      // Hand-painted versions are deliberate clusters, so they stay crisp.
      t.magFilter = u.painted ? THREE.NearestFilter : THREE.LinearFilter;
      t.minFilter = THREE.NearestMipmapLinearFilter;
      t.anisotropy = 1;
    } else {
      [t.magFilter, t.minFilter, t.anisotropy] = u.hiFilter;
    }
    t.needsUpdate = true;
  }
}

// --- TV pass ---------------------------------------------------------------------------------
// The scene renders into a small target (about 400 lines). This pass draws it to
// the screen: rows stay crisp and become scanlines, each row is softened
// horizontally with a little colour bleed like composite video, then the
// picture is tone-mapped and reduced to 15-bit colour with an ordered dither.
// uAmt (0..1, the player's "TV effect strength") scales every one of those steps.

export function makeTvPass() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      uRes: { value: new THREE.Vector2(640, 400) },
      uScan: { value: 0.16 },
      uDither: { value: 1 },
      uAmt: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tScene;
      uniform vec2 uRes;
      uniform float uScan;
      uniform float uDither;
      uniform float uAmt;
      varying vec2 vUv;
      float bayer(vec2 p) {
        vec2 q = mod(p, 4.0);
        float i = q.x + q.y * 4.0;
        // 4x4 Bayer matrix, row-major
        float m[16];
        m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
        m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
        for (int k = 0; k < 16; k++) if (float(k) == i) return (m[k] + 0.5) / 16.0 - 0.5;
        return 0.0;
      }
      void main() {
        vec2 px = 1.0 / uRes;
        // Crisp rows, soft columns.
        float row = floor(vUv.y * uRes.y);
        vec2 uv = vec2(vUv.x, (row + 0.5) * px.y);
        vec3 sharp = texture2D(tScene, uv).rgb;
        vec3 c = sharp * 0.46
          + (texture2D(tScene, uv - vec2(px.x * 0.8, 0.0)).rgb + texture2D(tScene, uv + vec2(px.x * 0.8, 0.0)).rgb) * 0.22
          + (texture2D(tScene, uv - vec2(px.x * 1.7, 0.0)).rgb + texture2D(tScene, uv + vec2(px.x * 1.7, 0.0)).rgb) * 0.05;
        c = mix(sharp, c, uAmt);
        // Composite colour bleed: red leans left, blue right.
        c.r = mix(c.r, texture2D(tScene, uv - vec2(px.x * 1.2, 0.0)).r, 0.35 * uAmt);
        c.b = mix(c.b, texture2D(tScene, uv + vec2(px.x * 1.2, 0.0)).b, 0.35 * uAmt);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // World grade (art/STYLE.md): a little less saturation, green-grey
        // shadows, warm highlights and the lifted black level of an old tube.
        vec3 g = gl_FragColor.rgb;
        float luma = dot(g, vec3(0.299, 0.587, 0.114));
        g = mix(vec3(luma), g, 0.8);
        g *= mix(vec3(0.84, 0.96, 0.9), vec3(1.05, 1.0, 0.9), smoothstep(0.08, 0.65, luma));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, g * 0.95 + vec3(0.018, 0.022, 0.02), uAmt);
        // Scanlines: darken the gap between rows a little.
        float f = fract(vUv.y * uRes.y);
        float scan = 1.0 - uScan * uAmt * smoothstep(0.18, 0.5, abs(f - 0.5));
        // 15-bit colour with an ordered dither on the virtual pixel grid.
        vec2 vp = floor(vUv * uRes);
        vec3 q = mix(gl_FragColor.rgb, floor(gl_FragColor.rgb * 31.0 + 0.5 + bayer(vp) * uDither) / 31.0, uAmt);
        // A soft vignette, like the curved edge of a tube.
        vec2 d = vUv - 0.5;
        float vig = 1.0 - dot(d, d) * 0.35 * uAmt;
        gl_FragColor = vec4(clamp(q, 0.0, 1.0) * scan * vig, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, camera, material };
}
