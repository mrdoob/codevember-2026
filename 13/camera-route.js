// A geometric track with straight segments and curvature-continuous corners.
// The camera uses this track's exact tangent; there is no separate gaze curve.
export function createCameraRoute(points, clearance) {
  const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const direction = (a, b) => { const d = distance(a, b); return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
  const offset = (p, v, amount) => [p[0] + v[0] * amount, p[1] + v[1] * amount];
  const vertices = points.filter((p, i) => {
    if (i === 0) return true;
    const a = direction(points[(i + points.length - 1) % points.length], p), b = direction(p, points[(i + 1) % points.length]);
    return a[0] * b[0] + a[1] * b[1] < .999999;
  });
  const bernstein = (p, t, derivative = false) => {
    const u = 1 - t;
    const weights = derivative ? [u ** 4, 4 * t * u ** 3, 6 * t * t * u * u, 4 * t ** 3 * u, t ** 4]
      : [u ** 5, 5 * t * u ** 4, 10 * t * t * u ** 3, 10 * t ** 3 * u * u, 5 * t ** 4 * u, t ** 5];
    let x = 0, z = 0;
    for (let i = 0; i < weights.length; i++) {
      x += weights[i] * (derivative ? 5 * (p[i + 1][0] - p[i][0]) : p[i][0]);
      z += weights[i] * (derivative ? 5 * (p[i + 1][1] - p[i][1]) : p[i][1]);
    }
    return [x, z];
  };
  const corners = vertices.map((p, i) => {
    const before = vertices[(i + vertices.length - 1) % vertices.length], after = vertices[(i + 1) % vertices.length];
    const incoming = direction(before, p), outgoing = direction(p, after);
    if (incoming[0] * outgoing[0] + incoming[1] * outgoing[1] > .999999) return { entry: p, exit: p };
    // Use more of the available passage for each bend. Short legs share their
    // space evenly; hedge clearance determines how wide each corner can be.
    let cut = Math.min(5, distance(before, p) * .49, distance(p, after) * .49);
    for (let attempt = 0; attempt < 32; attempt++, cut *= .95) {
      const entry = offset(p, incoming, -cut), exit = offset(p, outgoing, cut), handle = cut * .4;
      // Collinear, equally spaced endpoint controls make the curvature zero
      // at the joins with straight passages, without Catmull–Rom overshoot.
      const control = [entry, offset(entry, incoming, handle), offset(entry, incoming, handle * 2), offset(exit, outgoing, -handle * 2), offset(exit, outgoing, -handle), exit];
      let safe = true;
      for (let j = 0; j <= 80; j++) if (clearance(...bernstein(control, j / 80)) < .8) { safe = false; break; }
      if (safe) return { entry, exit, control, cut };
    }
    throw new Error('Unable to fit a safe camera corner.');
  });
  const segments = []; let length = 0;
  function add(segment) {
    if (segment.length < 1e-8) return;
    segment.start = length; length += segment.length; segments.push(segment);
  }
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i], previous = corners[(i + corners.length - 1) % corners.length];
    add({ a: previous.exit, b: corner.entry, length: distance(previous.exit, corner.entry) });
    if (corner.control) {
      const divisions = Math.max(64, Math.ceil(corner.cut * 2 / .015)), lengths = [0];
      let previous = corner.entry;
      for (let j = 1; j <= divisions; j++) { const p = bernstein(corner.control, j / divisions); lengths.push(lengths[j - 1] + distance(previous, p)); previous = p; }
      add({ control: corner.control, lengths, divisions, length: lengths.at(-1) });
    }
  }
  function locate(value) {
    const d = ((value % length) + length) % length; let low = 0, high = segments.length;
    while (high - low > 1) { const mid = (low + high) >> 1; if (segments[mid].start <= d) low = mid; else high = mid; }
    const segment = segments[low], local = d - segment.start;
    if (!segment.control) return [segment, local / segment.length];
    const { lengths, divisions } = segment; low = 0; high = divisions;
    while (high - low > 1) { const mid = (low + high) >> 1; if (lengths[mid] <= local) low = mid; else high = mid; }
    return [segment, (low + (local - lengths[low]) / (lengths[low + 1] - lengths[low])) / divisions];
  }
  return {
    length, segments,
    at(distance, out = {}) {
      const [s, t] = locate(distance), p = s.control ? bernstein(s.control, t) : [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
      out.x = p[0]; out.y = 0; out.z = p[1]; return out;
    },
    tangent(distance, out = {}) {
      const [s, t] = locate(distance), v = s.control ? bernstein(s.control, t, true) : [s.b[0] - s.a[0], s.b[1] - s.a[1]];
      const magnitude = Math.hypot(...v); out.x = v[0] / magnitude; out.y = 0; out.z = v[1] / magnitude; return out;
    },
  };
}
