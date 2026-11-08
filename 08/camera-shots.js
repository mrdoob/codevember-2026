// Shared camera paths for video capture and the interactive view presets.
// Raw capture order; the final edit uses shots 2, 3, 6, 5, 4, 7, 1.
// Paths use quadratic Beziers or a constant-radius orbit without easing at cuts.
export const FPS = 30;
export const SIZE = 1024;
export const DURATION = 70;
export const TOTAL_FRAMES = DURATION * FPS;
export const VIDEO_SHOT_ORDER = [1, 2, 5, 4, 3, 6, 0];

export const SHOTS = [
  {
    name: "Distant orbit",
    start: 0,
    end: 12,
    fov: 52,
    rollDegrees: [0, 0, 0],
    orbit: { radius: 36, height: 0.35, azimuthDegrees: [155, 195] },
    target: [
      [0, 1.125, 0],
      [0, 1.125, 0],
      [0, 1.125, 0],
    ],
  },
  {
    name: "Side tracking",
    start: 12,
    end: 22,
    fov: 48,
    rollDegrees: [0, 0, 0],
    position: [
      [-10.5, -0.5, 12.5],
      [-12.8, 0.1, 9],
      [-13, 0.75, 5],
    ],
    target: [
      [0, 1, 0],
      [0.15, 1.1, 0],
      [0, 1.2, 0],
    ],
  },
  {
    name: "Ceiling light",
    start: 22,
    end: 32,
    fov: 52,
    rollDegrees: [-6, -1, 4],
    position: [
      [5.5, 1.5, 7],
      [6.6, 1.6, 6],
      [7.6, 1.7, 5],
    ],
    target: [
      [0, 6, 0],
      [-0.5, 6, -0.5],
      [-1, 6, -1],
    ],
  },
  {
    name: "Tube detail",
    start: 32,
    end: 40,
    fov: 40,
    rollDegrees: [0, 0, 0],
    position: [
      [5.6, 1.1, 8],
      [6.4, 1.35, 7.5],
      [7, 1.7, 6.5],
    ],
    target: [
      [1.2, 1.2, 0.2],
      [1, 1.45, 0],
      [0.8, 1.6, -0.2],
    ],
  },
  {
    name: "Low reflection pass",
    start: 40,
    end: 50,
    fov: 51,
    rollDegrees: [4, 0, -4],
    position: [
      [7.8, -2.62, 14],
      [2, -2.62, 13.4],
      [-3.8, -2.62, 14],
    ],
    target: [
      [0, 0.1, 0],
      [0, 0.25, 0],
      [0, 0.4, 0],
    ],
  },
  {
    name: "Floor light",
    start: 50,
    end: 60,
    fov: 45,
    rollDegrees: [0, 0, 0],
    position: [
      [-5.5, 2.8, 10.5],
      [-2.8, 2.4, 10],
      [0, 2, 9.8],
    ],
    target: [
      [1.8, -2.98, 1.5],
      [2, -2.98, 2.2],
      [2.3, -2.98, 3],
    ],
  },
  {
    name: "Ceiling-height pullback",
    start: 60,
    end: 70,
    fov: 52,
    rollDegrees: [-5, -1, 3],
    position: [
      [-8.8, 4.8, 12],
      [-11.2, 4.9, 14.5],
      [-13, 5, 17],
    ],
    target: [
      [0, 1.15, 0],
      [0, 1.1, 0],
      [0, 1, 0],
    ],
  },
].map((shot) => ({
  ...shot,
  startFrame: shot.start * FPS,
  frames: (shot.end - shot.start) * FPS,
}));

function quadratic(a, b, c, t) {
  return (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c;
}

function bezier([a, b, c], t) {
  return a.map((value, i) => quadratic(value, b[i], c[i], t));
}

function orbitPosition({ radius, height, azimuthDegrees: [start, end] }, t) {
  const azimuth = ((start + (end - start) * t) * Math.PI) / 180;
  return [radius * Math.sin(azimuth), height, radius * Math.cos(azimuth)];
}

export function frameAt(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= TOTAL_FRAMES) {
    throw new RangeError("Frame must be within the capture sequence");
  }
  const time = frame / FPS;
  const shot = SHOTS.find((shot) => time < shot.end);
  const progress = (time - shot.start) / (shot.end - shot.start);
  const rollProgress = Math.min(
    1,
    (time - shot.start) / (shot.rollDuration ?? shot.end - shot.start),
  );
  return {
    frame,
    time,
    shot: shot.name,
    fov: shot.fov,
    roll: (quadratic(...shot.rollDegrees, rollProgress) * Math.PI) / 180,
    position: shot.orbit
      ? orbitPosition(shot.orbit, progress)
      : bezier(shot.position, progress),
    target: bezier(shot.target, progress),
  };
}
