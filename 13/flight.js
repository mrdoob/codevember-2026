const TAU = Math.PI * 2;
const wrap = (value, period) => ((value % period) + period) % period;

// Regulate travel speed using the actual path curvature. The view uses the
// exact tangent of that same path, without anticipation or independent aiming.
export function createFlightProfile(length, tangentAt) {
  const count = Math.ceil(length / .03), step = length / count;
  const raw = new Float64Array(count + 1);
  for (let i = 0; i <= count; i++) {
    const t = tangentAt(i * step), angle = Math.atan2(-t.x, -t.z);
    raw[i] = i ? raw[i - 1] + wrap(angle - raw[i - 1] + Math.PI, TAU) - Math.PI : angle;
  }
  const winding = Math.round((raw[count] - raw[0]) / TAU) * TAU;
  const sample = index => raw[wrap(index, count)] + Math.floor(index / count) * winding;
  const limits = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const curvature = Math.max(Math.abs(sample(i + 1) - sample(i)), Math.abs(sample(i) - sample(i - 1))) / step;
    limits[i] = .62 / Math.max(.001, curvature);
  }
  let cruise = 0, duration = 0;
  const speeds = new Float64Array(count + 1), times = new Float64Array(count + 1);
  function configure(speed) {
    if (speed === cruise) return;
    cruise = Math.max(.05, speed);
    for (let i = 0; i < count; i++) speeds[i] = Math.min(cruise, limits[i]);
    // Brake before a bend and accelerate out of it, at at most 0.65 m/s².
    // Multiple cyclic sweeps also constrain the route's closing seam.
    const acceleration = .65;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < count; i++) speeds[i] = Math.min(speeds[i], Math.sqrt(speeds[wrap(i - 1, count)] ** 2 + 2 * acceleration * step));
      for (let i = count - 1; i >= 0; i--) speeds[i] = Math.min(speeds[i], Math.sqrt(speeds[(i + 1) % count] ** 2 + 2 * acceleration * step));
    }
    speeds[count] = speeds[0]; times[0] = 0;
    for (let i = 0; i < count; i++) times[i + 1] = times[i] + 2 * step / (speeds[i] + speeds[i + 1]);
    duration = times[count];
  }
  function timeAt(distance) {
    const d = wrap(distance, length), index = Math.min(count - 1, Math.floor(d / step)), x = d - index * step;
    const a = (speeds[index + 1] ** 2 - speeds[index] ** 2) / (2 * step);
    return times[index] + 2 * x / (speeds[index] + Math.sqrt(Math.max(0, speeds[index] ** 2 + 2 * a * x)));
  }
  function distanceAt(time) {
    const t = wrap(time, duration); let low = 0, high = count;
    while (high - low > 1) { const middle = (low + high) >> 1; if (times[middle] <= t) low = middle; else high = middle; }
    const dt = t - times[low], a = (speeds[low + 1] ** 2 - speeds[low] ** 2) / (2 * step);
    return low * step + speeds[low] * dt + .5 * a * dt * dt;
  }
  return {
    headingAt(distance) {
      const tangent = tangentAt(wrap(distance, length));
      return Math.atan2(-tangent.x, -tangent.z);
    },
    advance(distance, dt, speed) { configure(speed); return distanceAt(timeAt(distance) + dt); },
    duration(speed) { configure(speed); return duration; },
  };
}
