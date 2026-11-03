import * as THREE from 'three/webgpu';
import { randomGenerator } from './fracture.js';

// Physical-sized height variations: broad conchoidal ripples, finer fracture
// ridges, and sparse hairline scuffs. Normal derivatives are computed in texture
// space, so the amount of detail no longer changes with the screen resolution.
export function glassSurfaceTextures() {
  const size = 1024, random = randomGenerator(24);
  const height = new Float32Array(size * size);
  const lattice = Float32Array.from({ length: 64 * 64 }, () => random());
  const noise = (x, y, frequency) => {
    const px = x * frequency, py = y * frequency;
    const ix = Math.floor(px), iy = Math.floor(py);
    let fx = px - ix, fy = py - iy; fx *= fx * (3 - 2 * fx); fy *= fy * (3 - 2 * fy);
    const at = (a, b) => lattice[((b % 64 + 64) % 64) * 64 + (a % 64 + 64) % 64];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), fx), THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
  };
  const origins = Array.from({ length: 9 }, () => ({ x: random(), y: random(), phase: random() * 6.28, frequency: 70 + random() * 90 }));
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'black'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 110; i++) {
    const x = random() * size, y = random() * size, length = 12 + random() ** 2 * 180, angle = random() * Math.PI * 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + random() * 0.45})`; ctx.lineWidth = 0.5 + random() * 0.7;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.beginPath(); ctx.moveTo(x + ox, y + oy);
      ctx.quadraticCurveTo(x + ox + Math.cos(angle + 0.15) * length * 0.5, y + oy + Math.sin(angle + 0.15) * length * 0.5, x + ox + Math.cos(angle) * length, y + oy + Math.sin(angle) * length); ctx.stroke();
    }
  }
  const scratches = ctx.getImageData(0, 0, size, size).data;
  const roughness = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const broad = noise(u, v, 8), fine = noise(u, v, 64);
    let ripples = 0;
    for (const origin of origins) {
      const dx = ((u - origin.x + 1.5) % 1) - 0.5, dy = ((v - origin.y + 1.5) % 1) - 0.5;
      const r = Math.hypot(dx * 1.25, dy);
      ripples += Math.sin(r * origin.frequency + broad * 4 + origin.phase) * Math.exp(-r * r * 38);
    }
    const scratch = scratches[i * 4] / 255;
    height[i] = broad * 0.008 + noise(u, v, 16) * 0.002 + fine * 0.00045 + ripples * 0.0006 - scratch * 0.0011;
    const rough = Math.min(1, 0.12 + fine * 0.32 + scratch * 0.65);
    roughness[i * 4] = roughness[i * 4 + 1] = roughness[i * 4 + 2] = rough * 255; roughness[i * 4 + 3] = 255;
  }
  const normal = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + (x + size) % size];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * size * 0.6 / 2;
    const dy = (at(x, y + 1) - at(x, y - 1)) * size * 0.6 / 2;
    const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    normal[i] = (0.5 - dx / length * 0.5) * 255;
    normal[i + 1] = (0.5 - dy / length * 0.5) * 255;
    normal[i + 2] = (0.5 + 0.5 / length) * 255; normal[i + 3] = 255;
  }
  const texture = data => {
    const map = new THREE.DataTexture(data, size, size);
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.anisotropy = 8; map.needsUpdate = true;
    return map;
  };
  return { normal: texture(normal), roughness: texture(roughness) };
}
