import { BundleGroup, InstancedMesh, Object3D, BoxGeometry } from 'three/webgpu';
import { HEDGE_HEIGHT, WIDTH, DEPTH, occupied, world } from './maze.js';
import { randomSeed } from './random.js';
import { createHedgePatch } from './hedge-geometry.js';

export function createHedges(scene, maze, materials) {
  const group = new BundleGroup(); group.name = 'Snowbound yew hedges';
  const random = randomSeed(1301), dummy = new Object3D();
  const core = new InstancedMesh(new BoxGeometry(1, 1, 1), materials.core, maze.rectangles.length);
  core.name = 'Opaque hedge interiors';
  maze.rectangles.forEach((r, i) => {
    dummy.position.set(r.x, HEDGE_HEIGHT / 2, r.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(r.w, HEDGE_HEIGHT, r.d); dummy.updateMatrix(); core.setMatrixAt(i, dummy.matrix);
  });
  group.add(core);
  const variants = Array.from({ length: 12 }, (_, i) => createHedgePatch(1313 + i * 7919));
  const transforms = variants.map(() => []);
  for (const face of maze.faces) {
    for (let row = 0; row < 7; row++) {
      const angle = Math.atan2(face.nx, face.nz);
      dummy.position.set(face.x + face.nz * (random() - .5) * .22, .43 + row * .65 + (random() - .5) * .25, face.z - face.nx * (random() - .5) * .22);
      dummy.rotation.set((random() - .5) * .18, angle, (random() - .5) * .15);
      dummy.scale.set(.95 + random() * .3, .93 + random() * .3, .8 + random() * .4);
      dummy.updateMatrix(); transforms[Math.floor(random() * variants.length)].push(dummy.matrix.clone());
    }
  }
  // The same solid sprays crown the hedge, rotated upward. Snow remains geometry.
  for (let z = 0; z < DEPTH; z++) for (let x = 0; x < WIDTH; x++) if (occupied(x, z)) {
    const [wx, wz] = world(x, z);
    dummy.position.set(wx, HEDGE_HEIGHT, wz); dummy.rotation.set(-Math.PI / 2, 0, random() * Math.PI * 2); dummy.scale.set(1.1, 1.1, 1); dummy.updateMatrix();
    transforms[Math.floor(random() * variants.length)].push(dummy.matrix.clone());
  }
  const batches = []; let fullTriangles = 0;
  variants.forEach((geometry, i) => {
    for (const kind of ['foliage', 'snow']) {
      const mesh = new InstancedMesh(geometry[kind], materials[kind], transforms[i].length);
      mesh.name = `Hedge ${kind} / ${i}`; mesh.frustumCulled = false;
      transforms[i].forEach((matrix, j) => mesh.setMatrixAt(j, matrix));
      group.add(mesh); batches.push(mesh); fullTriangles += geometry[kind].index.count / 3 * mesh.count;
    }
  });
  scene.add(group);
  return { group, batches, core, variants, fullTriangles, patches: transforms.reduce((n, t) => n + t.length, 0),
    dispose() { scene.remove(group); for (const v of variants) { v.foliage.dispose(); v.snow.dispose(); } core.geometry.dispose(); } };
}
