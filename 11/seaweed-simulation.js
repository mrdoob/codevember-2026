import { rotateVector, linkPoint, LINK } from "./link-shape.js";
const NODES = 9;
const transform = (p, body, z) =>
  rotateVector(p, body.quaternion).map(
    (v, k) => v + body.position[k] + (k === 2 ? z : 0),
  );

// Short, inextensible strands with Verlet inertia, water drag and current.
// Roots follow the shell, individual links, or the surviving fracture surface.
export class SeaweedSimulation {
  constructor(roots, body, z = 0) {
    this.z = z;
    this.time = 0;
    this.strands = roots.map((descriptor) => {
      const { root, length } = descriptor;
      const host = descriptor.resolveBody?.() ?? body;
      const anchor = transform(root, host, z);
      const points = Array.from({ length: NODES }, (_, i) =>
        anchor.map((v, k) => v + (k === 1 ? (-i * length) / (NODES - 1) : 0)),
      );
      return {
        ...descriptor,
        body: host,
        points,
        previous: points.map((p) => [...p]),
      };
    });
  }
  advance(dt, body) {
    this.time += dt;
    const drag = Math.exp(-dt * 3.5);
    for (const strand of this.strands) {
      const host = strand.resolveBody?.() ?? body;
      if (host !== strand.body) {
        strand.body = host;
        strand.path =
          host.span === undefined
            ? null
            : Array.from({ length: 19 }, (_, i) =>
                linkPoint(host.start + (host.span * i) / 18),
              );
      }
      const center = host.position.map((v, k) => v + (k === 2 ? this.z : 0));
      const inverse = host.quaternion.map((v, k) => (k < 3 ? -v : v));
      const { points, previous, phase } = strand,
        anchor = transform(strand.root, host, this.z);
      points[0] = anchor;
      previous[0] = [...anchor];
      for (let i = 1; i < NODES; i++) {
        const p = points[i],
          old = [...p];
        const current = [
          Math.sin(this.time * 0.8 + phase + p[1] * 1.8) * 0.22,
          -0.28,
          Math.cos(this.time * 0.6 + phase + p[0]) * 0.16,
        ];
        for (let k = 0; k < 3; k++)
          p[k] += (p[k] - previous[i][k]) * drag + current[k] * dt * dt;
        previous[i] = old;
      }
      const spacing = strand.length / (NODES - 1);
      for (let iteration = 0; iteration < 6; iteration++) {
        points[0] = [...anchor];
        for (let i = 1; i < NODES; i++) {
          const a = points[i - 1],
            b = points[i],
            delta = b.map((v, k) => v - a[k]),
            length = Math.hypot(...delta) || 1;
          const correction = (length - spacing) / length;
          for (let k = 0; k < 3; k++) {
            const d = delta[k] * correction;
            if (i > 1) a[k] += d * 0.5;
            b[k] -= d * (i === 1 ? 1 : 0.5);
          }
        }
        for (let i = 1; i < NODES; i++) {
          const p = points[i];
          if (strand.collision === "link") {
            // A hollow racetrack collision keeps fronds out of the iron while
            // leaving the opening free. Cut links only collide with their arc.
            const local = rotateVector(
              p.map((v, k) => v - center[k]),
              inverse,
            );
            const nearest = strand.path
              ? nearestOnPath(local, strand.path)
              : nearestOnLink(local);
            const delta = local.map((v, k) => v - nearest[k]);
            const length = Math.hypot(...delta);
            const radius = LINK.tube + strand.width * 0.5;
            if (length >= radius) continue;
            if (length < 1e-8) delta[2] = 1;
            const projected = nearest.map(
              (v, k) => v + (delta[k] * radius) / (length < 1e-8 ? 1 : length),
            );
            const world = rotateVector(projected, host.quaternion);
            for (let k = 0; k < 3; k++) p[k] = world[k] + center[k];
          } else {
            const delta = p.map((v, k) => v - center[k]);
            const length = Math.hypot(...delta);
            if (length >= 1.292) continue;
            for (let k = 0; k < 3; k++)
              p[k] = center[k] + (delta[k] / Math.max(length, 1e-6)) * 1.292;
          }
        }
      }
    }
  }
}

function nearestOnLink(p) {
  const y = Math.max(-LINK.halfStraight, Math.min(LINK.halfStraight, p[1]));
  const dy = p[1] - y,
    d = Math.hypot(p[0], dy);
  if (d < 1e-8) return [LINK.bend, y, 0];
  return [(p[0] * LINK.bend) / d, y + (dy * LINK.bend) / d, 0];
}

function nearestOnPath(p, path) {
  let best = path[0],
    distance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy),
      ),
    );
    const x = a[0] + t * dx,
      y = a[1] + t * dy;
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d < distance) {
      distance = d;
      best = [x, y, 0];
    }
  }
  return best;
}
