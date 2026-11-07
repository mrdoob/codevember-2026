import { RenderPipeline, Vector3 } from "three/webgpu";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import {
  Fn,
  mix,
  pass,
  perspectiveDepthToViewZ,
  renderOutput,
  rtt,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

const NEAR_FOCUS_RANGE = 2;
const FAR_FOCUS_RANGE = 2.6;
const NEAR_BLUR_RADIUS = 14;
const FAR_BLUR_RADIUS = 26;
const FILTER_RADIUS = 26; // Gaussian sigma 12 produces a 26-pixel radius.

export function createDepthOfField(renderer, scene, camera) {
  const scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode(),
    depth = scenePass.getTextureNode("depth");
  const focus = uniform(8),
    nearBlur = uniform(NEAR_BLUR_RADIUS),
    farBlur = uniform(FAR_BLUR_RADIUS),
    enabled = uniform(1);
  const near = uniform(camera.near),
    far = uniform(camera.far);
  const balance = uniform(new Vector3(1, 1, 1)),
    contrast = uniform(1),
    saturation = uniform(1);
  const distance = perspectiveDepthToViewZ(depth.r, near, far).negate();
  // Keep a wider sharp band around the revealed object, with extra room
  // behind the focus plane so the open shell's interior remains readable.
  const nearCoC = focus
    .sub(distance)
    .sub(NEAR_FOCUS_RANGE)
    .max(0)
    .smoothstep(0, 2.2)
    .mul(enabled);
  const farCoC = distance
    .sub(focus)
    .sub(FAR_FOCUS_RANGE)
    .max(0)
    .smoothstep(0, 1.8)
    .mul(depth.r.lessThan(0.99999))
    .mul(enabled);

  // Premultiply each field by its own coverage before filtering. Unmasked
  // beauty would leak sharp objects into both blurred depth layers.
  const nearInput = rtt(vec4(beauty.rgb.mul(nearCoC), nearCoC), null, null, {
    depthBuffer: false,
  });
  const farInput = rtt(vec4(beauty.rgb.mul(farCoC), farCoC), null, null, {
    depthBuffer: false,
  });
  const nearFiltered = gaussianBlur(nearInput, nearBlur.div(FILTER_RADIUS), 12);
  const farFiltered = gaussianBlur(farInput, farBlur.div(FILTER_RADIUS), 12);
  const lens = Fn(() => {
    const nearField = nearFiltered.toVar(),
      farField = farFiltered.toVar();
    const nearColor = nearField.rgb.div(nearField.a.max(0.00001));
    const farColor = farField.rgb.div(farField.a.max(0.00001));
    // Expand blur coverage across the silhouette instead of leaving a crisp
    // copy of the foreground underneath a softened edge.
    const nearCoverage = nearCoC
      .max(nearField.a.mul(2).sub(nearCoC))
      .clamp(0, 1);
    const farCoverage = farCoC
      .max(farField.a.mul(2).sub(farCoC))
      .clamp(0, 1)
      .mul(
        distance.sub(focus).smoothstep(FAR_FOCUS_RANGE - 0.3, FAR_FOCUS_RANGE),
      );
    const background = mix(beauty.rgb, farColor, farCoverage);
    return vec4(mix(background, nearColor, nearCoverage), beauty.a);
  })();

  // White balance in linear HDR; contrast and saturation after tone mapping.
  const mapped = renderOutput(
    vec4(lens.rgb.mul(balance), lens.a),
    renderer.toneMapping,
    renderer.outputColorSpace,
  );
  const graded = Fn(() => {
    const rgb = mapped.rgb.sub(0.4).mul(contrast).add(0.4);
    const luminance = rgb.dot(vec3(0.2126, 0.7152, 0.0722));
    return vec4(mix(vec3(luminance), rgb, saturation).clamp(0, 1), mapped.a);
  })();
  const pipeline = new RenderPipeline(renderer, graded);
  pipeline.outputColorTransform = false;

  return {
    scenePass,
    focus,
    render(settings, focusDistance) {
      focus.value = focusDistance;
      const strength = settings.depthOfField
        ? settings.lensBlur * renderer.getPixelRatio()
        : 0;
      nearBlur.value = NEAR_BLUR_RADIUS * strength;
      enabled.value = strength > 0 ? 1 : 0;
      farBlur.value = FAR_BLUR_RADIUS * strength;
      near.value = camera.near;
      far.value = camera.far;
      const warmth = settings.warmth,
        tint = settings.tint;
      balance.value.set(
        2 ** (warmth * 0.3 + tint * 0.1),
        2 ** (-tint * 0.18),
        2 ** (-warmth * 0.3 + tint * 0.1),
      );
      contrast.value = settings.contrast;
      saturation.value = settings.saturation;
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      nearFiltered.dispose();
      farFiltered.dispose();
      nearInput.dispose();
      farInput.dispose();
      scenePass.dispose();
    },
  };
}
