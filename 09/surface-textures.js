import * as THREE from "three/webgpu";
import { randomGenerator } from "./modes.js";

// Both finishes are generated locally. The brushing has long circumferential
// scratches; the graphite finish has fine, nondirectional pores.
export function createFinishTexture(brushed = false) {
  const random = randomGenerator(brushed ? 194 : 209);
  const size = brushed ? 1024 : 512,
    data = new Uint8Array(size * size * 4);
  const rows = Array.from({ length: size }, () => random());
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = random();
      const line =
        (rows[y] * 2 + rows[(y + 1) % size] + rows[(y + size - 1) % size]) / 4;
      const height = brushed
        ? 0.16 + line * 0.68 + grain * 0.16
        : 0.25 + grain * 0.75;
      data[i] = data[i + 1] = data[i + 2] = Math.round(height * 255);
      data[i + 3] = 255;
    }
  const map = new THREE.DataTexture(data, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

// Matte moulded polymer with gently rounded grain, stored as a height map.
export function createPorousTexture() {
  const random = randomGenerator(909),
    size = 512,
    height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++)
    height[i] = 0.55 + (random() - 0.5) * 0.34;
  for (let pore = 0; pore < 3200; pore++) {
    const x = Math.floor(random() * size),
      y = Math.floor(random() * size);
    const radius = 1.2 + random() * 2.2,
      depth = 0.08 + random() * 0.12,
      reach = Math.ceil(radius);
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        const d = (dx * dx + dy * dy) / (radius * radius);
        if (d < 1)
          height[((y + dy + size) % size) * size + ((x + dx + size) % size)] -=
            depth * (1 - d) ** 2;
      }
  }
  // A wrapped Gaussian blur softens the grain's slopes without introducing seams.
  const horizontal = new Float32Array(height.length),
    soft = new Float32Array(height.length),
    weights = [1, 4, 6, 4, 1];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let value = 0;
      for (let k = -2; k <= 2; k++)
        value += height[y * size + ((x + k + size) % size)] * weights[k + 2];
      horizontal[y * size + x] = value / 16;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let value = 0;
      for (let k = -2; k <= 2; k++)
        value +=
          horizontal[((y + k + size) % size) * size + x] * weights[k + 2];
      soft[y * size + x] = value / 16;
    }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < height.length; i++) {
    data[i * 4] =
      data[i * 4 + 1] =
      data[i * 4 + 2] =
        Math.round(Math.max(0, Math.min(1, soft[i])) * 255);
    data[i * 4 + 3] = 255;
  }
  const map = new THREE.DataTexture(data, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}
