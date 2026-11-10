import {
  DataUtils,
  DoubleSide,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Ray,
  Sphere,
  Vector3,
} from "three/webgpu";
import { uniform, vec3 } from "three/tsl";

// Read final glass pixels hit by analytically reflected camera rays. Freeze
// the probe to distinguish SSR from refraction and environment reflections.
export async function checkCrystalReflections(app = window.caustic) {
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const saved = { ...app.settings },
    before = app.inspect(),
    manual = app.manual;
  const capture = app.crystal.reflect;
  const radiance = uniform(0);
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.colorNode = vec3(radiance, 0, 0);
  const marker = new Mesh(new PlaneGeometry(2.4, 2.8), material);
  marker.name = "Crystal reflection test source";
  const settle = async () => {
    app.changed();
    app.post.invalidate();
    for (let i = 0; i < 16; i++) {
      await new Promise(requestAnimationFrame);
      app.render();
    }
  };
  const read = async (target, attachment = 0) =>
    Float32Array.from(
      await app.renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        target.width,
        target.height,
        attachment,
      ),
      DataUtils.fromHalfFloat,
    );
  const pixels = async () => {
    const rt = app.post.scenePass.renderTarget;
    const surfaces = await read(
      rt,
      rt.textures.findIndex((t) => t.name === "diffuse"),
    );
    const sphere = new Sphere(app.crystal.mesh.position.clone(), 1.85);
    const ray = new Ray(),
      entry = new Vector3(),
      normal = new Vector3(),
      local = new Vector3();
    const inverse = marker.matrixWorld.clone().invert();
    const result = [];
    for (let y = 0; y < rt.height; y += 2)
      for (let x = 0; x < rt.width; x += 2) {
        const index = y * rt.width + x;
        if (Math.floor(surfaces[index * 4 + 3] / 256) !== 2) continue;
        ray.origin.copy(app.camera.position);
        ray.direction
          .set(
            ((x + 0.5) / rt.width) * 2 - 1,
            1 - ((y + 0.5) / rt.height) * 2,
            0.5,
          )
          .unproject(app.camera)
          .sub(ray.origin)
          .normalize();
        if (!ray.intersectSphere(sphere, entry)) continue;
        normal.copy(entry).sub(sphere.center).normalize();
        ray.origin.copy(entry);
        ray.direction.reflect(normal);
        ray.applyMatrix4(inverse);
        const distance = -ray.origin.z / ray.direction.z;
        if (distance <= 0) continue;
        ray.at(distance, local);
        // Stay away from source edges and their denoising footprint.
        if (Math.abs(local.x) < 0.65 && Math.abs(local.y) < 0.8)
          result.push(index);
      }
    assert(
      result.length > 30,
      "Run the crystal check from the wide camera view.",
    );
    return result;
  };
  const response = async (selected) => {
    const values = [];
    for (const value of [0, 12]) {
      radiance.value = value;
      await settle();
      const image = await read(app.post.combined.renderTarget);
      values.push(
        selected.reduce((sum, index) => sum + image[index * 4], 0) /
          selected.length,
      );
    }
    return {
      dark: values[0],
      bright: values[1],
      change: values[1] - values[0],
    };
  };
  try {
    app.manual = true;
    app.pause(true);
    Object.assign(app.settings, {
      haze: 0,
      bloom: 0,
      fish: false,
      algae: false,
      crystalReflections: true,
    });
    // Keep the source visible between the front columns of the single ring.
    marker.position.set(5, app.crystal.mesh.position.y, 3.4);
    // Both the camera and the sphere see this face; SSR rejects backfaces.
    marker.lookAt(new Vector3(0, marker.position.y, marker.position.z));
    app.scene.add(marker);
    await settle();
    const visiblePixels = await pixels();
    app.crystal.reflect = () => {};
    app.settings.ssr = false;
    const control = await response(visiblePixels);
    app.settings.ssr = true;
    const screenSpace = await response(visiblePixels);
    assert(
      Math.abs(control.change) < 0.01,
      "Frozen glass changed without SSR.",
    );
    assert(
      screenSpace.change > 0.15,
      `The visible source does not reflect in the final glass composite: ${JSON.stringify({ control, screenSpace, pixels: visiblePixels.length })}`,
    );
    app.settings.crystalReflections = false;
    const disabled = await response(visiblePixels);
    assert(
      Math.abs(disabled.change) < 0.01,
      "Crystal reflection switch leaves an SSR contribution behind.",
    );

    app.crystal.reflect = capture;
    app.settings.crystalReflections = true;
    app.settings.ssr = false;
    marker.position
      .copy(app.camera.position)
      .add(
        app.camera.position.clone().sub(app.crystal.mesh.position).normalize(),
      );
    // Keep the hidden source's angular size when the overview camera is farther
    // away, so its reflection still covers enough pixels for a reliable reading.
    marker.scale.setScalar(
      marker.position.distanceTo(app.crystal.mesh.position) / 9,
    );
    marker.lookAt(app.crystal.mesh.position);
    await settle();
    const hiddenPixels = await pixels();
    const offscreen = await response(hiddenPixels);
    assert(
      offscreen.change > 0.15,
      "An offscreen source is missing from the cube reflection fallback.",
    );
    return {
      passed: true,
      visiblePixels: visiblePixels.length,
      hiddenPixels: hiddenPixels.length,
      control,
      screenSpace,
      disabled,
      offscreen,
    };
  } finally {
    app.crystal.reflect = capture;
    app.scene.remove(marker);
    marker.geometry.dispose();
    material.dispose();
    Object.assign(app.settings, saved);
    app.manual = manual;
    app.pause(before.paused);
    app.post.invalidate();
    app.changed();
  }
}
