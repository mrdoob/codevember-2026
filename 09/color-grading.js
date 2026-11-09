import {
  Fn,
  mix,
  renderOutput,
  screenUV,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

export const COLOR_GRADING_DEFAULTS = Object.freeze({
  exposure: 0.5,
  contrast: 1.25,
  saturation: 1.5,
  warmth: 0,
  tint: 0,
  shadows: 0,
  highlights: 0,
  vignette: 0.22,
});

// Shared by both views, inside their existing final render pass.
export function createColorGrading(renderer, settings) {
  const controls = Object.fromEntries(
    Object.keys(COLOR_GRADING_DEFAULTS)
      .filter((key) => key !== "exposure")
      .map((key) => [key, uniform(settings[key])]),
  );
  const { contrast, saturation, warmth, tint, shadows, highlights, vignette } =
    controls;
  const weights = vec3(0.2126, 0.7152, 0.0722);
  // Artistic warm/cool and green/magenta balance in linear light. Normalize
  // neutral luminance so color balance does not double as exposure.
  const gains = vec3(
    warmth.mul(0.3).add(tint.mul(0.12)),
    tint.mul(-0.24),
    warmth.mul(-0.3).add(tint.mul(0.12)),
  ).exp2();
  const balance = gains.div(gains.dot(weights));
  const falloff = screenUV
    .sub(0.5)
    .length()
    .smoothstep(0.25, 0.8)
    .mul(vignette)
    .oneMinus();
  const grade = Fn(([input]) => {
    const rgb = input.toVar();
    const luminance = rgb.dot(weights).clamp(0, 1).toVar();
    const shadowWeight = luminance.smoothstep(0, 0.65).oneMinus().pow(2);
    const highlightWeight = luminance.smoothstep(0.35, 1).pow(2);
    rgb.addAssign(
      shadowWeight.mul(shadows).add(highlightWeight.mul(highlights)).mul(0.25),
    );
    rgb.assign(rgb.sub(0.18).mul(contrast).add(0.18));
    const gray = rgb.dot(weights);
    return vec4(mix(vec3(gray), rgb, saturation).clamp(0, 1), 1);
  });
  return {
    apply(input) {
      const mapped = renderOutput(
        vec4(input.mul(balance).mul(falloff), 1),
        renderer.toneMapping,
        renderer.outputColorSpace,
      );
      return grade(mapped.rgb);
    },
    update(settings) {
      renderer.toneMappingExposure = settings.exposure;
      for (const [key, node] of Object.entries(controls))
        node.value = settings[key];
    },
  };
}
