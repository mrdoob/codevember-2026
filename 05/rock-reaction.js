import { Quaternion, Vector3 } from 'three/webgpu';
import { randomSeed, smootherstep } from './random.js';

const NUDGE_STRENGTH = 2.25, SPIN_STRENGTH = 4.5;
const SPRING_DECAY = 1.15, SPRING_FREQUENCY = 2.2, PUSH_DECAY = 10;
export const ROCK_REACTION_DURATION = 6;

// Closed-form damped spring driven by a short, exponentially fading push.
// It starts at rest, peaks around 0.6 s, and recoils with ~20% of that motion.
// Normalize the first peak; ease away the tiny tail before retiring a gesture.
function spring(age) {
  const ratio = SPRING_FREQUENCY / (PUSH_DECAY - SPRING_DECAY);
  const oscillation = Math.exp(-SPRING_DECAY * age)
    * (Math.sin(SPRING_FREQUENCY * age) - ratio * Math.cos(SPRING_FREQUENCY * age))
    + ratio * Math.exp(-PUSH_DECAY * age);
  return oscillation * 2.195 * (1 - smootherstep(0, 1, age - ROCK_REACTION_DURATION + 1));
}

// Evaluate against animation time so playback and offline capture agree.
export function createRockReaction(scale) {
  const offset = new Vector3(), tilt = new Vector3(), gestures = [];
  const lever = new Vector3(), force = new Vector3(), torque = new Vector3();
  const rotation = new Quaternion(), axis = new Vector3();
  const seed = 5052026 ^ Math.round(scale * 1000000);
  let random = randomSeed(seed);
  let lastTime = 0, lastPress = -Infinity;
  function reset(time = 0) {
    offset.set(0, 0, 0); tilt.set(0, 0, 0); gestures.length = 0;
    lastTime = time; lastPress = -Infinity;
    random = randomSeed(seed);
  }
  const soften = (vector, limit) => {
    const length = vector.length();
    if (length > 0) vector.multiplyScalar(limit * Math.tanh(length / limit) / length);
  };
  function update(time) {
    if (time < lastTime) { reset(time); return; }
    offset.set(0, 0, 0); tilt.set(0, 0, 0);
    for (let i = gestures.length - 1; i >= 0; i--) {
      const gesture = gestures[i], age = time - gesture.time;
      if (age >= ROCK_REACTION_DURATION) { gestures.splice(i, 1); continue; }
      const weight = spring(age);
      offset.addScaledVector(gesture.offset, weight);
      tilt.addScaledVector(gesture.tilt, weight);
    }
    // Repeated presses blend smoothly, without a hard clamp or a position jump.
    soften(offset, .28); soften(tilt, .26);
    offset.multiplyScalar(NUDGE_STRENGTH); tilt.multiplyScalar(SPIN_STRENGTH);
    lastTime = time;
  }
  return { offset, tilt, reset, update,
    kick(point, direction, center, time) {
      update(time);
      if (time - lastPress < .16) return;
      lastPress = time;
      const response = Math.min(1.45, Math.pow(.7 / scale, .25));
      force.copy(direction).normalize().multiplyScalar(.16 * response);
      force.y = .10 * response;
      lever.subVectors(point, center);
      torque.crossVectors(lever, force).multiplyScalar(.55 / (scale + .3));
      // Y remains the main spin; each press adds a little varied pitch/roll.
      // Sample once per gesture, with a resettable seed for repeatable playback.
      const yaw = torque.y;
      const wobble = .016 * response;
      torque.set((random() * 2 - 1) * wobble,
        Math.sign(yaw || 1) * Math.min(.2, Math.abs(yaw) + .08 * response),
        (random() * 2 - 1) * wobble);
      gestures.push({ time, offset: force.clone(), tilt: torque.clone() });
    },
    apply(pivot, time) {
      update(time);
      pivot.position.add(offset);
      const angle = tilt.length();
      if (angle > 1e-8) {
        rotation.setFromAxisAngle(axis.copy(tilt).multiplyScalar(1 / angle), angle);
        pivot.quaternion.premultiply(rotation);
      }
    }
  };
}
