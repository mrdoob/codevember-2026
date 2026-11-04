import { RenderPipeline, UnsignedByteType } from 'three/webgpu';
import { Fn, vec3, vec4, mix, pass, uniform, renderOutput, rtt } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

export function createPostProcessing(renderer, scene, camera, initialGrade = {}) {
  const grading = {
    temperature: uniform(initialGrade.temperature ?? 0), tint: uniform(initialGrade.tint ?? 0),
    saturation: uniform(initialGrade.saturation ?? 1), contrast: uniform(initialGrade.contrast ?? 1)
  };
  const grade = source => Fn(() => {
    const balance = vec3(.3, 0, -.3).mul(grading.temperature)
      .add(vec3(.12, -.24, .12).mul(grading.tint)).exp2();
    const balanced = source.rgb.mul(balance).toVar();
    const luminance = balanced.dot(vec3(.2126, .7152, .0722));
    const saturated = mix(vec3(luminance), balanced, grading.saturation).max(0);
    return vec4(saturated.div(.18).pow(grading.contrast).mul(.18), source.a);
  })();
  // Grade the HDR scene before tone mapping, then antialias the display color.
  const scenePass = pass(scene, camera, { samples: 0 });
  const beauty = scenePass.getTextureNode('output');
  const colorTarget = rtt(renderOutput(grade(beauty)), null, null, { type: UnsignedByteType, depthBuffer: false });
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = fxaa(colorTarget);
  return {
    pipeline, scenePass, grading,
    render() { pipeline.render(); },
    dispose() { pipeline.dispose(); scenePass.dispose(); colorTarget.dispose(); }
  };
}
