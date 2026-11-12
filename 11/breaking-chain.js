import * as THREE from "three/webgpu";
import { LINK, linkPoint } from "./link-shape.js";
import { CUT, STEP } from "./tension-simulation.js";

export function createLinkGeometry({
  start = 0,
  span = 1,
  caps = false,
  shape = LINK,
} = {}) {
  const rings = Math.ceil(144 * span),
    sides = 24,
    positions = [],
    normals = [],
    uvs = [],
    fractures = [],
    indices = [];
  const length = 2 * Math.PI * shape.bend + 4 * shape.halfStraight;
  for (let i = 0; i <= rings; i++) {
    const t = start + (i / rings) * span,
      p = linkPoint(t, shape),
      a = linkPoint(t - 0.0001, shape),
      b = linkPoint(t + 0.0001, shape);
    const tx = b[0] - a[0],
      ty = b[1] - a[1],
      len = Math.hypot(tx, ty),
      nx = ty / len,
      ny = -tx / len;
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2,
        n = [nx * Math.cos(angle), ny * Math.cos(angle), Math.sin(angle)];
      const radius =
        shape.tube *
        (1 +
          0.025 * Math.sin(t * 91 + angle * 5) * Math.sin(t * 38 - angle * 3));
      const end = (i === 0 || i === rings) && caps;
      const jagged = end
        ? Math.sin(angle * 7 + 1) * 0.0025 + Math.sin(angle * 11) * 0.0015
        : 0;
      positions.push(
        p[0] + n[0] * radius + (tx / len) * jagged,
        p[1] + n[1] * radius + (ty / len) * jagged,
        n[2] * radius,
      );
      normals.push(...n);
      uvs.push(t * length * 1.4, (j / sides) * 2 * Math.PI * shape.tube * 1.4);
      fractures.push(0);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  if (caps)
    for (const end of [0, rings]) {
      const t = start + (end / rings) * span,
        p = linkPoint(t, shape),
        a = linkPoint(t - 0.0001, shape),
        b = linkPoint(t + 0.0001, shape);
      const tangent = new THREE.Vector3(b[0] - a[0], b[1] - a[1], 0)
        .normalize()
        .multiplyScalar(end === 0 ? -1 : 1);
      const base = positions.length / 3;
      positions.push(...p);
      normals.push(...tangent.toArray());
      uvs.push(t * length * 1.4, 0.15);
      fractures.push(1);
      for (let j = 0; j <= sides; j++) {
        const source = (end * (sides + 1) + j) * 3;
        positions.push(...positions.slice(source, source + 3));
        normals.push(...tangent.toArray());
        uvs.push(t * length * 1.4 + j * 0.003, 0.15);
        fractures.push(1);
      }
      for (let j = 0; j < sides; j++)
        if (end === 0) indices.push(base, base + j + 1, base + j + 2);
        else indices.push(base, base + j + 2, base + j + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "fracture",
    new THREE.Float32BufferAttribute(fractures, 1),
  );
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createBreakingChain(
  scene,
  simulation,
  material,
  z = 0,
  seed = 0,
) {
  const group = new THREE.Group();
  group.position.z = z;
  scene.add(group);
  const fragmentCount = simulation.fractureMode === "shatter" ? 4 : 2;
  const geometries = [
    createLinkGeometry(),
    ...Array.from({ length: fragmentCount }, (_, i) =>
      createLinkGeometry({
        start: CUT + i / fragmentCount,
        span: 1 / fragmentCount,
        caps: true,
      }),
    ),
  ];
  const fieldOffset = (i) => [seed * 0.97 + i * 0.731, seed * 0.41 + i * 0.317];
  const meshes = geometries.map((geometry, n) => {
    const count = n === 0 ? simulation.links.length : simulation.chainCount;
    const data = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) data.set(fieldOffset(i), i * 2);
    geometry.setAttribute(
      "linkData",
      new THREE.InstancedBufferAttribute(data, 2),
    );
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  });
  meshes[0].name = "Iron links";
  meshes[1].name = "Fractured lower U";
  meshes[2].name = "Fractured upper U";
  const fragmentMeshes = meshes.slice(1);
  let split = 0;
  const pose = new THREE.Object3D(),
    position = new THREE.Vector3(),
    quaternion = new THREE.Quaternion();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  function update(interpolate = true) {
    const alpha = interpolate
      ? Math.max(0, Math.min(1, simulation.accumulator / STEP))
      : 1;
    function place(mesh, index, body) {
      pose.position
        .fromArray(body.previousPosition)
        .lerp(position.fromArray(body.position), alpha);
      pose.quaternion
        .fromArray(body.previousQuaternion)
        .slerp(quaternion.fromArray(body.quaternion), alpha);
      pose.updateMatrix();
      mesh.setMatrixAt(index, pose.matrix);
    }
    for (let i = 0; i < simulation.links.length; i++) {
      if (!simulation.links[i]) meshes[0].setMatrixAt(i, hidden);
      else place(meshes[0], i, simulation.links[i]);
    }
    for (const mesh of fragmentMeshes) {
      mesh.visible = simulation.fractures.length > 0;
      mesh.count = simulation.fractures.length;
    }
    for (const fracture of simulation.fractures) {
      // Keep every previous fracture in the scene, with its own parent patina.
      if (fracture.order >= split)
        for (const mesh of fragmentMeshes) {
          mesh.geometry.attributes.linkData.array.set(
            fieldOffset(fracture.index),
            fracture.order * 2,
          );
          mesh.geometry.attributes.linkData.needsUpdate = true;
        }
      fracture.fragments.forEach((body, i) =>
        place(fragmentMeshes[i], fracture.order, body),
      );
    }
    split = simulation.fractures.length;
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }
  update(false);
  return {
    group,
    meshes,
    fragmentMeshes,
    update,
    dispose() {
      scene.remove(group);
      for (const g of geometries) g.dispose();
      for (const m of meshes) m.dispose();
    },
  };
}
