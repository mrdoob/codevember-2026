import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, uniform, vec3, vec4, positionGeometry, cameraWorldMatrix, varying } from 'three/tsl';
import { randomSeed } from './random.js';

export function createSnowfall(scene, camera) {
  const count = 3200, p = [], seeds = [], indices = [], random = randomSeed(130000);
  for (let i = 0; i < count; i++) {
    const seed = [random() * 40, random() * 12, random() * 40, random()];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { p.push(x, y, 0); seeds.push(...seed); }
    const j = i * 4; indices.push(j, j + 1, j + 2, j, j + 2, j + 3);
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(p, 3)); geometry.setAttribute('flake', new Float32BufferAttribute(seeds, 4)); geometry.setIndex(indices);
  const time = uniform(0), amount = uniform(1), center = uniform(camera.position.clone());
  const material = new MeshBasicNodeMaterial({ color: '#91add1', transparent: true, depthWrite: false });
  const seed = attribute('flake', 'vec4');
  const local = vec3(seed.x.add(time.mul(.3)).sub(center.x).mod(40).sub(20), seed.y.sub(time.mul(seed.w.mul(.2).add(.22))).mod(12), seed.z.add(time.mul(.11)).sub(center.z).mod(40).sub(20));
  material.positionNode = local.add(vec3(center.x, 0, center.z)).add(cameraWorldMatrix.mul(vec4(positionGeometry.xy.mul(seed.w.mul(.009).add(.004)), 0, 0)).xyz);
  const disk = varying(positionGeometry.xy).length().smoothstep(.1, 1).oneMinus();
  material.opacityNode = seed.w.mul(.3).add(.08).mul(amount).mul(local.xz.length().smoothstep(10, 21).oneMinus()).mul(disk);
  const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; mesh.name = 'Windblown powder'; scene.add(mesh);
  return { mesh, time, amount, update(t, strength) { time.value = t; amount.value = strength; center.value.copy(camera.position); }, dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); } };
}
