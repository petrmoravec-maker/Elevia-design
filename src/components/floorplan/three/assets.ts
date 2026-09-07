/**
 * Procedural assets for the 3D facility view - no external files to load:
 *  - makePlantGeometry(): low-poly cannabis plant (stem, palmate leaves on 4 nodes, cola) with vertex colours
 *  - concreteTexture() / epoxyTexture() / steelTexture(): canvas-generated PBR-ish maps
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// deterministic pseudo random so every build looks the same
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** mergeGeometries needs identical attribute sets and index-ness: everything becomes non-indexed with position/normal/uv/color */
function colorize(gIn: THREE.BufferGeometry, c: THREE.Color, jitter = 0, rand?: () => number) {
  const g = gIn.index ? gIn.toNonIndexed() : gIn;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter && rand ? (rand() - 0.5) * jitter : 0;
    arr[i * 3] = Math.min(1, Math.max(0, c.r + j));
    arr[i * 3 + 1] = Math.min(1, Math.max(0, c.g + j));
    arr[i * 3 + 2] = Math.min(1, Math.max(0, c.b + j * 0.5));
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Lanceolate serrated leaflet in the XY plane, base at origin, tip at +Y (length 1, width w). */
function leafletShape(w: number): THREE.Shape {
  const s = new THREE.Shape();
  const teeth = 7;
  s.moveTo(0, 0);
  for (let i = 1; i <= teeth; i++) {
    const t = i / (teeth + 1);
    const half = w * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.5;
    s.lineTo(half * (i % 2 ? 1 : 0.8), t);
  }
  s.lineTo(0, 1);
  for (let i = teeth; i >= 1; i--) {
    const t = i / (teeth + 1);
    const half = w * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.5;
    s.lineTo(-half * (i % 2 ? 1 : 0.8), t);
  }
  s.lineTo(0, 0);
  return s;
}

const LEAFLET = new THREE.ShapeGeometry(leafletShape(0.30), 2);

/** One palmate leaf (5 leaflets fanned) lying along +Z from the origin, drooping slightly. */
function palmateLeaf(len: number, rand: () => number, dark: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 7;
  const green = new THREE.Color(dark ? '#3a8a3f' : '#55b04a').offsetHSL((rand() - 0.5) * 0.04, 0.05, (rand() - 0.5) * 0.08);
  for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * 0.34;          // fan angle
    const l = len * (1 - Math.abs(i - (n - 1) / 2) * 0.16);
    const g = LEAFLET.clone();
    g.scale(l * 0.9, l, 1);
    // lay flat (XY plane -> XZ), fan around Y, droop
    g.rotateX(-Math.PI / 2 + 0.35);
    g.rotateY(a);
    parts.push(colorize(g, green, 0.05, rand));
  }
  // petiole
  const pet = new THREE.CylinderGeometry(0.004, 0.005, len * 0.5, 4);
  pet.rotateX(Math.PI / 2 - 0.35);
  pet.translate(0, 0, -len * 0.2);
  parts.push(colorize(pet, new THREE.Color('#5a7a3a')));
  const leaf = mergeGeometries(parts, false);
  if (!leaf) throw new Error('leaf geometry: attribute mismatch');
  return leaf;
}

/** Whole plant, base at origin, height ~ 0.55 (scale per instance). */
export function makePlantGeometry(seed = 7): THREE.BufferGeometry {
  const rand = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const H = 0.62;
  const stem = new THREE.CylinderGeometry(0.008, 0.014, H, 6);
  stem.translate(0, H / 2, 0);
  parts.push(colorize(stem, new THREE.Color('#5e7d3e')));
  const nodes = 4;
  for (let k = 0; k < nodes; k++) {
    const y = 0.12 + (k / (nodes - 1)) * (H - 0.2);
    const leaves = k < nodes - 1 ? 4 : 3;
    const len = 0.27 - k * 0.03;
    for (let j = 0; j < leaves; j++) {
      const g = palmateLeaf(len, rand, k < 2);
      g.rotateZ(-0.15 - rand() * 0.2);                       // droop
      g.rotateY((j / leaves) * Math.PI * 2 + k * 0.6 + rand() * 0.3);
      g.translate(0, y, 0);
      parts.push(g);
    }
  }
  // cola: a few stacked flattened spheres with a lighter, slightly orange-tinted green
  for (let i = 0; i < 4; i++) {
    const r = 0.035 - i * 0.005;
    const bud = new THREE.IcosahedronGeometry(r, 1);
    bud.scale(1, 1.4, 1);
    bud.translate((rand() - 0.5) * 0.01, H - 0.02 + i * 0.045, (rand() - 0.5) * 0.01);
    parts.push(colorize(bud, new THREE.Color('#7fb35a').offsetHSL(0.02 * i, 0.05, 0), 0.05, rand));
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('plant geometry: attribute mismatch');
  merged.computeVertexNormals();
  return merged;
}

// ─── Textures ─────────────────────────────────────────────────────────────────

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, rand: () => number) => void, repeat: number, seed = 3): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  paint(ctx, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Concrete / plaster: grey noise with faint pores and a few hairline cracks. */
export function concreteTexture(light = false): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, rand) => {
    ctx.fillStyle = light ? '#cfd3d9' : '#8a919c';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 26000; i++) {
      const v = Math.floor(rand() * 60) - 30;
      ctx.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},${0.10 + rand() * 0.12})`;
      ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 2, 1 + rand() * 2);
    }
    ctx.strokeStyle = 'rgba(40,40,40,0.18)';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      let x = rand() * 512, y = rand() * 512;
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (rand() - 0.5) * 60; y += (rand() - 0.5) * 60; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }, 0.6);
}

/** Epoxy floor: near-uniform base with fine speckle (quartz flakes). */
export function epoxyTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, rand) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 18000; i++) {
      const v = 200 + Math.floor(rand() * 55);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.35 + rand() * 0.4})`;
      ctx.fillRect(rand() * 512, rand() * 512, 1, 1);
    }
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = `rgba(30,30,30,${0.15 + rand() * 0.25})`;
      ctx.fillRect(rand() * 512, rand() * 512, 1, 1);
    }
  }, 1.2, 11);
}

/** Brushed stainless: horizontal streaks. */
export function steelTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, rand) => {
    ctx.fillStyle = '#b8bcc4';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y++) {
      const v = 170 + Math.floor(rand() * 60);
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 6},0.55)`;
      ctx.fillRect(0, y, 256, 1);
    }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rand() * 0.25})`;
      ctx.fillRect(rand() * 256, rand() * 256, 20 + rand() * 80, 1);
    }
  }, 2, 5);
}

/** Roughness map companion for the epoxy (slightly glossier speckles). */
export function epoxyRoughness(): THREE.CanvasTexture {
  const t = canvasTexture(256, (ctx, rand) => {
    ctx.fillStyle = '#6a6a6a';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) {
      const v = 60 + Math.floor(rand() * 90);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rand() * 256, rand() * 256, 1, 1);
    }
  }, 1.2, 13);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** White plaster / plasterboard wall: very light noise, faint panel joints. */
export function plasterTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, rand) => {
    ctx.fillStyle = '#f1f1ee';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 14000; i++) {
      const v = 228 + Math.floor(rand() * 26);
      ctx.fillStyle = `rgba(${v},${v},${v - 2},${0.25 + rand() * 0.3})`;
      ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 2, 1 + rand() * 2);
    }
    ctx.strokeStyle = 'rgba(180,180,175,0.35)';
    ctx.lineWidth = 0.8;
    for (const x of [128, 384]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
  }, 0.5, 21);
}

/** Ribbed white aluminium bench tray: fine lengthwise ribs. */
export function aluminiumRibTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, (ctx) => {
    ctx.fillStyle = '#e9ebee';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 8) {
      ctx.fillStyle = 'rgba(160,165,172,0.55)';
      ctx.fillRect(0, y, 256, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(0, y + 2, 256, 1);
    }
  }, 1, 8);
  t.repeat.set(1, 6);
  return t;
}

/** Grodan Max block wrap: white with small dark print marks, brown top drawn separately. */
export function grodanTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, rand) => {
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(40,60,50,0.75)';
    for (let i = 0; i < 9; i++) {
      const x = rand() * 110, y = rand() * 110;
      ctx.fillRect(x, y, 10 + rand() * 12, 3);
      if (rand() > 0.5) ctx.fillRect(x, y + 5, 6 + rand() * 6, 2);
    }
    ctx.fillStyle = 'rgba(40,120,70,0.8)';
    ctx.fillRect(10, 100, 24, 8);
  }, 1, 33);
}

/** Galvanised steel: mottled grey spangle. */
export function galvanisedTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, rand) => {
    ctx.fillStyle = '#a9adb3';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      const v = 140 + Math.floor(rand() * 90);
      ctx.fillStyle = `rgba(${v},${v + 3},${v + 8},0.6)`;
      ctx.beginPath();
      ctx.arc(rand() * 256, rand() * 256, 4 + rand() * 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 3, 44);
}
