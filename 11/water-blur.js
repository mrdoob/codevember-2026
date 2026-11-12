import {
  Fn,
  If,
  Loop,
  float,
  vec2,
  vec4,
  uv,
  rtt,
  textureSize,
  perspectiveDepthToViewZ,
} from "three/tsl";

// A dense separable Gaussian: increase the number of covered texels, never
// the spacing between samples. Pair adjacent taps at their weighted bilinear
// positions so fine highlights cannot turn into a repeated comb pattern.
export function createWaterBlur(input, depth, camera, softness) {
  const sigma = softness.mul(4.05).clamp(0.001, 16.2);
  const radius = sigma.mul(3).ceil();
  const viewDepth = (p) =>
    perspectiveDepthToViewZ(
      depth.sample(p).r,
      camera.near,
      camera.far,
    ).negate();
  const filter = (source, axis) =>
    rtt(
      Fn(() => {
        const p = uv(),
          center = source.sample(p).toVar();
        const result = center.rgb.toVar();
        If(softness.greaterThan(0.001), () => {
          const step = axis.div(vec2(textureSize(source)));
          const centerDepth = viewDepth(p).toVar();
          const sum = center.rgb.toVar(),
            total = float(1).toVar();
          const factor = sigma.pow2().mul(-2).reciprocal();
          Loop(
            { start: 0, end: radius.div(2).ceil().toInt(), type: "int" },
            ({ i }) => {
              const first = i.toFloat().mul(2).add(1);
              const second = first.add(1);
              const w1 = first.pow2().mul(factor).exp();
              const w2 = second
                .lessThanEqual(radius)
                .select(second.pow2().mul(factor).exp(), 0);
              const weight = w1.add(w2);
              const offset = step.mul(first.add(w2.div(weight)));
              for (const sign of [-1, 1]) {
                const at = p.add(offset.mul(sign));
                const sampleDepth = viewDepth(at);
                // Separate nearby iron from distant geometry. Empty water remains
                // open to scattering so silhouettes still dissolve into the backdrop.
                const surfaces = centerDepth
                  .lessThan(camera.far * 0.99)
                  .and(sampleDepth.lessThan(camera.far * 0.99));
                const guide = surfaces.select(
                  sampleDepth
                    .sub(centerDepth)
                    .abs()
                    .sub(0.15)
                    .max(0)
                    .mul(4)
                    .pow2()
                    .negate()
                    .exp(),
                  1,
                );
                const w = weight.mul(guide);
                sum.addAssign(source.sample(at).rgb.mul(w));
                total.addAssign(w);
              }
            },
          );
          result.assign(sum.div(total));
        });
        return vec4(result, 1);
      })(),
      null,
      null,
      { depthBuffer: false },
    );
  const horizontal = filter(input, vec2(1, 0));
  const vertical = filter(horizontal, vec2(0, 1));
  return {
    node: vertical,
    dispose() {
      horizontal.dispose();
      vertical.dispose();
    },
  };
}
