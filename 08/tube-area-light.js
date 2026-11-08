import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  float,
  mat3,
  vec2,
  vec3,
  vec4,
  uniform,
  texture,
  renderGroup,
  cameraViewMatrix,
  positionView,
  normalView,
  positionViewDirection,
  roughness,
  specularColorBlended,
  specularF90,
  diffuseContribution,
  LTC_Uv,
} from "three/tsl";
import { RectAreaLightTexturesLib } from "three/addons/lights/RectAreaLightTexturesLib.js";

// Analytical cylindrical line integration adapted from Heitz et al.'s LTC
// reference implementation. Attribution and license: vendor/LTC-LICENSE.txt.
// https://github.com/selfshadow/ltc_code/blob/master/webgl/shaders/ltc/ltc_line.fs
// Real-Time Polygonal-Light Shading with Linearly Transformed Cosines,
// Eric Heitz, Jonathan Dupuy, Stephen Hill and David Neubelt, SIGGRAPH 2016.
let ltc;

export class TubeAreaLight extends THREE.Light {
  constructor(color = 0xffffff, intensity = 1, radius = 0.025) {
    super(color, intensity);
    this.type = "TubeAreaLight";
    this.isTubeAreaLight = true;
    this.start = new THREE.Vector3(0, -0.5, 0);
    this.end = new THREE.Vector3(0, 0.5, 0);
    this.radius = radius;
  }
  copy(source, recursive) {
    super.copy(source, recursive);
    this.start.copy(source.start);
    this.end.copy(source.end);
    this.radius = source.radius;
    return this;
  }
}

class TubeAreaLightNode extends THREE.AnalyticLightNode {
  static get type() {
    return "TubeAreaLightNode";
  }
  constructor(light) {
    super(light);
    this.start = uniform(new THREE.Vector3()).setGroup(renderGroup);
    this.end = uniform(new THREE.Vector3()).setGroup(renderGroup);
    this.radius = uniform(light.radius).setGroup(renderGroup);
    this.updateType = THREE.NodeUpdateType.RENDER;
  }
  update(frame) {
    super.update(frame);
    this.start.value
      .copy(this.light.start)
      .applyMatrix4(this.light.matrixWorld);
    this.end.value.copy(this.light.end).applyMatrix4(this.light.matrixWorld);
    this.radius.value = this.light.radius;
  }
  setupDirect(builder) {
    ltc ??= RectAreaLightTexturesLib.init();
    const filterable = builder.isAvailable("float32Filterable");
    return {
      lightColor: this.colorNode,
      tubeStart: cameraViewMatrix.mul(vec4(this.start, 1)).xyz,
      tubeEnd: cameraViewMatrix.mul(vec4(this.end, 1)).xyz,
      tubeWorldStart: this.start,
      tubeWorldEnd: this.end,
      tubeRadius: this.radius,
      ltc1: texture(filterable ? ltc.LTC_FLOAT_1 : ltc.LTC_HALF_1),
      ltc2: texture(filterable ? ltc.LTC_FLOAT_2 : ltc.LTC_HALF_2),
    };
  }
}
TubeAreaLight.registerNode(TubeAreaLightNode);

const primitivePO = Fn(
  ({ d, l }) =>
    l.div(d.mul(d.mul(d).add(l.mul(l)))).add(l.div(d).atan().div(d.mul(d))),
  { d: "float", l: "float", return: "float" },
);
const primitiveWT = Fn(
  ({ d, l }) => l.mul(l).div(d.mul(d.mul(d).add(l.mul(l)))),
  { d: "float", l: "float", return: "float" },
);

const cosineLine = Fn(
  ({ a, b }) => {
    const p = a.toVar(),
      q = b.toVar();
    const result = float(0).toVar();
    If(p.z.greaterThan(0).or(q.z.greaterThan(0)), () => {
      const axis = q.sub(p).div(q.sub(p).length().max(1e-6)).toVar();
      // Clip against the receiving hemisphere before evaluating the integral.
      If(p.z.lessThan(0), () => {
        p.assign(p.mul(q.z).sub(q.mul(p.z)).div(q.z.sub(p.z).max(1e-6)));
      });
      If(q.z.lessThan(0), () => {
        q.assign(q.mul(p.z).sub(p.mul(q.z)).div(p.z.sub(q.z).max(1e-6)));
      });
      const l1 = p.dot(axis),
        l2 = q.dot(axis);
      const closest = p.sub(axis.mul(l1)).toVar();
      const d = closest.length().max(0.0001);
      result.assign(
        primitivePO({ d, l: l2 })
          .sub(primitivePO({ d, l: l1 }))
          .mul(closest.z)
          .add(
            primitiveWT({ d, l: l2 })
              .sub(primitiveWT({ d, l: l1 }))
              .mul(axis.z),
          )
          .div(Math.PI)
          .max(0)
          .mul(closest.length().greaterThan(0.0001)),
      );
    });
    return result;
  },
  { a: "vec3", b: "vec3", return: "float" },
);

const tubeIntegral = Fn(
  ({ a, b, radius, inverse, inverseTranspose }) => {
    const p = a.toVar(),
      q = b.toVar();
    const result = float(0).toVar();
    If(p.z.greaterThan(0).or(q.z.greaterThan(0)), () => {
      // Clip in the original frame as well as the transformed cosine frame.
      // Otherwise the skewed specular lobe can illuminate from below a surface.
      If(p.z.lessThan(0), () => {
        p.assign(p.mul(q.z).sub(q.mul(p.z)).div(q.z.sub(p.z).max(1e-6)));
      });
      If(q.z.lessThan(0), () => {
        q.assign(q.mul(p.z).sub(p.mul(q.z)).div(p.z.sub(q.z).max(1e-6)));
      });
      const perpendicular = p.cross(q).toVar();
      const width = perpendicular.div(perpendicular.length().max(1e-6));
      const correction = inverseTranspose
        .mul(width)
        .length()
        .max(0.0001)
        .reciprocal();
      result.assign(
        cosineLine({ a: inverse.mul(p), b: inverse.mul(q) })
          .mul(radius)
          .mul(correction)
          .clamp(0, 1),
      );
    });
    return result;
  },
  {
    a: "vec3",
    b: "vec3",
    radius: "float",
    inverse: "mat3",
    inverseTranspose: "mat3",
    return: "float",
  },
);

export class TubeLightingModel extends THREE.PhysicalLightingModel {
  constructor(columnShadows = null) {
    super();
    this.columnShadows = columnShadows;
  }
  direct(input, builder) {
    if (!input.tubeRadius) return super.direct(input, builder);
    const {
      tubeStart,
      tubeEnd,
      tubeRadius,
      lightColor,
      reflectedLight,
      ltc1,
      ltc2,
    } = input;
    // Shared per shading point: the LTC tables and tangent frame do not depend
    // on the light. Thirty-two emitters still require only two table samples.
    if (!this.tubeFrame) {
      const N = normalView,
        V = positionViewDirection;
      const tangent = V.sub(N.mul(V.dot(N))).toVar();
      const fallback = N.y
        .abs()
        .lessThan(0.99)
        .select(vec3(0, 1, 0), vec3(1, 0, 0))
        .cross(N)
        .normalize();
      const T = tangent
        .length()
        .greaterThan(1e-5)
        .select(tangent.div(tangent.length().max(1e-5)), fallback)
        .toVar();
      const basis = mat3(T, N.cross(T), N).transpose().toVar();
      const coordinates = LTC_Uv({ N, V, roughness });
      const t1 = ltc1.sample(coordinates).toVar(),
        t2 = ltc2.sample(coordinates).toVar();
      const determinant = t1.x.mul(t1.w).sub(t1.y.mul(t1.z)).max(1e-8);
      const inverse = mat3(
        vec3(t1.x, 0, t1.y),
        vec3(0, 1, 0),
        vec3(t1.z, 0, t1.w),
      ).toVar();
      const inverseTranspose = mat3(
        vec3(t1.w, 0, t1.z.negate()).div(determinant),
        vec3(0, 1, 0),
        vec3(t1.y.negate(), 0, t1.x).div(determinant),
      ).toVar();
      const fresnel = specularColorBlended
        .mul(t2.x)
        .add(specularF90.sub(specularColorBlended).mul(t2.y))
        .toVar();
      this.tubeFrame = { basis, inverse, inverseTranspose, fresnel };
    }
    const { basis, inverse, inverseTranspose, fresnel } = this.tubeFrame;
    const a = basis.mul(tubeStart.sub(positionView)).toVar();
    const b = basis.mul(tubeEnd.sub(positionView)).toVar();
    const diffuse = cosineLine({ a, b }).mul(tubeRadius).clamp(0, 1);
    const specular = tubeIntegral({
      a,
      b,
      radius: tubeRadius,
      inverse,
      inverseTranspose,
    });
    const visibility = this.columnShadows
      ? this.columnShadows
          .visibility(input.tubeWorldStart, input.tubeWorldEnd, tubeRadius)
          .toVar()
      : vec2(1);
    reflectedLight.directDiffuse.addAssign(
      lightColor.mul(diffuseContribution).mul(diffuse).mul(visibility.x),
    );
    reflectedLight.directSpecular.addAssign(
      lightColor.mul(fresnel).mul(specular).mul(visibility.y),
    );
  }
}

export function tubeMaterial(parameters, columnShadows = null) {
  const material = new THREE.MeshStandardNodeMaterial(parameters);
  material.setupLightingModel = () => new TubeLightingModel(columnShadows);
  return material;
}
