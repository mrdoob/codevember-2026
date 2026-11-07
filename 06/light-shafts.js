import {
  Fn,
  If,
  float,
  getViewPosition,
  rtt,
  screenUV,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

// Integrate a little airborne scattering inside the same expanding cones that
// paint the wall caustics. Clip to scene depth and the room, so shafts stay
// behind the instrument and terminate at the receiving surface.
export function lightCones(caustics) {
  return [
    ...caustics.beams.map((b) => ({
      ...b,
      baseRadius: b.radius.mul(caustics.optics),
      slope: b.radius
        .mul(caustics.optics)
        .add(caustics.sunRadius * 0.65)
        .div(b.sourceDistance),
      scattering: 0.011,
      particles: 320,
    })),
    ...caustics.sunBeams,
  ];
}
export function createLightShafts(depth, camera, caustics) {
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const world = uniform(camera.matrixWorld);
  const eye = uniform(camera.position);
  const cones = lightCones(caustics);
  const radiance = Fn(() => {
    const view = getViewPosition(
      screenUV,
      depth.sample(screenUV).r,
      inverseProjection,
    ).toVar();
    const ray = world.mul(vec4(view.normalize(), 0)).xyz.normalize().toVar();
    const limit = view.length().min(80).toVar();
    const result = vec3(0).toVar();
    If(caustics.strength.greaterThan(0.001), () => {
      for (const b of cones) {
        const delta = eye.sub(b.centre).toVar();
        const h = delta.dot(b.direction).toVar();
        const a = ray.dot(b.direction).toVar();
        const safeA = a.abs().max(0.00001).mul(a.lessThan(0).select(-1, 1));
        const t0 = h.negate().div(safeA),
          t1 = b.length.sub(h).div(safeA);
        const lo = t0.min(t1).max(0).toVar(),
          hi = t0.max(t1).min(limit).toVar();
        const slope = b.slope;
        const radius = b.baseRadius;
        const radial = delta.sub(b.direction.mul(h)).toVar();
        const dr = ray.sub(b.direction.mul(a)).toVar();
        const r0 = radius.add(slope.mul(h));
        const A = dr.dot(dr).sub(slope.mul(a).pow2()).toVar();
        const B = radial.dot(dr).sub(r0.mul(slope).mul(a)).mul(2).toVar();
        const C = radial.dot(radial).sub(r0.pow2()).toVar();
        const discriminant = B.pow2().sub(A.mul(C).mul(4)).toVar();
        If(A.abs().lessThan(0.00001), () => {
          If(B.abs().greaterThan(0.00001), () => {
            const crossing = C.negate().div(B);
            If(B.greaterThan(0), () => {
              hi.assign(hi.min(crossing));
            }).Else(() => {
              lo.assign(lo.max(crossing));
            });
          }).Else(() => {
            If(C.greaterThan(0), () => {
              hi.assign(lo);
            });
          });
        }).Else(() => {
          If(discriminant.greaterThan(0), () => {
            const root = discriminant.sqrt();
            const x = B.negate().sub(root).div(A.mul(2));
            const y = B.negate().add(root).div(A.mul(2));
            const near = x.min(y).toVar(),
              far = x.max(y).toVar();
            If(A.greaterThan(0), () => {
              lo.assign(lo.max(near));
              hi.assign(hi.min(far));
            }).Else(() => {
              If(lo.lessThan(near), () => {
                hi.assign(hi.min(near));
              }).Else(() => {
                lo.assign(lo.max(far));
              });
            });
          }).Else(() => {
            If(A.greaterThan(0), () => {
              hi.assign(lo);
            });
          });
        });
        If(hi.greaterThan(lo), () => {
          const step = hi.sub(lo).div(6).toVar();
          const integral = float(0).toVar();
          for (let i = 0; i < 6; i++) {
            const t = lo.add(step.mul(i + 0.5));
            const along = h.add(a.mul(t));
            const p = delta.add(ray.mul(t));
            const spread = radius.add(slope.mul(along));
            const radial2 = p.dot(p).sub(along.pow2()).max(0);
            const density = radial2
              .div(spread.pow2())
              .oneMinus()
              .max(0)
              .pow2();
            const start = along.smoothstep(
              b.radius.mul(0.5),
              b.radius.mul(2),
            );
            integral.addAssign(
              density.mul(start).div(along.mul(0.045).add(1)),
            );
          }
          const tint = b.tint.div(
            b.tint.r.max(b.tint.g).max(b.tint.b).max(0.1),
          );
          const phase = a.pow2().mul(0.65).add(0.35);
          result.addAssign(
            tint.mul(integral).mul(step).mul(phase).mul(b.scattering),
          );
        });
      }
    });
    return vec4(result.mul(caustics.strength.mul(4).sqrt()), 1);
  })();
  return rtt(radiance, null, null, { resolutionScale: 0.5 });
}
