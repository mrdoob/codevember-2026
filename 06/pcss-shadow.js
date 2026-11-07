import { Matrix3, Matrix4, Vector2 } from "three/webgpu";
import {
  Fn,
  If,
  float,
  normalWorldGeometry,
  positionWorld,
  vec4,
  texture,
  textureLoad,
  uniform,
  vec2,
  vogelDiskSample,
  interleavedGradientNoise,
  screenCoordinate,
} from "three/tsl";

export const SHADOW_MAP_SIZE = 2048;
const BLOCKER_SAMPLES = 4,
  FILTER_SAMPLES = 8;

// Perspective PCSS for the window projector. Blocker separation is measured
// in light-view space, not in the non-linear shadow depth buffer.
export function createPCSSFilter(emitterRadius) {
  const frame = uniform(0).onFrameUpdate(({ frameId }) => frameId % 64);
  const filter = Fn(({ depthTexture, shadowCoord, shadow }, builder) => {
    const radius = builder.material.userData.paper
      ? emitterRadius.mul(6)
      : emitterRadius;
    const camera = shadow.camera,
      near = camera.near,
      far = camera.far;
    const view = uniform(new Matrix4()).onRenderUpdate((_frame, self) =>
      self.value.copy(camera.matrixWorldInverse),
    );
    const normalMatrix = uniform(new Matrix3()).onRenderUpdate(
      (_frame, self) => self.value.getNormalMatrix(camera.matrixWorldInverse),
    );
    const projection = uniform(new Vector2()).onRenderUpdate((_frame, self) =>
      self.value.set(
        camera.projectionMatrix.elements[0],
        camera.projectionMatrix.elements[5],
      ),
    );
    const n = normalMatrix
      .mul(builder.material.smoothShadowNormalNode || normalWorldGeometry)
      .toVar();
    const p = view.mul(vec4(positionWorld, 1)).xyz.toVar();
    const denominator = n.dot(p).toVar();
    const safeDenominator = denominator
      .abs()
      .max(0.001)
      .mul(denominator.lessThan(0).select(-1, 1));
    // A smooth normal defines the receiving plane in projective depth. This
    // avoids triangle-shaped penumbra discontinuities on rounded metal.
    const slope = n.xy
      .mul(vec2(2, -2))
      .div(projection)
      .mul((-near * far) / (far - near))
      .div(safeDenominator)
      .clamp(-1, 1)
      .toVar();
    const linearDepth = (z) =>
      float(near * far).div(float(far).sub(z.mul(far - near)));
    const receiver = linearDepth(shadowCoord.z).toVar();
    const uvPerUnit = projection.mul(0.5).div(receiver);
    const texel = 1 / SHADOW_MAP_SIZE;
    const searchSeparation = receiver.sub(near).min(30);
    const searchRadius = uvPerUnit
      .mul(radius)
      .mul(searchSeparation)
      .div(receiver.sub(searchSeparation).max(near))
      .clamp(texel, 128 * texel)
      .toVar();
    const sum = float(0).toVar(),
      count = float(0).toVar();
    const rotation = interleavedGradientNoise(
      screenCoordinate.add(frame.mul(5.588238)),
    )
      .mul(Math.PI * 2)
      .toVar();
    for (let i = 0; i < BLOCKER_SAMPLES; i++) {
      const offset =
        i === 0
          ? vec2(0)
          : vogelDiskSample(i - 1, BLOCKER_SAMPLES - 1, rotation).mul(
              searchRadius,
            );
      const sampleUV = shadowCoord.xy
        .add(offset)
        .clamp(texel * 0.5, 1 - texel * 0.5);
      const z = textureLoad(
        depthTexture,
        sampleUV.mul(SHADOW_MAP_SIZE).toIVec2(),
      ).r;
      const planeDepth = offset.dot(slope).clamp(-0.002, 0.002);
      const blocked = z
        .lessThan(shadowCoord.z.add(planeDepth).sub(0.00001))
        .select(1, 0);
      sum.addAssign(linearDepth(z.sub(planeDepth)).mul(blocked));
      count.addAssign(blocked);
    }
    const visibility = float(1).toVar();
    If(count.greaterThan(0), () => {
      const blocker = sum.div(count).max(near).toVar();
      const penumbra = uvPerUnit
        .mul(radius)
        .mul(receiver.sub(blocker).max(0))
        .div(blocker)
        .clamp(0.75 * texel, 128 * texel)
        .toVar();
      visibility.assign(0);
      for (let i = 0; i < FILTER_SAMPLES; i++) {
        const offset = vogelDiskSample(i, FILTER_SAMPLES, rotation).mul(
          penumbra,
        );
        const sampleUV = shadowCoord.xy
          .add(offset)
          .clamp(texel * 0.5, 1 - texel * 0.5);
        visibility.addAssign(
          texture(depthTexture)
            .sample(sampleUV)
            .compare(
              shadowCoord.z.add(offset.dot(slope).clamp(-0.002, 0.002)),
            ),
        );
      }
      visibility.divAssign(FILTER_SAMPLES);
    });
    return visibility;
  });
  return { filter };
}
