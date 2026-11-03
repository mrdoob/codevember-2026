import * as THREE from 'three/webgpu';
import { randomGenerator } from './fracture.js';

// Seamless four-metre tiles: broad polish variation, fine grain, and shallow
// surface relief. World-space sampling keeps them fixed as the floor follows
// the camera; mipmaps and anisotropy suppress shimmer at grazing angles.
export function floorSurfaceTextures() {
  const size = 512, random = randomGenerator(9041);
  const lattice = Float32Array.from({ length: 128 * 128 }, () => random());
  const noise = (u, v, frequency) => {
    const x = u * frequency, y = v * frequency, ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx *= fx * (3 - 2 * fx); fy *= fy * (3 - 2 * fy);
    // Each octave wraps at its own frequency, so all scales meet at the tile boundary.
    const at = (a, b) => lattice[((b % frequency + frequency) % frequency) * 128 + (a % frequency + frequency) % frequency];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), fx), THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
  };
  const height = new Float32Array(size * size), roughness = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, u = x / size, v = y / size;
    const polish = noise(u, v, 8), fine = noise(u, v, 128), grain = random();
    height[i] = noise(u, v, 16) * 0.004 + fine * 0.0005 + grain * 0.00012;
    const value = THREE.MathUtils.clamp(polish * 0.5 + fine * 0.35 + grain * 0.15, 0, 1) * 255;
    roughness[i * 4] = roughness[i * 4 + 1] = roughness[i * 4 + 2] = value; roughness[i * 4 + 3] = 255;
  }
  const normal = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + (x + size) % size];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * size / 8;
    const dy = (at(x, y + 1) - at(x, y - 1)) * size / 8;
    const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    normal[i] = Math.round((0.5 - dx / length * 0.5) * 255);
    normal[i + 1] = Math.round((0.5 - dy / length * 0.5) * 255);
    normal[i + 2] = Math.round((0.5 + 0.5 / length) * 255); normal[i + 3] = 255;
  }
  const texture = data => {
    const map = new THREE.DataTexture(data, size, size);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = 8; map.needsUpdate = true;
    return map;
  };
  return { normal: texture(normal), roughness: texture(roughness) };
}
