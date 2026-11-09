import {
  Fn,
  bumpMap,
  float,
  materialColor,
  output,
  positionWorld,
  texture,
  vec2,
  vec4,
} from "three/tsl";
import { createConcreteTexture } from "./concrete-texture.js";
import { createFloorScratches } from "./floor-scratches.js";

export function createFloorSurface(material) {
  // Reuse Day 08's smooth floor: subtle color mottling and layered wear in
  // roughness. Scale the pattern for this smaller subject.
  const concrete = createConcreteTexture();
  concrete.anisotropy = 8;
  const p = positionWorld.xz;
  const surface = texture(concrete, p.mul(0.135));
  const scratches = createFloorScratches();
  const scratch = texture(scratches, p.mul(1 / 12)).r;
  material.colorNode = materialColor
    .mul(surface.r.mul(0.16).add(0.92))
    .mul(scratch.mul(1.6).add(1));
  const wear = texture(concrete, p.mul(0.0675)).a;
  const fineWear = texture(concrete, p.mul(0.27).add(0.37)).a.smoothstep(
    0.25,
    0.75,
  );
  const patches = wear.mul(0.8).add(fineWear.mul(0.2)).smoothstep(0.15, 1);
  const patchWeight = patches.mul(fineWear.mul(0.2).add(0.22)).div(0.42);
  material.roughnessNode = patchWeight
    .mul(0.4)
    .add(0.45)
    .add(scratch.mul(0.23))
    .clamp(0.45, 0.94);
  material.normalNode = bumpMap(scratch.negate(), 0.012);

  // A broad, soft ambient shadow beneath the basket, a denser patch beneath
  // the low magnet, and six narrow arcs matching the curved support feet.
  // Apply it directly to the floor to avoid extra decal geometry and passes.
  const occlusion = Fn(() => {
    const radius = p.length().toVar();
    const visibility = float(1)
      .sub(radius.smoothstep(1.8, 4.1).oneMinus().mul(0.64))
      .toVar();
    visibility.mulAssign(
      radius.smoothstep(1.3, 2.2).oneMinus().mul(0.45).oneMinus(),
    );
    const contact = radius
      .sub(3.14)
      .div(0.19)
      .pow(2)
      .negate()
      .exp()
      .mul(0.72)
      .toVar();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3,
        c = Math.cos(a),
        s = Math.sin(a);
      const radial = p.dot(vec2(c, s)),
        tangent = p.dot(vec2(-s, c));
      const arc = tangent
        .abs()
        .smoothstep(0.87, 1.16)
        .oneMinus()
        .mul(radial.smoothstep(2.5, 2.9));
      visibility.mulAssign(contact.mul(arc).oneMinus());
    }
    return visibility;
  })();
  material.outputNode = vec4(output.rgb.mul(occlusion), output.a);

  return {
    occlusion,
    dispose() {
      concrete.dispose();
      scratches.dispose();
    },
  };
}
