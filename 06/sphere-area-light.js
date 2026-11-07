import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  float,
  vec3,
  mat3,
  uniform,
  texture,
  normalView,
  positionViewDirection,
  roughness,
  specularColorBlended,
  specularF90,
  diffuseContribution,
  clearcoatNormalView,
  clearcoatRoughness,
  LTC_Uv,
} from "three/tsl";

let ltc;

// A luminous sphere shares the point light's cube shadow map. Only its direct
// irradiance and specular integration change; shadow softness stays artistic.
export class SphereAreaLight extends THREE.PointLight {
  constructor(color, intensity, radius = 0.72, distance = 45) {
    super(color, intensity, distance, 2);
    this.type = "SphereAreaLight";
    this.radius = radius;
  }
  static setLTC(textures) {
    ltc = textures;
  }
}

class SphereAreaLightNode extends THREE.PointLightNode {
  static get type() {
    return "SphereAreaLightNode";
  }
  constructor(light) {
    super(light);
    this.radiusNode = uniform(light.radius);
  }
  update(frame) {
    super.update(frame);
    this.radiusNode.value = this.light.radius;
  }
  setupDirect(builder) {
    const data = super.setupDirect(builder);
    const vector = this.getLightVector(builder).toVar();
    const distance2 = vector.dot(vector).max(1e-6);
    const radius2 = this.radiusNode.pow2();
    const filterable = builder.isAvailable("float32Filterable");
    return {
      ...data,
      sphereVector: vector,
      sphereRadius: this.radiusNode,
      // Point intensity = radiance * projected area. Reuse attenuation, cutoff
      // and the shadow term from the stock node without inverse-square twice.
      sphereRadiance: data.lightColor
        .mul(distance2)
        .div(radius2.mul(Math.PI)),
      ltc1: texture(filterable ? ltc.LTC_FLOAT_1 : ltc.LTC_HALF_1),
      ltc2: texture(filterable ? ltc.LTC_FLOAT_2 : ltc.LTC_HALF_2),
    };
  }
}
SphereAreaLight.registerNode(SphereAreaLightNode);

// Analytic cosine integral over a spherical emitter, including horizon clipping.
// Frostbite sphere illuminance formula, normalized by PI for Lambert diffuse.
const sphereDiffuse = Fn(
  ({ cosine, sin2 }) => {
    const c = cosine.clamp(-1, 1).toVar();
    const result = float(0).toVar();
    If(c.pow2().greaterThan(sin2), () => {
      result.assign(sin2.mul(c.max(0)));
    }).Else(() => {
      const s = c.pow2().oneMinus().max(1e-8).sqrt();
      const x = sin2.reciprocal().sub(1).max(1e-8).sqrt();
      const y = x.mul(c).negate().div(s).clamp(-1, 1);
      const h = s.mul(y.pow2().oneMinus().max(0).sqrt());
      result.assign(
        c
          .mul(y.acos())
          .sub(x.mul(h))
          .mul(sin2)
          .add(h.div(x).atan())
          .div(Math.PI),
      );
    });
    return result.max(0);
  },
  { cosine: "float", sin2: "float", return: "float" },
);

// The edge and horizon approximations follow three.js LTC.js (MIT). Integrating
// a twelve-sided spherical cap gives a finite highlight, even on polished metal.
const edgeFactor = Fn(
  ({ a, b }) => {
    const x = a.dot(b),
      y = x.abs();
    const v = y
      .mul(0.0145206)
      .add(0.4965155)
      .mul(y)
      .add(0.8543985)
      .div(y.add(4.1616724).mul(y).add(3.417594));
    const factor = x
      .greaterThan(0)
      .select(v, x.pow2().oneMinus().max(1e-7).inverseSqrt().mul(0.5).sub(v));
    return a.cross(b).mul(factor);
  },
  { a: "vec3", b: "vec3", return: "vec3" },
);

const sphereLTC = Fn(
  ({ N, V, axis, sinAlpha, mInv }) => {
    const fallback = N.y
      .abs()
      .lessThan(0.99)
      .select(vec3(0, 1, 0), vec3(1, 0, 0))
      .cross(N)
      .normalize();
    const tangent = V.sub(N.mul(V.dot(N))).toVar();
    tangent.assign(
      tangent
        .dot(tangent)
        .greaterThan(1e-8)
        .select(tangent.div(tangent.length().max(1e-8)), fallback),
    );
    const transform = mInv
      .mul(mat3(tangent, N.cross(tangent).negate(), N).transpose())
      .toVar();
    const up = axis.y
      .abs()
      .lessThan(0.99)
      .select(vec3(0, 1, 0), vec3(1, 0, 0));
    const U = up.cross(axis).normalize().mul(sinAlpha).toVar();
    const W = U.cross(axis).toVar();
    const centre = axis.mul(sinAlpha.pow2().oneMinus().max(0).sqrt()).toVar();
    const points = [];
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      points.push(
        transform
          .mul(centre.add(U.mul(Math.cos(angle))).add(W.mul(Math.sin(angle))))
          .normalize()
          .toVar(),
      );
    }
    const integral = vec3(0).toVar();
    for (let i = 0; i < 12; i++)
      integral.addAssign(
        edgeFactor({ a: points[i], b: points[(i + 1) % 12] }),
      );
    const length = integral.length();
    return length.pow2().add(integral.z).div(length.add(1)).max(0);
  },
  {
    N: "vec3",
    V: "vec3",
    axis: "vec3",
    sinAlpha: "float",
    mInv: "mat3",
    return: "float",
  },
);

export function sphereDirect(input) {
  const {
    sphereVector,
    sphereRadius,
    sphereRadiance,
    reflectedLight,
    ltc1,
    ltc2,
  } = input;
  const distance = sphereVector.length().max(1e-5).toVar();
  const axis = sphereVector.div(distance).toVar();
  const sinAlpha = sphereRadius.div(distance).clamp(1e-5, 0.9999).toVar();
  // Do not illuminate the luminous shell itself or geometry inside it.
  const radiance = sphereRadiance
    .mul(distance.greaterThan(sphereRadius.mul(1.001)))
    .toVar();
  const specular = (N, r, f0, f90) => {
    const coordinates = LTC_Uv({ N, V: positionViewDirection, roughness: r });
    const t1 = ltc1.sample(coordinates).toVar(),
      t2 = ltc2.sample(coordinates).toVar();
    const mInv = mat3(
      vec3(t1.x, 0, t1.y),
      vec3(0, 1, 0),
      vec3(t1.z, 0, t1.w),
    );
    const fresnel = f0.mul(t2.x).add(f90.sub(f0).mul(t2.y));
    return radiance
      .mul(fresnel)
      .mul(sphereLTC({ N, V: positionViewDirection, axis, sinAlpha, mInv }));
  };
  reflectedLight.directDiffuse.addAssign(
    radiance
      .mul(diffuseContribution)
      .mul(
        sphereDiffuse({
          cosine: normalView.dot(axis),
          sin2: sinAlpha.pow2(),
        }),
      ),
  );
  reflectedLight.directSpecular.addAssign(
    specular(normalView, roughness, specularColorBlended, specularF90),
  );
  if (this.clearcoat)
    this.clearcoatSpecularDirect.addAssign(
      specular(clearcoatNormalView, clearcoatRoughness, vec3(0.04), float(1)),
    );
}
