import {
  Fn,
  If,
  float,
  positionWorld,
  reflectVector,
  roughness,
  uniform,
  vec2,
} from "three/tsl";
import {
  COLUMN_LOCATIONS,
  COLUMN_BASE_WIDTH,
  COLUMN_SHAFT_WIDTH,
} from "./room-layout.js";

// Columns reach above every emitter, so their horizontal silhouettes can
// occlude a floor-to-light ray without a shadow map or a raymarch.
const columnVisibility = Fn(
  ({ point, source, blur }) => {
    const ray = source.xz.sub(point.xz).toVar(),
      length = ray.length().max(0.001);
    const direction = ray.div(length).toVar(),
      visibility = float(1).toVar();
    for (const [x, z] of COLUMN_LOCATIONS) {
      const toColumn = vec2(x, z).sub(point.xz),
        along = toColumn.dot(direction);
      If(along.greaterThan(0).and(along.lessThan(length)), () => {
        const across = toColumn.x
          .mul(direction.y)
          .sub(toColumn.y.mul(direction.x))
          .abs();
        const width = direction
          .abs()
          .x.add(direction.abs().y)
          .mul(COLUMN_SHAFT_WIDTH / 2);
        const penumbra = blur
          .mul(along)
          .div(length.sub(along).max(0.1))
          .add(0.025)
          .min(4);
        visibility.mulAssign(across.smoothstep(width, width.add(penumbra)));
      });
    }
    return visibility;
  },
  { point: "vec3", source: "vec3", blur: "float", return: "float" },
);

const tubeVisibility = Fn(
  ({
    point,
    start,
    end,
    radius,
    reflection,
    roughness: surfaceRoughness,
    spread,
    strength,
  }) => {
    const segment = end.sub(start).toVar(),
      offset = start.sub(point).toVar();
    const length2 = segment.dot(segment).max(0.0001),
      length = length2.sqrt();
    const nearest = offset.dot(segment).negate().div(length2).clamp(0, 1);
    // Pick the tube point closest to the reflected viewing ray for highlights.
    const projected = segment.dot(reflection);
    const specularT = projected
      .mul(offset.dot(reflection))
      .sub(segment.dot(offset))
      .div(length2.sub(projected.mul(projected)).max(0.0001))
      .clamp(0, 1);
    const diffuse = columnVisibility({
      point,
      source: start.add(segment.mul(nearest)),
      blur: length.mul(0.12).min(0.8).add(radius).mul(spread),
    });
    const specular = columnVisibility({
      point,
      source: start.add(segment.mul(specularT)),
      blur: radius
        .add(surfaceRoughness.mul(surfaceRoughness).mul(length).mul(0.15))
        .mul(spread),
    });
    return vec2(1).sub(vec2(1).sub(vec2(diffuse, specular)).mul(strength));
  },
  {
    point: "vec3",
    start: "vec3",
    end: "vec3",
    radius: "float",
    reflection: "vec3",
    roughness: "float",
    spread: "float",
    strength: "float",
    return: "vec2",
  },
);

export function createColumnShadows(settings) {
  const strength = uniform(settings.columnShadowStrength),
    softness = uniform(settings.columnShadowSoftness);
  const contact = Fn(() => {
    const contact = float(1).toVar();
    for (const [x, z] of COLUMN_LOCATIONS) {
      const distance = positionWorld.xz
        .sub(vec2(x, z))
        .abs()
        .sub(COLUMN_BASE_WIDTH * 0.5)
        .max(0)
        .length();
      contact.mulAssign(
        distance
          .smoothstep(0.02, 0.48)
          .oneMinus()
          .mul(strength)
          .mul(0.35)
          .oneMinus(),
      );
    }
    return contact;
  })();
  return {
    contact,
    visibility(start, end, radius) {
      return tubeVisibility({
        point: positionWorld,
        start,
        end,
        radius,
        reflection: reflectVector,
        roughness,
        spread: softness,
        strength,
      });
    },
    update() {
      strength.value = settings.columnShadows
        ? settings.columnShadowStrength
        : 0;
      softness.value = settings.columnShadowSoftness;
    },
  };
}
