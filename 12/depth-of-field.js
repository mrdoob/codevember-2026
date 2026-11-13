import { mix, rtt, uniform, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

export function createDepthOfField(layers, focus, aperture) {
  const environmentBlur = uniform(1);
  const environment = layers.environment.getTextureNode();
  const sharp = layers.focused.getTextureNode();
  const depth = layers.environment.getViewZNode().negate();
  const soft = gaussianBlur(environment, aperture.mul(.12), 3, { resolutionScale: .5 });
  const distant = gaussianBlur(environment, aperture.mul(.36), 5, { resolutionScale: .5 });
  const coc = depth.sub(focus).smoothstep(0, 28);
  const blurredEnvironment = mix(mix(environment, soft, coc.smoothstep(0, .3)), distant, coc.smoothstep(.15, 1));
  const filter = (inputs, strength = 1) => [
    inputs[0],
    gaussianBlur(inputs[1], aperture.mul(.1 * strength), 4, { resolutionScale: .5 }),
    gaussianBlur(inputs[2], aperture.mul(.25 * strength), 6, { resolutionScale: .5 }),
  ];
  // MSAA already premultiplied radiance by coverage. Blur color and alpha
  // together, then composite once; never blur the focused feather image.
  const farBlurs = filter(layers.farInputs, .42), nearBlurs = filter(layers.nearInputs);
  const sum = inputs => inputs[0].add(inputs[1]).add(inputs[2]);
  const over = (top, bottom) => top.rgb.add(bottom.mul(top.a.oneMinus().clamp(0, 1)));
  const composite = (far, near, back) => over(near, over(sharp, over(far, back)));
  const raw = rtt(vec4(composite(sum(layers.farInputs), sum(layers.nearInputs), environment.rgb), 1), null, null, { depthBuffer: false });
  const filtered = composite(sum(farBlurs), sum(nearBlurs), mix(environment.rgb, blurredEnvironment.rgb, environmentBlur));
  const lens = rtt(vec4(mix(raw.rgb, filtered, aperture.smoothstep(0, .05)), 1), null, null, { depthBuffer: false });
  return {
    lens, raw, farBlurs, nearBlurs, environmentBlur, environmentBlurs: [soft, distant],
    dispose() { lens.dispose(); raw.dispose(); for (const blur of [soft, distant, ...farBlurs.slice(1), ...nearBlurs.slice(1)]) blur.dispose(); },
  };
}
