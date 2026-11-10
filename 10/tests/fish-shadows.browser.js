import { DataUtils, Mesh, PlaneGeometry } from "three/webgpu";
import { vec4 } from "three/tsl";

// Measure transmitted sunlight with the production fish and stone materials.
// A clear receiver isolates transmission from the nearest-layer shadow map's
// inability to retain opaque blockers behind a transmitting fish.
export async function checkFishShadows(app = window.caustic) {
  const settings = { ...app.settings },
    state = app.inspect(),
    manual = app.manual,
    fish = app.marine.fish,
    material = fish.material,
    coloredShadow = material.castShadowNode,
    cast = fish.castShadow;
  const blackShadow = vec4(0, 0, 0, 1);
  const architecture = app.room.meshes.map((mesh) => [mesh, mesh.visible]);
  const receiver = new Mesh(new PlaneGeometry(40, 40), app.room.floorMaterial);
  receiver.rotation.x = -Math.PI / 2;
  receiver.receiveShadow = true;
  const read = async (name) => {
    const rt = app.post.scenePass.renderTarget;
    return Float32Array.from(
      await app.renderer.readRenderTargetPixelsAsync(
        rt,
        0,
        0,
        rt.width,
        rt.height,
        rt.textures.findIndex((t) => t.name === name),
      ),
      DataUtils.fromHalfFloat,
    );
  };
  const render = async (enabled, node) => {
    fish.castShadow = enabled;
    material.castShadowNode = node;
    material.needsUpdate = true;
    app.room.sun.shadow.needsUpdate = true;
    app.changed();
    for (let i = 0; i < 3; i++) {
      await new Promise(requestAnimationFrame);
      app.render();
    }
    return read("output");
  };
  try {
    if (!app.renderer.shadowMap.transmitted || !coloredShadow)
      throw new Error("Native colored fish shadows are not enabled.");
    app.manual = true;
    app.pause(true);
    Object.assign(app.settings, {
      fish: true,
      algae: false,
      orb: false,
      particles: false,
      ssr: false,
      caustics: 0,
    });
    for (const [mesh] of architecture) mesh.visible = false;
    app.scene.add(receiver);
    const black = await render(true, blackShadow);
    const colored = await render(true, coloredShadow);
    const unshadowed = await render(false, coloredShadow);
    const control = await render(false, blackShadow);
    const surface = await read("diffuse");
    let shadowPixels = 0,
      coloredPixels = 0,
      maxExcess = 0,
      controlDifference = 0,
      meanTransmission = 0;
    for (let i = 0; i < surface.length; i += 4) {
      if (Math.floor(surface[i + 3] / 256) !== 4) continue;
      const ratios = [];
      for (let channel = 0; channel < 3; channel++) {
        const k = i + channel;
        if (
          ![black[k], colored[k], unshadowed[k], control[k]].every(
            Number.isFinite,
          )
        )
          throw new Error("Nonfinite fish shadow radiance.");
        maxExcess = Math.max(maxExcess, colored[k] - unshadowed[k]);
        controlDifference = Math.max(
          controlDifference,
          Math.abs(control[k] - unshadowed[k]),
        );
        const incident = unshadowed[k] - black[k];
        if (incident > 0.05) ratios.push((colored[k] - black[k]) / incident);
      }
      if (ratios.length !== 3) continue;
      shadowPixels++;
      meanTransmission += ratios.reduce((a, b) => a + b) / 3;
      if (Math.max(...ratios) - Math.min(...ratios) > 0.025) coloredPixels++;
    }
    meanTransmission /= shadowPixels;
    if (coloredPixels < 100)
      throw new Error(`Colored fish shadows missing: ${coloredPixels} pixels.`);
    if (
      !(meanTransmission > 0.01 && meanTransmission < 0.65) ||
      maxExcess > 0.003
    )
      throw new Error(
        `Invalid shadow transmission: ${JSON.stringify({ meanTransmission, maxExcess, shadowPixels, coloredPixels })}`,
      );
    if (controlDifference > 0.001)
      throw new Error(
        "Shadow tint changed stone lighting with fish casting disabled.",
      );
    return {
      passed: true,
      shadowPixels,
      coloredPixels,
      meanTransmission,
      maxExcess,
      controlDifference,
    };
  } finally {
    app.scene.remove(receiver);
    receiver.geometry.dispose();
    for (const [mesh, visible] of architecture) mesh.visible = visible;
    material.castShadowNode = coloredShadow;
    material.needsUpdate = true;
    fish.castShadow = cast;
    Object.assign(app.settings, settings);
    app.pause(state.paused);
    app.manual = manual;
    app.room.sun.shadow.needsUpdate = true;
    app.post.invalidate();
    app.changed();
  }
}
