import { Color, Group, InstancedMesh, Matrix3, MeshStandardNodeMaterial, Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { attribute } from 'three/tsl';
import { createFloorTuftGeometry } from './floor-moss.js';
import { randomSeed, smoothstep } from './random.js';

// Sample the rendered cushion triangles in world units. Small stones get
// fewer tufts, while leaf size stays consistent across the clearing.
export function createOutcropMoss(surfaces, groundHeight) {
  const group = new Group();
  group.name = 'Ground rock moss shoots';
  const random = randomSeed(505117), buckets = [[], [], []];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const ab = new Vector3(), ac = new Vector3(), point = new Vector3(), normal = new Vector3();
  const na = new Vector3(), nb = new Vector3(), nc = new Vector3(), up = new Vector3(0, 1, 0);
  const normalMatrix = new Matrix3(), transform = new Object3D(), spin = new Quaternion();
  let coveredRocks = 0;
  for (const { geometry, matrix } of surfaces) {
    const p = geometry.attributes.position, n = geometry.attributes.normal, coverage = geometry.attributes.coverage;
    const indices = geometry.index.array;
    normalMatrix.getNormalMatrix(matrix);
    let count = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i], ib = indices[i + 1], ic = indices[i + 2];
      a.fromBufferAttribute(p, ia).applyMatrix4(matrix);
      b.fromBufferAttribute(p, ib).applyMatrix4(matrix);
      c.fromBufferAttribute(p, ic).applyMatrix4(matrix);
      const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * .5;
      const expected = area * 180;
      const samples = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
      if (!samples) continue;
      na.fromBufferAttribute(n, ia).applyNormalMatrix(normalMatrix);
      nb.fromBufferAttribute(n, ib).applyNormalMatrix(normalMatrix);
      nc.fromBufferAttribute(n, ic).applyNormalMatrix(normalMatrix);
      for (let j = 0; j < samples; j++) {
        const r = Math.sqrt(random()), u = 1 - r, v = r * random(), w = r - v;
        const cover = coverage.getX(ia) * u + coverage.getX(ib) * v + coverage.getX(ic) * w;
        normal.copy(na).multiplyScalar(u).addScaledVector(nb, v).addScaledVector(nc, w).normalize();
        if (random() > smoothstep(.17, .65, cover) * smoothstep(.05, .45, normal.y)) continue;
        point.copy(a).multiplyScalar(u).addScaledVector(b, v).addScaledVector(c, w);
        if (point.y < groundHeight(point.x, point.z) + .008) continue;
        transform.position.copy(point).addScaledVector(normal, -.004);
        transform.quaternion.setFromUnitVectors(up, normal);
        spin.setFromAxisAngle(up, random() * Math.PI * 2); transform.quaternion.multiply(spin);
        transform.scale.setScalar(.78 + random() * .36); transform.updateMatrix();
        buckets[Math.floor(random() * buckets.length)].push({ matrix: transform.matrix.clone(), shade: .78 + random() * .22 });
        count++;
      }
    }
    if (count) coveredRocks++;
  }
  const material = new MeshStandardNodeMaterial({ roughness: .94 });
  material.colorNode = attribute('pigment', 'vec3');
  material.aoNode = attribute('plant', 'vec3').z;
  const tint = new Color(), meshes = [];
  for (let i = 0; i < buckets.length; i++) {
    const geometry = createFloorTuftGeometry(7181 + i * 79), items = buckets[i];
    const mesh = new InstancedMesh(geometry, material, items.length);
    mesh.name = `Ground rock moss shoots ${i + 1}`;
    items.forEach((item, j) => {
      mesh.setMatrixAt(j, item.matrix);
      mesh.setColorAt(j, tint.setRGB(item.shade * .95, item.shade, item.shade * .85));
    });
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    // The cushion casts the shadow; tiny leaves receive lighting and basal AO.
    mesh.receiveShadow = true; mesh.computeBoundingSphere(); group.add(mesh); meshes.push(mesh);
  }
  return { group, tufts: buckets.reduce((sum, items) => sum + items.length, 0), coveredRocks,
    dispose() { for (const mesh of meshes) { mesh.dispose(); mesh.geometry.dispose(); } material.dispose(); }
  };
}
