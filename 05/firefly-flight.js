import { Vector3 } from 'three/webgpu';
import { rockPositionAt } from './floating-rocks.js';
import { smoothstep } from './random.js';

const STEP = 1 / 60;

// Each insect pursues the moss with its own delayed perception and momentum.
// This steers a world-space flight center; free wandering is added by fireflies.js.
export function createMossFlight(layout, random) {
  const home = { ...layout, center: [...layout.center] };
  const delay = (.45 + random() * 1.15) / STEP;
  const response = 1.4 + random() * .8, maxSpeed = .7 + random() * .65;
  const maxAcceleration = 1.1 + random() * 1.1, noticeDistance = .04 + random() * .09;
  const historyLength = Math.ceil(delay) + 2, history = new Float64Array(historyLength * 3);
  const position = new Vector3(), previous = new Vector3(), velocity = new Vector3();
  const target = new Vector3(), perceived = new Vector3(), acceleration = new Vector3();
  const previousOffset = new Vector3(), offset = new Vector3();
  let step = 0, lastTime = 0;

  function reset() {
    rockPositionAt(home, 0, position); previous.copy(position); velocity.set(0, 0, 0);
    previousOffset.set(0, 0, 0); step = 0; lastTime = 0;
    for (let i = 0; i < historyLength; i++) position.toArray(history, i * 3);
  }
  reset();

  return {
    sample(time, rockOffset, out) {
      if (time < lastTime) reset();
      const endStep = Math.ceil(time / STEP);
      while (step < endStep) {
        previous.copy(position);
        step++;
        const at = step * STEP;
        // Interpolate newly observed nudges across the fixed simulation steps.
        // Rock ascent/bobbing can be sampled exactly at any simulation time.
        const blend = time === lastTime ? 1 : Math.min(1, (at - lastTime) / (time - lastTime));
        offset.lerpVectors(previousOffset, rockOffset, Math.max(0, blend));
        rockPositionAt(home, at, target).add(offset);
        target.toArray(history, (step % historyLength) * 3);
        const observation = Math.max(0, step - delay), before = Math.floor(observation);
        perceived.fromArray(history, (before % historyLength) * 3);
        target.fromArray(history, ((before + 1) % historyLength) * 3);
        perceived.lerp(target, observation - before);
        acceleration.subVectors(perceived, position);
        const distance = acceleration.length();
        // Small movements need not interrupt an insect's wandering. A larger
        // separation gradually draws its attention; there is no snapping.
        acceleration.multiplyScalar(response * response * smoothstep(noticeDistance, noticeDistance + .16, distance));
        acceleration.addScaledVector(velocity, -2 * response);
        acceleration.clampLength(0, maxAcceleration);
        velocity.addScaledVector(acceleration, STEP).clampLength(0, maxSpeed);
        position.addScaledVector(velocity, STEP);
      }
      lastTime = time; previousOffset.copy(rockOffset);
      const alpha = step === 0 ? 1 : Math.max(0, Math.min(1, time / STEP - step + 1));
      return out.lerpVectors(previous, position, alpha);
    }
  };
}
