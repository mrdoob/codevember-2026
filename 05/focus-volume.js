import { Box3, Matrix4, Vector3 } from 'three/webgpu';

// Cache local bounds once, including hidden capsules and the maximum breeze.
// Refit only their corners each frame, so floating rocks stay sharp without
// walking thousands of shoot instances during animation.
export function createFocusVolume(subject) {
  subject.updateWorldMatrix(true, true);
  const roots = subject.isMesh ? [subject] : subject.children;
  const entries = [], corners = [], bounds = new Box3();
  const matrix = new Matrix4(), box = new Box3();
  for (const root of roots) {
    const inverse = root.matrixWorld.clone().invert(), local = new Box3();
    root.traverse(object => {
      if (!object.isMesh) return;
      if (object.isInstancedMesh) {
        if (!object.boundingBox) object.computeBoundingBox();
        box.copy(object.boundingBox);
      } else {
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        box.copy(object.geometry.boundingBox);
      }
      matrix.multiplyMatrices(inverse, object.matrixWorld);
      local.union(box.applyMatrix4(matrix));
    });
    if (local.isEmpty()) continue;
    local.expandByScalar(.025);
    for (let i = 0; i < 8; i++) {
      const point = new Vector3(i & 1 ? local.max.x : local.min.x,
        i & 2 ? local.max.y : local.min.y, i & 4 ? local.max.z : local.min.z);
      const world = new Vector3();
      entries.push({ root, point, world }); corners.push(world);
    }
  }
  const view = new Vector3(), range = { near: 0, far: 0 };
  return { bounds, corners, range,
    update(camera) {
      camera.updateMatrixWorld(); subject.updateWorldMatrix(true, true);
      bounds.makeEmpty();
      let near = Infinity, far = -Infinity;
      for (const { root, point, world } of entries) {
        world.copy(point).applyMatrix4(root.matrixWorld);
        bounds.expandByPoint(world);
        view.copy(world).applyMatrix4(camera.matrixWorldInverse);
        near = Math.min(near, -view.z); far = Math.max(far, -view.z);
      }
      range.near = Math.max(camera.near, near);
      range.far = Math.max(range.near, far);
      return range;
    }
  };
}
