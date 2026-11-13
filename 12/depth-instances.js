import { BufferGeometry, InstancedBufferAttribute, InstancedMesh, Box3, Frustum, Matrix4 } from 'three/webgpu';
import { FOCUS_BAND } from './scene-constants.js';

// Only feathers are split. The static meshlet field stays in one background
// pass, and invisible feathers never reach the ordinary geometry draw path.
export function createDepthInstances(scene, camera) {
  const sources = [];
  scene.traverse(object => {
    if (object.isInstancedMesh && object.geometry.hasAttribute('featherPhase')) sources.push(object);
  });
  const entries = sources.map(source => {
    const mask = source.layers.mask;
    source.layers.set(4);
    source.geometry.computeBoundingBox();
    const attributes = Object.entries(source.geometry.attributes).filter(([, a]) => a.isInstancedBufferAttribute);
    const layers = ['background', 'focused', 'foreground'].map((kind, index) => {
      const geometry = new BufferGeometry(); geometry.setIndex(source.geometry.index);
      for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
        geometry.setAttribute(name, attribute.isInstancedBufferAttribute
          ? new InstancedBufferAttribute(new attribute.array.constructor(attribute.array.length), attribute.itemSize, attribute.normalized)
          : attribute);
      }
      const mesh = new InstancedMesh(geometry, source.material, source.count);
      mesh.name = `${source.name || 'Feathers'} / ${kind}`;
      mesh.userData.depthLayer = kind;
      mesh.layers.set(index + 1); mesh.frustumCulled = false; mesh.count = 0;
      return mesh;
    });
    return { source, mask, attributes, layers };
  });
  const frustum = new Frustum(), projection = new Matrix4(), matrix = new Matrix4();
  const box = new Box3(), viewBox = new Box3();
  function copy(entry, layer, index) {
    const slot = layer.count++;
    layer.instanceMatrix.array.set(entry.source.instanceMatrix.array.subarray(index * 16, index * 16 + 16), slot * 16);
    for (const [name, attribute] of entry.attributes) {
      const size = attribute.itemSize;
      layer.geometry.attributes[name].array.set(attribute.array.subarray(index * size, index * size + size), slot * size);
    }
  }
  return {
    entries,
    update(focus) {
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
      for (const entry of entries) {
        const { source, layers } = entry;
        for (const layer of layers) layer.count = 0;
        for (let i = 0; source.visible && i < source.count; i++) {
          source.getMatrixAt(i, matrix); matrix.premultiply(source.matrixWorld);
          box.copy(source.geometry.boundingBox).applyMatrix4(matrix).expandByScalar(.2);
          if (!frustum.intersectsBox(box)) continue;
          viewBox.copy(box).applyMatrix4(camera.matrixWorldInverse);
          const near = -viewBox.max.z - .1, far = -viewBox.min.z + .1;
          if (far > focus + FOCUS_BAND.far) copy(entry, layers[0], i);
          if (far >= focus - FOCUS_BAND.near && near <= focus + FOCUS_BAND.far) copy(entry, layers[1], i);
          if (near < focus - FOCUS_BAND.near) copy(entry, layers[2], i);
        }
        for (const layer of layers) {
          if (!layer.count) { layer.removeFromParent(); continue; }
          if (layer.parent !== source) source.add(layer);
          layer.instanceMatrix.needsUpdate = true;
          for (const [name] of entry.attributes) layer.geometry.attributes[name].needsUpdate = true;
        }
      }
    },
    dispose() {
      for (const { source, mask, layers } of entries) {
        source.layers.mask = mask;
        for (const layer of layers) { layer.removeFromParent(); layer.dispose(); layer.geometry.dispose(); }
      }
    },
  };
}
