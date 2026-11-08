export const NEON_COLORS = {
  Blue: "#0047ff",
  Green: "#21ff00",
  Purple: "#2400ff",
};
export const COLOR_MODES = ["Multicolor", ...Object.keys(NEON_COLORS)];
export const EDGE_PALETTE = Object.values(NEON_COLORS);

export function tubeColor(index, mode) {
  if (mode !== "Multicolor") return NEON_COLORS[mode] ?? NEON_COLORS.Blue;
  // Distribute the three hues across each group of edges without clustering
  // one color on a single 4D axis.
  return EDGE_PALETTE[
    (index * 5 + Math.floor(index / 8) * 3) % EDGE_PALETTE.length
  ];
}

function random(index, cycle) {
  let n = Math.imul(index + 13, 374761393) ^ Math.imul(cycle + 47, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function tubeBlink(index, seconds, speed = 1) {
  // Independent, irregular outages. Hashing the edge and cycle keeps the
  // pattern reproducible when seeking and independent of rendering frame rate.
  const period = 2.1 + random(index, -1) * 3.7;
  const clock = seconds * speed + random(index, -2) * period;
  const cycle = Math.floor(clock / period),
    phase = clock - cycle * period;
  const duration = period * (0.5 + random(index, cycle * 2) * 0.3);
  const start = 0.15 + random(index, cycle * 2 + 1) * (period - duration - 0.3);
  const end = start + duration;
  return (
    1 - smooth(start, start + 0.06, phase) * (1 - smooth(end - 0.1, end, phase))
  );
}
