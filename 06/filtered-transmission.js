import { PhysicalLightingModel } from "three/webgpu";
import {
  EnvironmentBRDF,
  Fn,
  If,
  Loop,
  attenuationColor,
  attenuationDistance,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraViewport,
  diffuseColor,
  diffuseContribution,
  dispersion,
  ior,
  mix,
  modelWorldMatrix,
  normalWorld,
  positionWorld,
  refract,
  roughness,
  screenSize,
  specularColorBlended,
  specularF90,
  textureBicubicLevel,
  thickness,
  transmission,
  vec2,
  vec3,
  vec4,
  viewportOpaqueMipTexture,
} from "three/tsl";

// Adapted from three.js PhysicalLightingModel (MIT, a70ee1a). Retain its
// refraction, dispersion, absorption and Fresnel; only the sampling LOD changes.
const opaque = viewportOpaqueMipTexture();
const volumeRay = Fn(
  ([n, v, depth, eta, matrix]) => {
    const scale = vec3(
      matrix[0].xyz.length(),
      matrix[1].xyz.length(),
      matrix[2].xyz.length(),
    );
    return refract(v.negate(), n.normalize(), eta.reciprocal())
      .normalize()
      .mul(depth.mul(scale));
  },
  {
    n: "vec3",
    v: "vec3",
    depth: "float",
    eta: "float",
    matrix: "mat4",
    return: "vec3",
  },
);
const attenuation = Fn(
  ([distance, tint, falloff]) => {
    If(falloff.notEqual(0), () => {
      return tint.log().div(falloff).mul(distance).exp();
    });
    return vec3(1);
  },
  { distance: "float", tint: "vec3", falloff: "float", return: "vec3" },
);

export class FilteredTransmissionLightingModel extends PhysicalLightingModel {
  constructor(material, minimumMip) {
    super(
      material.useClearcoat,
      material.useSheen,
      material.useIridescence,
      material.useAnisotropy,
      material.useTransmission,
      material.useDispersion,
      material.useRetroreflection,
      material.useDiffuseRoughness,
    );
    this.minimumMip = minimumMip;
  }

  start(builder) {
    // Use the stock lighting setup, supplying its transmission backdrop below.
    const transmitting = this.transmission;
    this.transmission = false;
    try {
      super.start(builder);
    } finally {
      this.transmission = transmitting;
    }
    if (!transmitting) return;

    const minimumMip = this.minimumMip;
    const spectral = this.dispersion;
    const backdrop = Fn(() => {
      const n = normalWorld,
        v = cameraPosition.sub(positionWorld).normalize();
      const sample = (eta) => {
        const ray = volumeRay(n, v, thickness, eta, modelWorldMatrix);
        const exit = positionWorld.add(ray);
        const ndc = cameraProjectionMatrix.mul(
          cameraViewMatrix.mul(vec4(exit, 1)),
        );
        const uv = ndc.xy.div(ndc.w).mul(0.5).add(0.5);
        const coords = vec2(uv.x, uv.y.oneMinus())
          .mul(cameraViewport.zw)
          .add(cameraViewport.xy)
          .div(screenSize);
        const physicalLod = cameraViewport.z
          .log2()
          .mul(roughness.mul(eta.mul(2).sub(2).clamp()));
        // Reuse the existing HDR mip pyramid. A minimum footprint suppresses
        // fine refracted geometry without roughening the surface reflections.
        const light = textureBicubicLevel(
          opaque.sample(coords),
          physicalLod.max(minimumMip),
        );
        const tint = diffuseContribution.mul(
          attenuation(ray.length(), attenuationColor, attenuationDistance),
        );
        return { light, tint };
      };
      const light = vec4(0).toVar(),
        tint = vec3(0).toVar();
      if (spectral) {
        const spread = ior.sub(1).mul(dispersion.mul(0.025));
        const indices = vec3(ior.sub(spread), ior, ior.add(spread));
        Loop({ start: 0, end: 3 }, ({ i }) => {
          const result = sample(indices.element(i));
          light.element(i).assign(result.light.element(i));
          light.a.addAssign(result.light.a);
          tint.element(i).assign(result.tint.element(i));
        });
        light.a.divAssign(3);
      } else {
        const result = sample(ior);
        light.assign(result.light);
        tint.assign(result.tint);
      }
      const fresnel = EnvironmentBRDF({
        dotNV: n.dot(v).clamp(),
        specularColor: specularColorBlended,
        specularF90,
        roughness,
      });
      const opacity = light.a
        .oneMinus()
        .mul(tint.dot(vec3(1 / 3)))
        .oneMinus();
      return vec4(fresnel.oneMinus().mul(tint).mul(light.rgb), opacity);
    })();
    builder.context.backdrop = backdrop;
    builder.context.backdropAlpha = transmission;
    diffuseColor.a.mulAssign(mix(1, backdrop.a, transmission));
  }
}
