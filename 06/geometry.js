import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
export function annulus(inner, outer, height, segments = 192, bevel = 0) {
  const b = Math.min(bevel, height * 0.49, (outer - inner) * 0.49);
  const profile =
    b > 0
      ? [
          new THREE.Vector2(inner + b, -height / 2),
          new THREE.Vector2(outer - b, -height / 2),
          new THREE.Vector2(outer, -height / 2 + b),
          new THREE.Vector2(outer, height / 2 - b),
          new THREE.Vector2(outer - b, height / 2),
          new THREE.Vector2(inner + b, height / 2),
          new THREE.Vector2(inner, height / 2 - b),
          new THREE.Vector2(inner, -height / 2 + b),
        ]
      : [
          new THREE.Vector2(inner, -height / 2),
          new THREE.Vector2(outer, -height / 2),
          new THREE.Vector2(outer, height / 2),
          new THREE.Vector2(inner, height / 2),
        ];
  // Flat caps, straight walls and optional chamfers have separate normals.
  // Each band still shades smoothly around the circumference.
  const faces = profile.map(
    (point, i) =>
      new THREE.LatheGeometry(
        [point, profile[(i + 1) % profile.length]],
        segments,
      ),
  );
  const geometry = mergeGeometries(faces);
  faces.forEach((face) => face.dispose());
  return geometry;
}

export function addMesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function rod(parent, from, to, radius, material) {
  const a = new THREE.Vector3(...from),
    b = new THREE.Vector3(...to);
  const mesh = addMesh(
    parent,
    new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 12),
    material,
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.sub(a).normalize(),
  );
  return mesh;
}

export function ring(parent, radius, tube, material, y = 0) {
  const mesh = addMesh(
    parent,
    new THREE.TorusGeometry(radius, tube, 8, 192),
    material,
    0,
    y,
  );
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

// Consolidate static assemblies by material, retaining separate moving parts.
export function consolidate(group) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert(),
    batches = new Map();
  const originals = [];
  group.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry
      .clone()
      .applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const name of Object.keys(flat.attributes))
      if (!["position", "normal", "uv"].includes(name))
        flat.deleteAttribute(name);
    const list = batches.get(object.material) || [];
    list.push(flat);
    batches.set(object.material, list);
    originals.push(object);
  });
  for (const object of originals) {
    object.removeFromParent();
    object.geometry.dispose();
  }
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error("Unable to merge clockwork assembly.");
    addMesh(group, geometry, material);
    geometries.forEach((g) => g.dispose());
  }
  return group;
}
