import {
  DataUtils,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import { uniform, vec3 } from "three/tsl";

// Use the real fish mesh and material, enlarged against a controlled source.
// PMREM stays fixed, so only SSR can reflect changes in the source radiance.
export async function checkFishReflections(app = window.caustic) {
  const settings = { ...app.settings },
    before = app.inspect(),
    manual = app.manual;
  const fish = app.marine.fish,
    count = fish.count,
    matrices = fish.instanceMatrix.array.slice();
  const update = app.marine.update;
  const visibility = app.room.meshes.map((mesh) => [mesh, mesh.visible]);
  visibility.push([app.water.mesh, app.water.mesh.visible]);
  const radiance = uniform(0);
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.colorNode = vec3(radiance, 0, 0);
  const source = new Mesh(new PlaneGeometry(2.4, 3), material);
  source.position.set(2.3, 2.5, 6.5);
  source.lookAt(new Vector3(0, 2.5, 6.5));
  const read = async (rt, attachment = 0) =>
    Float32Array.from(
      await app.renderer.readRenderTargetPixelsAsync(
        rt,
        0,
        0,
        rt.width,
        rt.height,
        attachment,
      ),
      DataUtils.fromHalfFloat,
    );
  const settle = async () => {
    app.changed();
    app.post.invalidate();
    for (let i = 0; i < 20; i++) {
      await new Promise(requestAnimationFrame);
      app.render();
    }
  };
  try {
    app.manual = true;
    app.pause(true);
    Object.assign(app.settings, {
      haze: 0,
      bloom: 0,
      lightShafts: 0,
      particles: false,
      orb: false,
      algae: false,
      fish: true,
      fishGlow: 0,
      caustics: 0,
    });
    update(before.time, app.settings);
    app.marine.update = () => {};
    fish.count = 1;
    fish.setMatrixAt(
      0,
      new Matrix4().makeScale(5, 5, 5).setPosition(0, 2.5, 5),
    );
    fish.instanceMatrix.needsUpdate = true;
    for (const [mesh] of visibility) mesh.visible = false;
    app.scene.add(source);
    await settle();
    const rt = app.post.scenePass.renderTarget;
    const surface = await read(
      rt,
      rt.textures.findIndex((t) => t.name === "diffuse"),
    );
    const pixels = [];
    for (let i = 0; i < surface.length / 4; i++)
      if (Math.floor(surface[i * 4 + 3] / 256) === 5) pixels.push(i);
    if (pixels.length < 100) throw new Error("The test fish was not rendered.");
    const velocity = await read(
      rt,
      rt.textures.findIndex((t) => t.name === "velocity"),
    );
    let pausedMotion = 0;
    for (const i of pixels)
      pausedMotion = Math.max(
        pausedMotion,
        Math.hypot(velocity[i * 2], velocity[i * 2 + 1]),
      );
    if (pausedMotion > 0.00001)
      throw new Error(`Paused fish report motion: ${pausedMotion}`);
    const result = { pixels: pixels.length, pausedMotion };
    for (const enabled of [false, true]) {
      app.settings.ssr = enabled;
      const images = [];
      for (const value of [0, 20]) {
        radiance.value = value;
        await settle();
        images.push(await read(app.post.combined.renderTarget));
      }
      let total = 0,
        maximum = 0,
        affected = 0,
        nonFinite = 0;
      for (const i of pixels) {
        const delta = images[1][i * 4] - images[0][i * 4];
        total += delta;
        maximum = Math.max(maximum, delta);
        if (delta > 0.01) affected++;
        if (!Number.isFinite(delta)) nonFinite++;
      }
      result[enabled ? "ssrOn" : "ssrOff"] = {
        mean: total / pixels.length,
        maximum,
        affected,
        nonFinite,
      };
    }
    if (Math.abs(result.ssrOff.mean) > 0.001 || result.ssrOff.maximum > 0.01)
      throw new Error("Fish changed with SSR disabled.");
    if (
      result.ssrOn.affected < 20 ||
      result.ssrOn.maximum < 0.05 ||
      result.ssrOn.nonFinite
    )
      throw new Error(
        `Fish SSR is missing or invalid: ${JSON.stringify(result)}`,
      );
    // A known translation must produce the matching previous-frame motion,
    // as well as settling to zero above. This catches stale pose buffers.
    const from = new Vector3(0, 2.5, 5).project(app.camera),
      to = new Vector3(0.08, 2.5, 5).project(app.camera);
    fish.instanceMatrix.array[12] = 0.08;
    fish.instanceMatrix.needsUpdate = true;
    await new Promise(requestAnimationFrame);
    app.render();
    const movedSurface = await read(
      rt,
      rt.textures.findIndex((t) => t.name === "diffuse"),
    );
    const movedVelocity = await read(
      rt,
      rt.textures.findIndex((t) => t.name === "velocity"),
    );
    let motion = 0,
      movedPixels = 0;
    for (let i = 0; i < movedSurface.length / 4; i++) {
      if (Math.floor(movedSurface[i * 4 + 3] / 256) !== 5) continue;
      motion += movedVelocity[i * 2];
      movedPixels++;
    }
    result.movingMotion = motion / movedPixels;
    result.expectedMotion = to.x - from.x;
    if (
      movedPixels < 100 ||
      Math.abs(result.movingMotion / result.expectedMotion - 1) > 0.1
    )
      throw new Error(
        `Incorrect moving fish history: ${JSON.stringify(result)}`,
      );
    return { passed: true, ...result };
  } finally {
    app.scene.remove(source);
    source.geometry.dispose();
    material.dispose();
    fish.count = count;
    fish.instanceMatrix.array.set(matrices);
    fish.instanceMatrix.needsUpdate = true;
    app.marine.update = update;
    for (const [mesh, visible] of visibility) mesh.visible = visible;
    Object.assign(app.settings, settings);
    update(before.time, settings);
    app.pause(before.paused);
    app.manual = manual;
    app.post.invalidate();
    app.changed();
  }
}
