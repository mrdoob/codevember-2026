import { Matrix3 } from "three/webgpu";
import {
  Fn,
  If,
  float,
  normalWorldGeometry,
  property,
  texture,
  textureLoad,
  uniform,
  vec2,
  vogelDiskSample,
} from "three/tsl";

export const SHADOW_MAP_SIZE = 2048;
const BLOCKER_SAMPLES = 12,
  FILTER_SAMPLES = 24;

// PCSS: blocker search, average blocker depth, then variable-width PCF.
// https://developer.download.nvidia.com/assets/gamedev/docs/PCSS_Integration.pdf
// An orthographic directional light has linear depth: penumbra radius is
// blocker/receiver separation times the emitter's angular radius.
export function createPCSSFilter(angularRadius) {
  // A shared fragment property lets the ambient term reuse the blocker search.
  // The consumer must evaluate its shadow node before reading this property.
  const contact = property("float");
  const filter = Fn(({ depthTexture, shadowCoord, shadow }, builder) => {
    contact.assign(0);
    const depth = texture(depthTexture);
    const span = shadow.camera.far - shadow.camera.near;
    const width = shadow.camera.right - shadow.camera.left;
    const texel = 1 / SHADOW_MAP_SIZE;
    // A screen derivative fits a different receiver plane to every triangle.
    // On the curved foil that exposes the triangulation as discontinuous shadows.
    // Transform the continuous surface normal into shadow texture space instead.
    const normalMatrix = uniform(new Matrix3()).onRenderUpdate(
      (_frame, self) => {
        self.value.getNormalMatrix(shadow.matrix);
        // ShadowNode flips texture Y after applying the light matrix.
        const e = self.value.elements;
        e[1] *= -1;
        e[4] *= -1;
        e[7] *= -1;
        return self.value;
      },
    );
    const surfaceNormal =
      builder.material.smoothShadowNormalNode || normalWorldGeometry;
    const n = normalMatrix.mul(surfaceNormal).toVar();
    const inverse = n.z.lessThan(0).select(-1, 1).div(n.z.abs().max(0.001));
    const slope = n.xy.mul(inverse.negate()).clamp(-2, 2).toVar();
    const searchRadius = shadowCoord.z
      .mul(span)
      .max(0)
      .min(5)
      .mul(angularRadius)
      .div(width)
      .clamp(texel, 128 * texel)
      .toVar();
    const sum = float(0).toVar(),
      count = float(0).toVar();
    const nearOffsets = [
      vec2(0),
      vec2(texel, 0),
      vec2(-texel, 0),
      vec2(0, texel),
      vec2(0, -texel),
    ];
    // Fixed disk samples avoid the moving screen-space grain of a randomly
    // rotated kernel. Include the center to retain thin contact shadows.
    for (let i = 0; i < BLOCKER_SAMPLES; i++) {
      // Keep five probes within one texel: a broad search alone misses the
      // millimetre-scale grains even when they sit directly on the membrane.
      const offset =
        i < 5
          ? nearOffsets[i]
          : vogelDiskSample(i - 5, BLOCKER_SAMPLES - 5, 0.37).mul(searchRadius);
      const uv = shadowCoord.xy.add(offset).clamp(texel * 0.5, 1 - texel * 0.5);
      const z = textureLoad(depthTexture, uv.mul(SHADOW_MAP_SIZE).toIVec2()).r;
      const planeDepth = offset.dot(slope).clamp(-0.02, 0.02);
      const blocked = z
        .lessThan(shadowCoord.z.add(planeDepth).sub(0.000015))
        .select(1, 0);
      sum.addAssign(z.sub(planeDepth).mul(blocked));
      count.addAssign(blocked);
    }
    const visibility = float(1).toVar();
    If(count.greaterThan(0), () => {
      const separation = shadowCoord.z
        .sub(sum.div(count))
        .max(0)
        .mul(span)
        .toVar();
      // Approximate local ambient occlusion from the light's single depth
      // layer. Only nearby blockers attenuate the environment illumination.
      contact.assign(separation.div(0.08).negate().exp());
      const penumbra = separation
        .mul(angularRadius)
        .div(width)
        .clamp(0.75 * texel, 128 * texel)
        .toVar();
      visibility.assign(0);
      for (let i = 0; i < FILTER_SAMPLES; i++) {
        const offset = vogelDiskSample(i, FILTER_SAMPLES, 1.17).mul(penumbra);
        const uv = shadowCoord.xy
          .add(offset)
          .clamp(texel * 0.5, 1 - texel * 0.5);
        const receiver = shadowCoord.z.add(
          offset.dot(slope).clamp(-0.02, 0.02),
        );
        visibility.addAssign(depth.sample(uv).compare(receiver));
      }
      visibility.divAssign(FILTER_SAMPLES);
    });
    return visibility;
  });
  return { filter, contact };
}
