// Browser regression check: inspect the actual depth map with grain casting
// disabled, with default back-face shadows, and with the billboard fix.
// await (await import('./tests/sprite-shadow-check.js')).checkSpriteShadows(membrane)
export async function checkSpriteShadows(app) {
  const { renderer, speaker, simulation, scene } = app,
    device = renderer.backend.device;
  const light = scene.children.find(
      (o) => o.isDirectionalLight && o.castShadow,
    ),
    sand = speaker.sand;
  const saved = {
    manual: app.manual,
    castShadow: sand.castShadow,
    shadowSide: sand.material.shadowSide,
    view: app.settings.view,
    grains: app.settings.grains,
  };
  const allocated = [];
  const canvas = renderer.domElement,
    copy = new OffscreenCanvas(canvas.width, canvas.height);
  const context = copy.getContext("2d", { willReadFrequently: true });
  app.manual = true;
  try {
    await simulation.gpu.idle();
    app.setParticles(true, { immediate: true });
    app.setView("sand", { immediate: true });
    app.render();
    const texture = renderer.backend.get(light.shadow.map.depthTexture).texture;
    const width = texture.width,
      height = texture.height,
      size = width * height * 4;
    const output = device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const staging = device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    allocated.push(output, staging);
    const module = device.createShaderModule({
      code: `
      @group(0) @binding(0) var depth:texture_depth_2d;
      @group(0) @binding(1) var<storage,read_write> result:array<f32>;
      @compute @workgroup_size(8,8)
      fn main(@builtin(global_invocation_id) id:vec3u){
        let dimensions=textureDimensions(depth);
        if(any(id.xy>=dimensions)){return;}
        result[id.y*dimensions.x+id.x]=textureLoad(depth,vec2i(id.xy),0);
      }`,
    });
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: { buffer: output } },
      ],
    });
    async function capture(castShadow, shadowSide) {
      sand.castShadow = castShadow;
      sand.material.shadowSide = shadowSide;
      // ShadowNode updates once per animation frame, even for explicit renders.
      await new Promise(requestAnimationFrame);
      app.render();
      // Copy before yielding: WebGPU's presentation texture is transient.
      context.drawImage(canvas, 0, 0);
      const image = context.getImageData(0, 0, copy.width, copy.height).data;
      const encoder = device.createCommandEncoder(),
        pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      encoder.copyBufferToBuffer(output, 0, staging, 0, size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const result = new Float32Array(staging.getMappedRange()).slice();
      staging.unmap();
      return { depth: result, image };
    }
    const absent = await capture(false, 0),
      culled = await capture(true, null),
      correct = await capture(true, 0);
    let legacyChanged = 0,
      shadowTexels = 0,
      closerTexels = 0,
      darkenedPixels = 0;
    for (let i = 0; i < absent.depth.length; i++) {
      if (Math.abs(culled.depth[i] - absent.depth[i]) > 1e-7) legacyChanged++;
      if (Math.abs(correct.depth[i] - absent.depth[i]) > 1e-7) shadowTexels++;
      if (correct.depth[i] < absent.depth[i] - 1e-7) closerTexels++;
    }
    for (let i = 0; i < absent.image.length; i += 4) {
      const difference =
        absent.image[i] +
        absent.image[i + 1] +
        absent.image[i + 2] -
        correct.image[i] -
        correct.image[i + 1] -
        correct.image[i + 2];
      if (difference > 3) darkenedPixels++;
    }
    if (darkenedPixels < 1000)
      throw new Error(
        `Grain shadows did not reach the rendered scene: ${darkenedPixels} darkened pixels.`,
      );
    if (
      legacyChanged !== 0 ||
      shadowTexels < 1000 ||
      closerTexels !== shadowTexels
    )
      throw new Error(
        `Unexpected sprite shadow coverage: ${JSON.stringify({ legacyChanged, shadowTexels, closerTexels })}`,
      );
    return {
      pass: true,
      grainCount: simulation.grainCount,
      legacyChanged,
      shadowTexels,
      closerTexels,
      darkenedPixels,
    };
  } finally {
    allocated.forEach((b) => b.destroy());
    sand.castShadow = saved.castShadow;
    sand.material.shadowSide = saved.shadowSide;
    app.setParticles(saved.grains, { immediate: true });
    app.setView(saved.view, { immediate: true });
    await new Promise(requestAnimationFrame);
    app.render();
    app.manual = saved.manual;
  }
}
