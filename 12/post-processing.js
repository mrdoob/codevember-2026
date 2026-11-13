import { RenderPipeline, NoToneMapping, LinearSRGBColorSpace } from 'three/webgpu';
import { uniform, vec3, vec4, screenUV, mix, renderOutput } from 'three/tsl';
import { createDepthOfField } from './depth-of-field.js';
import { createSceneLayers } from './scene-layers.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { CAMERA } from './scene-constants.js';

export function createPostProcessing(renderer, scene, camera) {
  const focus = uniform(CAMERA.radius), aperture = uniform(2.5), focusRange = uniform(4.5);
  const layers = createSceneLayers(scene, camera, focus, focusRange);
  const depthOfField = createDepthOfField(layers, focus, aperture);
  const scenePass = depthOfField.raw;
  const lens = depthOfField.lens;
  const glow = bloom(lens, .16, .5, 1.05);
  const vignette = uniform(.3), saturation = uniform(.96);
  const shade = screenUV.sub(.5).length().pow2().mul(vignette).oneMinus();
  const hdr = lens.rgb.add(glow.rgb).mul(shade);
  const mapped = renderOutput(vec4(hdr, 1), renderer.toneMapping, renderer.outputColorSpace);
  const luminance = mapped.rgb.dot(vec3(.2126, .7152, .0722));
  const graded = mix(vec3(luminance), mapped.rgb, saturation).sub(.4).mul(1.1).add(.4).clamp(0, 1);
  const pipeline = new RenderPipeline(renderer, vec4(graded, 1));
  pipeline.outputColorTransform = false;
  return { scenePass, layers, pipeline, focus, aperture, focusRange, depthOfField, lens, glow, vignette, saturation,
    async compile() {
      const toneMapping = renderer.toneMapping, colorSpace = renderer.outputColorSpace;
      try {
        renderer.toneMapping = NoToneMapping; renderer.outputColorSpace = LinearSRGBColorSpace;
        layers.update();
        const mask = camera.layers.mask, background = scene.background, backgroundNode = scene.backgroundNode;
        const drawingPipeline = renderer.drawingPipeline;
        try {
          for (const layer of layers.passes) {
            camera.layers.mask = layer.getLayers().mask;
            if (layer !== layers.environment) {
              scene.background = null; scene.backgroundNode = null;
              renderer.drawingPipeline = layer.drawingPipeline;
            }
            await layer.compileAsync(renderer);
          }
        } finally {
          camera.layers.mask = mask; scene.background = background; scene.backgroundNode = backgroundNode;
          renderer.drawingPipeline = drawingPipeline;
        }
      } finally { renderer.toneMapping = toneMapping; renderer.outputColorSpace = colorSpace; }
    },
    render() { layers.update(); pipeline.render(); },
    dispose() { pipeline.dispose(); layers.dispose(); depthOfField.dispose(); glow.dispose(); },
  };
}
