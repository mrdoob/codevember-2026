import { RenderPipeline, UnsignedByteType } from "three/webgpu";
import {
  Fn,
  mix,
  pass,
  perspectiveDepthToViewZ,
  reference,
  renderOutput,
  rtt,
  screenUV,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

export function createPostProcessing(
  renderer,
  scene,
  neonScene,
  particleScene,
  camera,
) {
  // Integrate the 32 area emitters on the broad room surfaces at reduced
  // resolution. Tubes and fittings retain full-resolution MSAA silhouettes.
  const roomPass = pass(scene, camera, { samples: 4 });
  roomPass.setResolutionScale(0.5);
  const scenePass = pass(neonScene, camera);
  const particlePass = pass(particleScene, camera);
  const background = roomPass.getTextureNode(),
    foreground = scenePass.getTextureNode();
  // Room columns can cross the sculpture in an orbit view. Compare depths so
  // full-resolution neon does not draw over architecture in front of it.
  const visible = scenePass
    .getViewZNode()
    .greaterThanEqual(roomPass.getViewZNode().sub(0.015));
  const composite = visible.select(
    foreground.rgb.add(background.rgb.mul(foreground.a.oneMinus())),
    background.rgb,
  );
  // Transparent dust does not write depth. Test each fragment against both
  // opaque passes, then add it after their composition so room pixels cannot
  // discard visible particles. Scene depth must use screen UVs, not sprite UVs.
  const particleDepth = roomPass
    .getTextureNode("depth")
    .sample(screenUV)
    .min(scenePass.getTextureNode("depth").sample(screenUV));
  const particleViewZ = perspectiveDepthToViewZ(
    particleDepth,
    reference("near", "float", camera),
    reference("far", "float", camera),
  );
  const beauty = rtt(
    vec4(composite.add(particlePass.getTextureNode().rgb), 1),
    null,
    null,
    { depthBuffer: false },
  );
  const glow = bloom(beauty, 0.45, 0.45, 1);
  const contrast = uniform(1.04),
    saturation = uniform(1);
  const vignette = screenUV
    .sub(vec2(0.58, 0.48))
    .length()
    .smoothstep(0.22, 0.75)
    .mul(0.9)
    .oneMinus();
  const mapped = renderOutput(
    vec4(beauty.rgb.add(glow.rgb).mul(vignette), 1),
    renderer.toneMapping,
    renderer.outputColorSpace,
  );
  const graded = Fn(() => {
    const rgb = mapped.rgb.sub(0.16).mul(contrast).add(0.16);
    const luminance = rgb.dot(vec3(0.2126, 0.7152, 0.0722));
    return vec4(mix(vec3(luminance), rgb, saturation).max(0), 1);
  })();
  const display = rtt(graded, null, null, {
    type: UnsignedByteType,
    depthBuffer: false,
  });
  const pipeline = new RenderPipeline(renderer, fxaa(display));
  pipeline.outputColorTransform = false;
  return {
    scenePass,
    roomPass,
    particlePass,
    particleViewZ,
    pipeline,
    render(settings) {
      glow.strength.value = settings.bloom;
      glow.radius.value = settings.glowRadius;
      contrast.value = settings.contrast;
      saturation.value = settings.saturation;
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      display.dispose();
      glow.dispose();
      beauty.dispose();
      particlePass.dispose();
      scenePass.dispose();
      roomPass.dispose();
    },
  };
}
