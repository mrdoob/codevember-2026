import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  positionView,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

// View the garden from the paper, independent of the viewer's orbit. Alpha
// stores each leaf's distance behind the sheet, in world units / 20.
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
      side: THREE.DoubleSide,
    });
    material.positionNode = mesh.material.positionNode;
    material.fragmentNode = vec4(
      mesh.material.colorNode || vec3(0.2, 0.16, 0.09),
      positionView.z.negate().div(20).clamp(),
    );
    material.toneMapped = false;
    const copy = new THREE.Mesh(mesh.geometry, material);
    mesh.updateWorldMatrix(true, false);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(mesh.matrixWorld);
    garden.add(copy);
    materials.push(material);
  }
  const raw = new THREE.RenderTarget(width, height, {
    type: THREE.HalfFloatType,
  });
  const horizontal = new THREE.RenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  const filtered = horizontal.clone();
  const blur = (input, direction) =>
    Fn(() => {
      const centre = texture(input, uv()).toVar();
      const sum = vec3(0).toVar(),
        weightSum = float(0).toVar();
      for (let i = -12; i <= 12; i++) {
        const tap = texture(input, uv().add(direction.mul(i * 1.5))).toVar();
        // Paper scatters light over a wider footprint as leaf-to-paper distance grows.
        const radius = tap.a.mul(20).pow(1.25).mul(0.8).add(1.7).clamp(2, 17);
        const weight = float(i * i * 2.25)
          .div(radius.pow2())
          .mul(-2)
          .exp()
          .div(radius);
        sum.addAssign(tap.rgb.mul(weight));
        weightSum.addAssign(weight);
      }
      return vec4(sum.div(weightSum.max(0.0001)), centre.a);
    })();
  const hMaterial = new THREE.MeshBasicNodeMaterial();
  hMaterial.fragmentNode = blur(raw.texture, vec2(1 / width, 0));
  const vMaterial = new THREE.MeshBasicNodeMaterial();
  vMaterial.fragmentNode = blur(horizontal.texture, vec2(0, 1 / height));
  const quad = new THREE.QuadMesh(hMaterial);
  let lastTime = NaN,
    state;
  return {
    node: texture(filtered.texture, uv()),
    raw,
    filtered,
    update(renderer) {
      if (lastTime === foliage.time.value) return;
      state = THREE.RendererUtils.resetRendererState(renderer, state);
      try {
        renderer.setClearColor(0xffffff, 1);
        renderer.setRenderTarget(raw);
        renderer.render(garden, camera);
        renderer.setRenderTarget(horizontal);
        quad.material = hMaterial;
        quad.render(renderer);
        renderer.setRenderTarget(filtered);
        quad.material = vMaterial;
        quad.render(renderer);
        lastTime = foliage.time.value;
      } finally {
        THREE.RendererUtils.restoreRendererState(renderer, state);
      }
    },
    dispose() {
      for (const material of [...materials, hMaterial, vMaterial])
        material.dispose();
      raw.dispose();
      horizontal.dispose();
      filtered.dispose();
    },
  };
}
