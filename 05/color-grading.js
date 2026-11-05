import { Fn, mix, vec3 } from 'three/tsl';

// Grade after tone mapping, in a perceptual working curve. Return linear RGB
// for the final display conversion. The mix makes strength=0 a true bypass.
export function colorGrade(color, { strength, saturation, contrast, shadows, highlights }) {
  return Fn(() => {
    const base = color.clamp(0, 1).toVar();
    const perceptual = base.pow(1 / 2.2).toVar();
    const luma = perceptual.dot(vec3(.2126, .7152, .0722));
    const shadowWeight = luma.smoothstep(.06, .55).oneMinus().mul(shadows);
    const highlightWeight = luma.smoothstep(.45, .95).mul(highlights);
    // Indigo in the shade, restrained honey in the lantern-lit highlights.
    const tint = vec3(1).add(vec3(-.08, .015, .16).mul(shadowWeight))
      .add(vec3(.065, .012, -.09).mul(highlightWeight));
    const tinted = perceptual.mul(tint).toVar();
    const tintedLuma = tinted.dot(vec3(.2126, .7152, .0722));
    // Keep the split tone from becoming an exposure adjustment.
    tinted.mulAssign(luma.div(tintedLuma.max(.00001)));
    const chroma = mix(vec3(luma), tinted, saturation);
    // Mild contrast with a soft toe; retain detail in the blue-hour shadows.
    const shaped = chroma.sub(.35).mul(contrast).add(.35)
      .add(vec3(.008, .010, .015).mul(shadowWeight));
    return mix(base, shaped.clamp(0, 1).pow(2.2), strength);
  })();
}
