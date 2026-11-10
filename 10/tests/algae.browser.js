import {
  Scene,
  OrthographicCamera,
  MeshBasicNodeMaterial,
  InstancedMesh,
  StorageInstancedBufferAttribute,
  RenderTarget,
  Matrix4,
  Color,
  DoubleSide,
} from "three/webgpu";

export async function checkAlgae(app = window.caustic) {
  const renderer = app.renderer,
    before = app.inspect(),
    manual = app.manual,
    time = app.optics.time.value;
  const target = new RenderTarget(256, 384),
    previousTarget = renderer.getRenderTarget(),
    previousMRT = renderer.getMRT();
  const clear = renderer.getClearColor(new Color()),
    alpha = renderer.getClearAlpha(),
    autoClear = renderer.autoClear;
  const scene = new Scene(),
    camera = new OrthographicCamera(-0.25, 0.55, 1.1, -0.1, 0.1, 10);
  camera.position.set(0, 0, 4);
  const material = new MeshBasicNodeMaterial({
    color: 0xffffff,
    toneMapped: false,
    side: DoubleSide,
  });
  material.positionNode = app.marine.algae.material.positionNode;
  const mesh = new InstancedMesh(app.marine.algae.geometry, material, 1);
  mesh.instanceMatrix = new StorageInstancedBufferAttribute(
    new Float32Array(16),
    16,
  );
  mesh.setMatrixAt(0, new Matrix4());
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  const capture = async (value) => {
    app.optics.time.value = value;
    await new Promise(requestAnimationFrame);
    renderer.setRenderTarget(target);
    renderer.setMRT(null);
    renderer.render(scene, camera);
    return renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      target.width,
      target.height,
    );
  };
  try {
    app.manual = true;
    app.pause(true);
    renderer.autoClear = true;
    renderer.setClearColor(0, 0);
    const a = await capture(0),
      b = await capture(2.5),
      paused = await capture(2.5);
    let moved = 0,
      changedWhenPaused = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i]) moved++;
      if (b[i] !== paused[i]) changedWhenPaused++;
    }
    const count = app.marine.algae.count + app.marine.smallAlgae.count;
    if (count < 5000 || moved < 100 || changedWhenPaused)
      throw new Error(
        `Algae motion/density failed: ${JSON.stringify({ count, moved, changedWhenPaused })}`,
      );
    return { passed: true, count, moved, changedWhenPaused };
  } finally {
    app.optics.time.value = time;
    renderer.setRenderTarget(previousTarget);
    renderer.setMRT(previousMRT);
    renderer.setClearColor(clear, alpha);
    renderer.autoClear = autoClear;
    mesh.dispose();
    material.dispose();
    target.dispose();
    app.pause(before.paused);
    app.manual = manual;
    app.changed();
  }
}
