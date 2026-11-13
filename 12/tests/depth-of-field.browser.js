import { Scene, PerspectiveCamera, Mesh, InstancedMesh, InstancedBufferAttribute, Matrix4, PlaneGeometry, MeshBasicNodeMaterial, Vector2, Vector3, DataUtils, StandardDrawingPipeline } from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import { createPostProcessing } from '../post-processing.js';

// Isolate feather layers against a high-contrast environment: crisp edges,
// independent near/far filters, environment occlusion, and exact lens bypass.
export async function checkDepthOfField(app = window.feather) {
  const renderer = app.renderer, manual = app.manual, drawingPipeline = renderer.drawingPipeline;
  const size = renderer.getSize(new Vector2()), ratio = renderer.getPixelRatio();
  const standard = new StandardDrawingPipeline();
  const scene = new Scene(), camera = new PerspectiveCamera(40, 4 / 3, .1, 100);
  scene.backgroundNode = vec3(.02, .06, .16);
  camera.position.z = 10; camera.updateMatrixWorld();
  const material = new MeshBasicNodeMaterial(); material.colorNode = uniform(new Vector3(4, 4, 4));
  const geometry = new PlaneGeometry(1.2, 2.4);
  geometry.setAttribute('featherPhase', new InstancedBufferAttribute(new Float32Array([0]), 1));
  const feather = new InstancedMesh(geometry, material, 1);
  feather.setMatrixAt(0, new Matrix4()); feather.frustumCulled = false; scene.add(feather);
  const blurredMaterial = new MeshBasicNodeMaterial(); blurredMaterial.colorNode = vec3(1, .03, .02);
  const blurredGeometry = geometry.clone();
  blurredGeometry.setAttribute('featherPhase', new InstancedBufferAttribute(new Float32Array(2), 1));
  const blurred = new InstancedMesh(blurredGeometry, blurredMaterial, 2);
  const matrix = new Matrix4();
  blurred.setMatrixAt(0, matrix.makeTranslation(.3, 0, 5));
  blurred.setMatrixAt(1, matrix.makeTranslation(-.4, 0, -35));
  blurred.visible = false; blurred.frustumCulled = false; scene.add(blurred);
  const post = createPostProcessing(renderer, scene, camera);
  post.focus.value = 10; post.aperture.value = 6.4; post.glow.strength.value = 0;
  const frame = () => new Promise(requestAnimationFrame);
  const render = async () => { await frame(); post.render(); };
  const read = async target => Float32Array.from(
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height), DataUtils.fromHalfFloat,
  );
  const results = [];
  try {
    app.manual = true; renderer.drawingPipeline = standard;
    renderer.setPixelRatio(2); renderer.setSize(256, 192, false);
    if (post.layers.passes.length !== 4 || post.layers.passes.some(p => p.renderTarget.samples !== 4)) throw new Error('Expected one environment pass and three MSAA feather passes');
    for (const z of [1, 0, -2]) {
      feather.position.z = z; await render();
      const raw = await read(post.scenePass.renderTarget), image = await read(post.lens.renderTarget);
      let pixels = 0, error = 0, edgeError = 0;
      for (let i = 0; i < raw.length; i++) edgeError = Math.max(edgeError, Math.abs(raw[i] - image[i]));
      if (edgeError > .005) throw new Error(`Focused feather leaked at its edge: ${edgeError}`);
      const stride = post.scenePass.renderTarget.width * 4;
      for (let i = stride * 3; i < raw.length - stride * 3; i += 4) if (
        raw[i] > 3.99 && [12, -12, stride * 3, -stride * 3].every(offset => raw[i + offset] > 3.99)
      ) {
        pixels++; error = Math.max(error, Math.abs(raw[i] - image[i]));
      }
      if (pixels < 100 || error > .005) throw new Error(`Clear interval failed at z=${z}: ${pixels}, ${error}`);
      results.push({ z, sharpPixels: pixels, error, edgeError });
    }
    for (const z of [5, -7, -35]) {
      feather.position.z = z; await render();
      const raw = await read(post.scenePass.renderTarget), image = await read(post.lens.renderTarget);
      let softPixels = 0;
      for (let i = 0; i < image.length; i += 4) {
        if (!Number.isFinite(image[i]) || image[i] < 0 || image[i] > 4.01) throw new Error('Invalid lens radiance');
        if (raw[i] < .03 && image[i] > .05) softPixels++;
      }
      if (softPixels < 20) throw new Error(`Missing depth blur at z=${z}: ${softPixels}`);
      results.push({ z, softPixels });
    }
    // Changing a focused object cannot alter either blur source, even when
    // its silhouette overlaps both near and far objects on screen.
    feather.position.z = 0;
    blurred.visible = true; await render();
    const targets = [post.layers.environment.renderTarget, post.depthOfField.nearBlurs[2]._verticalRT, post.depthOfField.farBlurs[2]._verticalRT];
    const original = await Promise.all(targets.map(read));
    material.colorNode.value.set(0, 4, 0); await render();
    let contamination = 0;
    for (let t = 0; t < targets.length; t++) {
      const changed = await read(targets[t]);
      for (let i = 0; i < changed.length; i++) contamination = Math.max(contamination, Math.abs(changed[i] - original[t][i]));
    }
    if (contamination > .001) throw new Error(`Focused color leaked into a blurred layer: ${contamination}`);
    results.push({ contamination });
    material.colorNode.value.setScalar(4); blurred.visible = false;
    // The separate feather layers still respect scene occlusion.
    const occluder = new Mesh(new PlaneGeometry(6, 6), new MeshBasicNodeMaterial());
    occluder.material.colorNode = vec3(.02, .06, .16);
    occluder.position.z = 2; scene.add(occluder);
    await render();
    const hidden = await read(post.layers.focused.renderTarget);
    const hiddenCoverage = hidden.reduce((max, value, i) => i % 4 === 3 ? Math.max(max, value) : max, 0);
    if (hiddenCoverage > .001) throw new Error(`Feathers show through the environment: ${hiddenCoverage}`);
    results.push({ environmentOcclusion: hiddenCoverage });
    scene.remove(occluder); occluder.geometry.dispose(); occluder.material.dispose();
    feather.position.z = 5;
    post.aperture.value = 0; await render();
    const raw = await read(post.scenePass.renderTarget), image = await read(post.lens.renderTarget);
    let bypassError = 0;
    for (let i = 0; i < raw.length; i++) bypassError = Math.max(bypassError, Math.abs(raw[i] - image[i]));
    if (bypassError > .001) throw new Error(`Zero-aperture bypass failed: ${bypassError}`);
    return { passed: results.length + 2, scenePasses: 4, bypassError, results };
  } finally {
    post.dispose(); feather.geometry.dispose(); feather.dispose(); material.dispose();
    blurredGeometry.dispose(); blurredMaterial.dispose(); blurred.dispose();
    renderer.drawingPipeline = drawingPipeline; standard.dispose();
    renderer.setPixelRatio(ratio); renderer.setSize(size.x, size.y);
    await frame(); app.render(); app.manual = manual;
  }
}
