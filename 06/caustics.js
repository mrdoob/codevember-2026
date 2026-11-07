import { Vector3, Color } from "three/webgpu";
import {
  Fn,
  If,
  normalWorld,
  positionWorld,
  uniform,
  vec2,
  vec3,
} from "three/tsl";

// A lightweight lens projection for Night, not a second screen-space effect.
// Each beam follows the actual sun/globe axis and widens beyond its focus.
// A soft central pool and chromatic rim suggest a spherical lens caustic.
export function createCaustics() {
  const strength = uniform(0),
    optics = uniform(1);
  const sunRadius = 0.72;
  const source = new Vector3(0, 5.55, 0),
    up = new Vector3(0, 1, 0);
  const sourceNode = uniform(source);
  function roomDistance(centre, direction) {
    let length = 60;
    for (const [axis, low, high] of [
      ["x", -21, 21],
      ["y", -4.51, 18.5],
      ["z", -20.98, 21],
    ]) {
      if (Math.abs(direction[axis]) < 0.00001) continue;
      const distance =
        ((direction[axis] > 0 ? high : low) - centre[axis]) / direction[axis];
      if (distance > 0) length = Math.min(length, distance);
    }
    return length;
  }
  let seed = 807;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  // Stable random directions belong to the sun, independent of orbital phase.
  const sunBeams = Array.from({ length: 8 }, (_, i) => {
    const azimuth = i * 2.399963 + (random() - 0.5) * 0.8;
    const y = random() * 1.4 - 0.7,
      r = Math.sqrt(1 - y * y);
    const direction = new Vector3(
      Math.cos(azimuth) * r,
      y,
      Math.sin(azimuth) * r,
    );
    const u = new Vector3().crossVectors(direction, up).normalize();
    return {
      centre: sourceNode,
      direction: uniform(direction),
      u: uniform(u),
      v: uniform(new Vector3().crossVectors(u, direction).normalize()),
      tint: uniform(new Color(1, 0.82, 0.52)),
      radius: uniform(sunRadius),
      baseRadius: uniform(0.55 + random() * 0.3),
      slope: uniform(0.12 + random() * 0.08),
      length: uniform(20),
      scattering: 0.0015,
      particles: 80,
    };
  });
  const beams = Array.from({ length: 5 }, () => ({
    centre: uniform(new Vector3()),
    direction: uniform(new Vector3(1, 0, 0)),
    u: uniform(new Vector3()),
    v: uniform(new Vector3()),
    tint: uniform(new Color()),
    radius: uniform(0.3),
    sourceDistance: uniform(1),
    length: uniform(20),
  }));
  const node = Fn(() => {
    const result = vec3(0).toVar();
    If(strength.greaterThan(0.001), () => {
      for (const b of beams) {
        const delta = positionWorld.sub(b.centre).toVar();
        const along = delta.dot(b.direction).toVar();
        const magnification = along.max(0).div(b.sourceDistance);
        // Extended-source penumbra: nearby globes see a very large solar disc.
        const spread = b.radius
          .mul(magnification.add(1))
          .mul(optics)
          .add(magnification.mul(sunRadius * 0.65))
          .max(0.1);
        const local = vec2(delta.dot(b.u), delta.dot(b.v))
          .div(spread)
          .toVar();
        const r = local.mul(vec2(0.96, 1.04)).length().toVar();
        If(along.greaterThan(0.5).and(r.lessThan(1.4)), () => {
          const ripple = local.x
            .mul(5)
            .sin()
            .mul(local.y.mul(4).sin())
            .mul(0.025);
          const rim = r.add(ripple).sub(0.72).pow2().mul(-75).exp();
          const core = r.pow2().mul(-1.8).exp().mul(0.34);
          const focus = local
            .sub(vec2(0.12, -0.08))
            .length()
            .pow2()
            .mul(-14)
            .exp()
            .mul(0.23);
          const crescent = local.y.mul(-0.6).add(0.35).clamp();
          const dispersion = vec3(
            r.sub(0.76).pow2().mul(-110).exp(),
            r.sub(0.72).pow2().mul(-110).exp(),
            r.sub(0.68).pow2().mul(-110).exp(),
          ).mul(0.045);
          const incidence = normalWorld.dot(b.direction.negate()).max(0);
          const falloff = along.mul(0.04).add(1).reciprocal();
          const edge = r.smoothstep(0.95, 1.4).oneMinus();
          result.addAssign(
            b.tint
              .mul(rim.mul(crescent).mul(0.24).add(core).add(focus))
              .add(dispersion.mul(b.tint))
              .mul(incidence)
              .mul(falloff)
              .mul(edge),
          );
        });
      }
    });
    return result.mul(strength);
  })();
  return {
    node,
    strength,
    beams,
    optics,
    sunRadius,
    source: sourceNode,
    sunBeams,
    update(model, settings) {
      strength.value =
        (1 - settings.daylight) ** 2 *
        settings.transmission *
        settings.caustics *
        settings.sunGlow *
        Math.min(1, (settings.ior - 1) / 0.3);
      optics.value = Math.max(0.5, (settings.ior - 1) / 0.46);
      model.sunGroup.getWorldPosition(source);
      for (const b of sunBeams)
        b.length.value = roomDistance(source, b.direction.value);
      model.planets.forEach(({ body }, i) => {
        const b = beams[i];
        body.getWorldPosition(b.centre.value);
        b.direction.value.subVectors(b.centre.value, source).normalize();
        b.sourceDistance.value = b.centre.value.distanceTo(source);
        b.u.value.crossVectors(b.direction.value, up).normalize();
        b.v.value.crossVectors(b.u.value, b.direction.value).normalize();
        b.radius.value = body.userData.glassRadius;
        b.tint.value.copy(body.userData.glassTint);
        b.length.value = roomDistance(b.centre.value, b.direction.value);
      });
    },
  };
}
