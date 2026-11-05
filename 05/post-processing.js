import { ACESFilmicToneMapping, LinearSRGBColorSpace, NoToneMapping, RenderPipeline, UnsignedByteType, Vector2 } from 'three/webgpu';
import { Fn, Loop, float, pass, uniform, renderOutput, rtt, mix, vec2, vec3, vec4, uv, screenUV, perspectiveDepthToViewZ, toneMapping, toneMappingExposure } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { createFocusVolume } from './focus-volume.js';
import { defocusAmount } from './lens.js';
import { colorGrade } from './color-grading.js';

export function createPostProcessing(renderer, scene, camera, settings, subject, fireflies) {
  // Multisample the geometry pass; the fullscreen effects need only one sample.
  const scenePass = pass(scene, camera, { samples: settings.msaa ? 4 : 0 });
  const beauty = scenePass.getTextureNode('output');
  // Omit the GTAO pass entirely when disabled, including its composite target.
  let occlusion = null, shaded = beauty;
  if (settings.ambientOcclusion) {
    occlusion = ao(scenePass.getTextureNode('depth'), null, camera);
    occlusion.resolutionScale = .5;
    occlusion.radius.value = .12;
    occlusion.thickness.value = .1;
    occlusion.scale.value = 1.1;
    occlusion.samples.value = 16;
    shaded = rtt(vec4(beauty.rgb.mul(occlusion.mul(.65).add(.35)), 1));
  }
  const depthRange = uniform(settings.depthRange), aperture = uniform(settings.aperture);
  const focusVolume = createFocusVolume(subject);
  const focusNear = uniform(1), focusFar = uniform(6);
  const depth = scenePass.getViewZNode().negate();
  // A flat, sharp interval containing all four rocks, followed by a gradual
  // transition into the blurred woodland. Refit its depths on every orbit.
  const outside = depth.sub(focusFar).max(0).sub(focusNear.sub(depth).max(0));
  const inverseSize = uniform(new Vector2());
  const depthTexture = scenePass.getTextureNode('depth');
  const depthAt = at => perspectiveDepthToViewZ(depthTexture.sample(at), camera.near, camera.far).negate();
  // Gather only defocused surfaces on the same side of the focus interval.
  // Otherwise bright, sharp rocks get copied into the blurred background and
  // leave ghost silhouettes around every floating stone.
  const gather = Fn(() => {
    const at = uv(), centerDepth = depthAt(at);
    const foreground = centerDepth.lessThan(focusNear);
    const distance = centerDepth.sub(focusFar).max(0).add(focusNear.sub(centerDepth).max(0));
    const sharp = centerDepth.greaterThanEqual(focusNear).and(centerDepth.lessThanEqual(focusFar));
    const coc = sharp.select(float(1), defocusAmount(distance, depthRange));
    const sum = vec3(0).toVar(), weight = float(0).toVar();
    Loop(64, ({ i }) => {
      const angle = float(i).mul(2.39996323);
      const radius = float(i).add(.5).div(64).sqrt();
      const tapUV = at.add(vec2(angle.cos(), angle.sin()).mul(radius).mul(aperture).mul(coc).mul(inverseSize));
      const tapDepth = depthAt(tapUV);
      const accepted = foreground.select(focusNear.sub(tapDepth), tapDepth.sub(focusFar)).smoothstep(0, .08);
      sum.addAssign(shaded.sample(tapUV).rgb.mul(accepted));
      weight.addAssign(accepted);
    });
    return vec4(weight.greaterThan(.001).select(sum.div(weight.max(.001)), shaded.sample(at).rgb), 1);
  });
  const depthOfField = rtt(gather(), null, null, { resolutionScale: .5, depthBuffer: false });
  const smoothField = gaussianBlur(depthOfField, 1, 2);
  const saturation = uniform(settings.saturation);
  const grading = { strength: uniform(settings.gradeStrength), saturation,
    contrast: uniform(settings.gradeContrast), shadows: uniform(settings.gradeShadows), highlights: uniform(settings.gradeHighlights) };
  const enabled = uniform(settings.depthOfField ? 1 : 0);
  // In the sprite shader UVs belong to each lantern, so depth must explicitly
  // sample the scene at the screen coordinate, not at the sprite's UV.
  const spriteSceneDepth = perspectiveDepthToViewZ(scenePass.getTextureNode('depth').sample(screenUV), camera.near, camera.far).negate();
  fireflies.setLens({ sceneDepth: spriteSceneDepth, focusNear, focusFar, depthRange, aperture, enabled });
  const fireflyPass = pass(fireflies.glowScene, camera, { samples: 0, depthBuffer: false });
  // Fade through the minimum half-resolution blur before the disk grows.
  const blurWeight = defocusAmount(outside.abs(), depthRange).mul(aperture).smoothstep(0, 3).mul(enabled);
  const color = mix(shaded, smoothField, blurWeight).rgb.add(fireflyPass.getTextureNode('output').rgb);
  const vignette = screenUV.sub(.5).length().smoothstep(.3, .8).mul(.16).oneMinus();
  const mapped = toneMapping(ACESFilmicToneMapping, toneMappingExposure, vec4(color.mul(vignette), 1));
  const graded = colorGrade(mapped.rgb, grading);
  // ACES already ran before grading. Only perform the output color-space
  // conversion here, so the grade is not tone mapped a second time.
  const target = rtt(renderOutput(vec4(graded, 1), NoToneMapping), null, null, { type: UnsignedByteType, depthBuffer: false });
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = settings.msaa ? target : fxaa(target);
  return { pipeline, scenePass, outputTarget: target.renderTarget, occlusion, focusNear, focusFar, focusVolume, depthRange, aperture, enabled, saturation, grading,
    async compile() {
      // Match the beauty pass's multisampling, target format, and linear output.
      // Compiling the canvas would build a second set of unused scene shaders.
      const toneMapping = renderer.toneMapping, outputColorSpace = renderer.outputColorSpace;
      try {
        renderer.toneMapping = NoToneMapping;
        renderer.outputColorSpace = LinearSRGBColorSpace;
        await scenePass.compileAsync(renderer);
      } finally {
        renderer.toneMapping = toneMapping;
        renderer.outputColorSpace = outputColorSpace;
      }
    },
    render() {
      renderer.getDrawingBufferSize(inverseSize.value);
      inverseSize.value.set(1 / inverseSize.value.x, 1 / inverseSize.value.y);
      const range = focusVolume.update(camera);
      focusNear.value = range.near; focusFar.value = range.far;
      pipeline.render();
    },
    dispose() {
      pipeline.dispose(); scenePass.dispose(); fireflyPass.dispose(); occlusion?.dispose();
      if (shaded !== beauty) shaded.dispose();
      depthOfField.dispose(); smoothField.dispose(); target.dispose();
    }
  };
}
