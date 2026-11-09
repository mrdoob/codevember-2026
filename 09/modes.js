// Physics uses metres, kilograms and seconds; the scene is uniformly enlarged.
export const WORLD_SCALE = 20;
export const PHYSICAL_RADIUS = 0.15;
export const RADIUS = PHYSICAL_RADIUS * WORLD_SCALE;
export const SURFACE_DENSITY = 1; // kg/m²
export const TENSION = 464.60044; // N/m; approximately a 55 Hz fundamental
export const FUNDAMENTAL_ROOT = 2.4048255577;
export const BASE_FREQUENCY =
  (FUNDAMENTAL_ROOT / (2 * Math.PI * PHYSICAL_RADIUS)) *
  Math.sqrt(TENSION / SURFACE_DENSITY);
export const REST_HEIGHT = 0.21;
export const restHeight = () => REST_HEIGHT;

// Presets tune the exciter. They do not select a displacement field.
// The first five were selected for sand migration; the additional resonances
// expose more radial and angular shapes in the flowing soap view.
// All 34 physical modes remain active, and the frequency slider stays continuous.
export const MODES = [
  { m: 2, n: 2, root: 8.4172441404, name: "Cross + ring" },
  { m: 0, n: 3, root: 8.6537279129, name: "Two rings" },
  { m: 3, n: 2, root: 9.7610231299, name: "Six spokes" },
  { m: 1, n: 2, root: 7.0155866698, name: "Line + ring" },
  { m: 4, n: 2, root: 11.0647094885, name: "Eight spokes" },
  { m: 2, n: 1, root: 5.1356223018, name: "Cross" },
  { m: 0, n: 2, root: 5.5200781103, name: "One ring" },
  { m: 3, n: 1, root: 6.3801618959, name: "Six petals" },
  { m: 4, n: 1, root: 7.5883424345, name: "Eight petals" },
  { m: 6, n: 1, root: 9.9361095242, name: "Twelve petals" },
  { m: 2, n: 3, root: 11.6198411721, name: "Cross + two rings" },
];
export const modeFrequency = (index) =>
  (BASE_FREQUENCY * MODES[index].root) / FUNDAMENTAL_ROOT;

export function besselJ(order, x) {
  let term = 1;
  for (let i = 1; i <= order; i++) term *= x / (2 * i);
  let sum = term;
  for (let k = 1; k < 70; k++) {
    term *= -((x * x) / 4) / (k * (k + order));
    sum += term;
    if (Math.abs(term) < 1e-15) break;
  }
  return sum;
}

// Every radial root below the cutoff, with BOTH angular orientations.
const roots = [
  [2.4048255577, 5.5200781103, 8.6537279129, 11.7915344391],
  [3.8317059702, 7.0155866698, 10.1734681351],
  [5.1356223018, 8.4172441404, 11.6198411721],
  [6.3801618959, 9.7610231299],
  [7.5883424345, 11.0647094885],
  [8.771483816, 12.3386041975],
  [9.9361095242],
  [11.0863700192],
  [12.225092264],
];
export const BASIS = [];
for (let m = 0; m < roots.length; m++)
  for (let n = 0; n < roots[m].length; n++) {
    const root = roots[m][n],
      radial = new Float64Array(4097);
    let peak = 0;
    for (let i = 0; i < radial.length; i++) {
      radial[i] = besselJ(m, (root * i) / 4096);
      peak = Math.max(peak, Math.abs(radial[i]));
    }
    for (let i = 0; i < radial.length; i++) radial[i] /= peak;
    radial[4096] = 0;
    const areaIntegral =
      ((Math.PI * PHYSICAL_RADIUS ** 2 * besselJ(m + 1, root) ** 2) /
        peak ** 2) *
      (m === 0 ? 1 : 0.5);
    for (const sine of m === 0 ? [false] : [false, true])
      BASIS.push({
        m,
        n: n + 1,
        root,
        sine,
        radial,
        peak,
        mass: SURFACE_DENSITY * areaIntegral,
        omega: (root / PHYSICAL_RADIUS) * Math.sqrt(TENSION / SURFACE_DENSITY),
        integral:
          m === 0
            ? (2 * Math.PI * PHYSICAL_RADIUS ** 2 * besselJ(1, root)) /
              (root * peak)
            : 0,
      });
  }
BASIS.sort((a, b) => a.omega - b.omega);
export function basisShape(index, x, z) {
  const r = Math.hypot(x, z) / PHYSICAL_RADIUS;
  if (r >= 1) return 0;
  const mode = BASIS[index],
    p = r * 4096,
    i = Math.floor(p),
    f = p - i;
  const radial = mode.radial[i] * (1 - f) + mode.radial[i + 1] * f,
    angle = mode.m * Math.atan2(z, x);
  return radial * (mode.sine ? Math.sin(angle) : Math.cos(angle));
}
export function modeShape(index, x, z) {
  const preset = MODES[index];
  return basisShape(
    BASIS.findIndex((m) => m.m === preset.m && m.n === preset.n && !m.sine),
    x / WORLD_SCALE,
    z / WORLD_SCALE,
  );
}
export function randomGenerator(seed = 901) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
