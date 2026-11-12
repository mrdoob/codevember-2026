import { RenderPipeline, Color } from "three/webgpu";
import {
  pass,
  mrt,
  output,
  normalView,
  vec3,
  vec4,
  screenUV,
  uniform,
  mix,
  renderOutput,
  rtt,
} from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { denoise } from "three/addons/tsl/display/DenoiseNode.js";
import { createWaterBlur } from "./water-blur.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";

export function createPostProcessing(
  renderer,
  scene,
  camera,
  dustScene,
  atmosphere,
  bubbleScene,
) {
  const scenePass = pass(scene, camera);
  // Pack the optical distance alongside the normal so it uses each surface's world
  // position without another render target or depth reconstruction.
  scenePass.setMRT(
    mrt({ output, normal: vec4(normalView, atmosphere.fogDistance) }),
  );
  const beauty = scenePass.getTextureNode("output");
  const depth = scenePass.getTextureNode("depth"),
    normals = scenePass.getTextureNode("normal");
  const occlusion = ao(depth, normals, camera);
  occlusion.radius.value = 0.5;
  occlusion.thickness.value = 0.35;
  occlusion.samples.value = 32;
  occlusion.resolutionScale = 0.75;
  const smooth = denoise(occlusion.getTextureNode(), {
    depth,
    normal: normals,
    camera,
  });
  const strength = uniform(4),
    vignette = uniform(0.55),
    saturation = uniform(1),
    temperature = uniform(0),
    tint = uniform(0),
    contrast = uniform(1),
    lift = uniform(0),
    shadows = uniform(new Color("#ffffff"));
  const lit = beauty.rgb.mul(smooth.r.clamp(0.08, 1).pow(strength));
  // Occlude the metal before adding the water's light. Multiplying GTAO after
  // fog would leave dark outlines on surfaces that should disappear into it.
  const fog = atmosphere.fogAmount(normals.a);
  const underwater = mix(lit, atmosphere.waterBackground, fog);
  const fogBlur = uniform(1.2);
  // Bubble highlights stay additive and outside GTAO, but contribute their
  // fog-dependent scattering to the same blur as the mine and chain.
  const bubblePass = pass(bubbleScene, camera);
  const bubbleScatter = atmosphere.fogAmount(atmosphere.fogDistance).pow(1.5);
  const bubbleMRT = mrt({
    output,
    scattering: vec4(output.rgb.mul(bubbleScatter), output.a),
  });
  bubbleMRT.setBlendMode("scattering", bubbleMRT.getBlendMode("output"));
  bubbleMRT.setClearColor("output", 0x000000, 0);
  bubbleMRT.setClearColor("scattering", 0x000000, 0);
  bubblePass.setMRT(bubbleMRT);
  // Split the surviving light into direct and scattered components. Blur only
  // the scattered difference from the background, then add it back. A fogged
  // silhouette can spread into empty water without blurring the background
  // itself or being clipped to the original depth mask.
  const scattered = lit
    .sub(atmosphere.waterBackground)
    .mul(fog.oneMinus())
    .mul(fog.pow(1.5));
  const water = rtt(
    vec4(scattered.add(bubblePass.getTextureNode("scattering").rgb), 1),
    null,
    null,
    { depthBuffer: false },
  );
  const waterBlur = createWaterBlur(water, depth, camera, fogBlur);
  const softened = underwater.sub(water.rgb).add(waterBlur.node.rgb);
  const dustPass = pass(dustScene, camera);
  const composite = rtt(
    vec4(
      softened
        .add(bubblePass.getTextureNode().rgb)
        .add(dustPass.getTextureNode().rgb),
      1,
    ),
    null,
    null,
    { depthBuffer: false },
  );
  const shade = screenUV.sub(0.5).length().pow2().mul(vignette).oneMinus();
  const balance = vec3(
    temperature.mul(0.25).add(1),
    tint.mul(-0.2).add(1),
    temperature.mul(-0.25).add(1),
  );
  const balanced = composite.rgb.mul(shade).mul(balance);
  const luminance = balanced.dot(vec3(0.2126, 0.7152, 0.0722));
  const shadowTinted = balanced.mul(
    mix(vec3(1), shadows, luminance.smoothstep(0.02, 0.3).oneMinus()),
  );
  const mapped = renderOutput(
    vec4(shadowTinted, 1),
    renderer.toneMapping,
    renderer.outputColorSpace,
  );
  const rgb = mix(
    vec3(mapped.rgb.dot(vec3(0.2126, 0.7152, 0.0722))),
    mapped.rgb,
    saturation,
  )
    .sub(0.5)
    .mul(contrast)
    .add(0.5)
    .add(lift)
    .clamp(0, 1);
  const pipeline = new RenderPipeline(renderer, smaa(vec4(rgb, 1)));
  pipeline.outputColorTransform = false;
  return {
    pipeline,
    scenePass,
    occlusion,
    composite,
    dustDepth: scenePass.getViewZNode(),
    particlesPass: dustPass,
    bubblesPass: bubblePass,
    strength,
    vignette,
    saturation,
    temperature,
    tint,
    contrast,
    lift,
    shadows,
    fogBlur,
    render() {
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      dustPass.dispose();
      bubblePass.dispose();
      composite.dispose();
      water.dispose();
      waterBlur.dispose();
      scenePass.dispose();
      occlusion.dispose();
      smooth.dispose();
    },
  };
}
