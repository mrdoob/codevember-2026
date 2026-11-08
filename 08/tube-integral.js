// CPU reference for the shader's diffuse cylindrical line integral.
// Kept independent of the renderer for numerical integration tests.
export function cosineLineIntegral(start, end) {
  let p = [...start],
    q = [...end];
  if (p[2] <= 0 && q[2] <= 0) return 0;
  const delta = q.map((x, i) => x - p[i]);
  const length = Math.hypot(...delta);
  if (length < 1e-8) return 0;
  const axis = delta.map((x) => x / length);
  if (p[2] < 0) p = p.map((x, i) => (x * q[2] - q[i] * p[2]) / (q[2] - p[2]));
  if (q[2] < 0) q = q.map((x, i) => (x * p[2] - p[i] * q[2]) / (p[2] - q[2]));
  const dot = (a) => a.reduce((sum, x, i) => sum + x * axis[i], 0);
  const l1 = dot(p),
    l2 = dot(q),
    closest = p.map((x, i) => x - l1 * axis[i]);
  const d = Math.hypot(...closest);
  if (d <= 1e-4) return 0;
  const po = (l) => l / (d * (d * d + l * l)) + Math.atan(l / d) / (d * d);
  const wt = (l) => (l * l) / (d * (d * d + l * l));
  return Math.max(
    0,
    ((po(l2) - po(l1)) * closest[2] + (wt(l2) - wt(l1)) * axis[2]) / Math.PI,
  );
}
