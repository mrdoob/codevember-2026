import { RenderPipeline, NoToneMapping, LinearSRGBColorSpace } from 'three/webgpu';
import { pass, uniform, vec3, vec4, screenUV, mix, renderOutput, rtt } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { createAtmosphere } from './atmosphere.js';

export function createPostProcessing(renderer, scene, camera, lighting) {
  const scenePass = pass(scene, camera, { samples: 4 });
  const beauty = scenePass.getTextureNode('output'), depth = scenePass.getTextureNode('depth');
  const occlusion = ao(depth, null, camera); occlusion.resolutionScale = .5; occlusion.radius.value = .35; occlusion.thickness.value = .6; occlusion.samples.value = 16;
  const atmosphere = createAtmosphere(depth, camera, lighting);
  const fog = atmosphere.output;
  const composite = rtt(vec4(beauty.rgb.mul(occlusion.mul(.45).add(.55)).mul(fog.a).add(fog.rgb), 1), null, null, { depthBuffer: false });
  const glow = bloom(composite, .42, .7, .8);
  const vignette = uniform(.42), saturation = uniform(.83);
  const shade = screenUV.sub(.5).length().pow2().mul(vignette).oneMinus();
  const mapped = renderOutput(vec4(composite.rgb.add(glow.rgb).mul(shade), 1), renderer.toneMapping, renderer.outputColorSpace);
  const luminance = mapped.rgb.dot(vec3(.2126, .7152, .0722));
  const color = mix(vec3(luminance), mapped.rgb, saturation);
  const graded = color.mul(.92).add(vec3(.018, .028, .045));
  const pipeline = new RenderPipeline(renderer, vec4(graded.clamp(0, 1), 1)); pipeline.outputColorTransform = false;
  return { pipeline, scenePass, atmosphere, occlusion, composite, glow, vignette, saturation,
    async compile() {
      const toneMapping = renderer.toneMapping, space = renderer.outputColorSpace;
      try { renderer.toneMapping = NoToneMapping; renderer.outputColorSpace = LinearSRGBColorSpace; await scenePass.compileAsync(renderer); }
      finally { renderer.toneMapping = toneMapping; renderer.outputColorSpace = space; }
    },
    render() { pipeline.render(); },
    dispose() { pipeline.dispose(); scenePass.dispose(); atmosphere.dispose(); occlusion.dispose(); composite.dispose(); glow.dispose(); },
  };
}
