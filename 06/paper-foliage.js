import * as THREE from "three/webgpu";
import { texture, uv, vec3, vec4 } from "three/tsl";

// View the garden from the paper, independent of the viewer's orbit.
// The final background DOF provides softness; the capture needs no blur passes.
export function createPaperFoliage(foliage, parent, opening) {
  const width = 768,
    height = 512;
  const garden = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    (-opening.w * parent.scale.x) / 2,
    (opening.w * parent.scale.x) / 2,
    opening.h / 2,
    -opening.h / 2,
    0.01,
    20,
  );
  camera.position.copy(
    parent.localToWorld(
      new THREE.Vector3(opening.x, opening.y, -25.96 - opening.recess),
    ),
  );
  camera.lookAt(parent.localToWorld(new THREE.Vector3(0, opening.y, -40)));
  const materials = [];
  for (const mesh of foliage.meshes) {
    const material = new THREE.MeshBasicNodeMaterial({
      name: `Paper capture: ${mesh.material.name}`,
      side: THREE.DoubleSide,
    });
    material.positionNode = mesh.material.positionNode;
    material.fragmentNode = vec4(
      mesh.material.colorNode || vec3(0.2, 0.16, 0.09),
      1,
    );
    material.toneMapped = false;
    const copy = new THREE.Mesh(mesh.geometry, material);
    mesh.updateWorldMatrix(true, false);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(mesh.matrixWorld);
    garden.add(copy);
    materials.push(material);
  }
  const target = new THREE.RenderTarget(width, height, {
    type: THREE.HalfFloatType,
  });
  let lastTime = NaN,
    state;
  return {
    node: texture(target.texture, uv()),
    target,
    update(renderer) {
      if (lastTime === foliage.time.value) return;
      state = THREE.RendererUtils.resetRendererState(renderer, state);
      try {
        renderer.setClearColor(0xffffff, 1);
        renderer.setRenderTarget(target);
        renderer.render(garden, camera);
        lastTime = foliage.time.value;
      } finally {
        THREE.RendererUtils.restoreRendererState(renderer, state);
      }
    },
    dispose() {
      for (const material of materials) material.dispose();
      target.dispose();
    },
  };
}
