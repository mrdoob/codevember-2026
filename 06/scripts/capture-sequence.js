import {
  Clockwork,
  PLANETS,
  PINION_TEETH,
  TAU,
  orbitAngle,
} from "../motion.js";

export const FPS = 30;
export const DURATION = 60;
export const LIGHTING = {
  nightStart: 30,
  nightEnd: 35,
  dayStart: 54,
  dayEnd: 59,
};
export const SHOTS = [
  { start: 0, end: 8, name: "Day · instrument" },
  { start: 8, end: 17, name: "Day · base" },
  { start: 17, end: 29, name: "Day · overhead turns" },
  { start: 29, end: 40, name: "Night · reverse" },
  { start: 40, end: 51, name: "Night · low-angle planet turns" },
  { start: 51, end: 60, name: "Return to daylight" },
];
export const TURNS = [
  { start: 18.5, duration: 2.8, planet: 4, delta: 5 },
  { start: 23, duration: 3.2, planet: 1, delta: -10 },
  { start: 36, duration: 3, planet: 2, delta: 4 },
  { start: 42, duration: 3.6, planet: 4, delta: -12 },
  { start: 47.5, duration: 3, planet: 3, delta: -8 },
];
const HERO = [19.6, 0.17, 5.15];
const BASE = [9.6, 0.38, 1.25];
const OVERHEAD = [17.6, 0.62, 4.2];
const NIGHT = [19.3, 0.22, 5.15];
const NIGHT_CLOSE = [14.5, -0.12, 5.35];
const FRAMINGS = [HERO, BASE, OVERHEAD, NIGHT, NIGHT_CLOSE, HERO];

export function smootherstep(start, end, t) {
  const x = Math.max(0, Math.min(1, (t - start) / (end - start)));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// A closed drive path: ordinary forward motion plus five manual turns.
// The rewinds exactly balance the 21 radians of automatic drive. The native
// Clockwork spring below gives the same following lag as dragging a planet.
export function targetClockAt(time) {
  return (
    8 +
    0.35 * time +
    TURNS.reduce(
      (sum, turn) =>
        sum +
        turn.delta *
          smootherstep(turn.start, turn.start + turn.duration, time),
      0,
    )
  );
}

export function dragIndicatorAt(time) {
  const turn = TURNS.find(
    (turn) => time >= turn.start && time < turn.start + turn.duration + 0.3,
  );
  if (!turn) return null;
  const end = turn.start + turn.duration;
  const release = smootherstep(end, end + 0.3, time);
  const planet = PLANETS[turn.planet];
  // Follow the authored pointer target, ahead of the eased globe, exactly as
  // the live drag does. Hold the last target briefly while the ring fades out.
  const angle = orbitAngle(turn.planet, targetClockAt(Math.min(time, end)));
  return {
    planet: turn.planet,
    position: [
      Math.cos(angle) * planet.orbit,
      planet.height,
      -Math.sin(angle) * planet.orbit,
    ],
    opacity: 0.9 * (1 - release),
    radius:
      15 +
      (1 - smootherstep(turn.start, turn.start + 0.16, time)) * 5 +
      release * 5,
  };
}

export function poseAt(time) {
  const t = ((time % DURATION) + DURATION) % DURATION;
  const index = SHOTS.findIndex((shot) => t >= shot.start && t < shot.end);
  // Cut instantly between views. The base close-up also rises gently while
  // orbiting, keeping the same distance and focal point on the instrument.
  const [distance, fixedElevation, targetY] = FRAMINGS[index];
  const elevation =
    index === 1
      ? 0.24 + 0.28 * smootherstep(SHOTS[1].start, SHOTS[1].end, t)
      : fixedElevation;
  const azimuth = 0.22 - (TAU * t) / DURATION;
  const radius = distance * Math.cos(elevation);
  const daylight =
    1 -
    smootherstep(LIGHTING.nightStart, LIGHTING.nightEnd, t) +
    smootherstep(LIGHTING.dayStart, LIGHTING.dayEnd, t);
  return {
    time: t,
    azimuth,
    daylight,
    nightSelected: t >= LIGHTING.nightStart && t < LIGHTING.dayStart,
    position: [
      Math.sin(azimuth) * radius,
      targetY + distance * Math.sin(elevation),
      Math.cos(azimuth) * radius,
    ],
    target: [0, targetY, 0],
    // A periodic wind clock preserves both position and velocity at the join.
    wind: (DURATION / TAU) * Math.sin((TAU * t) / DURATION),
    turn: TURNS.find(
      (turn) => t >= turn.start && t < turn.start + turn.duration,
    ),
    shot: SHOTS[index].name,
  };
}

export function createSequence() {
  const count = DURATION * FPS,
    clock = new Clockwork(),
    frames = [];
  clock.paused = true;
  clock.clock = targetClockAt(0);
  // Three cheap CPU cycles establish a periodic spring solution. Rendering
  // then uses these states directly, so encoder speed cannot alter the motion.
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let frame = 0; frame < count; frame++) {
      const t = frame / FPS;
      clock.targetClock = targetClockAt(t);
      clock.advance(1 / FPS);
      if (cycle === 2) frames.push({ ...poseAt(t), clock: clock.clock });
    }
  }
  return {
    frames,
    turns: TURNS.map((turn) => ({
      ...turn,
      name: PLANETS[turn.planet].name,
      planetDegrees:
        (((turn.delta * PINION_TEETH) / PLANETS[turn.planet].teeth) * 180) /
        Math.PI,
    })),
  };
}

export function applyFrame(app, frame) {
  const { camera, controls, settings, clock, model, studio, glass } = app;
  camera.position.fromArray(frame.position);
  controls.target.fromArray(frame.target);
  controls.update(0);
  camera.updateMatrixWorld();
  clock.clock = frame.clock;
  model.update(clock.clock);
  model.group.updateMatrixWorld(true);
  studio.foliage.time.value = frame.wind;
  settings.daylight = frame.daylight;
  settings.sunGlow = 7 + (3.2 - 7) * frame.daylight;
  settings.planetGlow = (1 - frame.daylight) * 0.15;
  for (let i = 0; i < model.planets.length; i++) {
    const data = model.planets[i].body.userData;
    data.isHovered = false;
    data.isDragged = frame.turn?.planet === i;
  }
  glass.advance(1 / FPS);
  document
    .querySelector("#day-light")
    .setAttribute("aria-pressed", String(!frame.nightSelected));
  document
    .querySelector("#night-light")
    .setAttribute("aria-pressed", String(frame.nightSelected));
}
