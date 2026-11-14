import { Vector3, Quaternion, Euler } from 'three/webgpu';
import { createItinerary } from './maze.js';
import { createNavigationControls } from './navigation-controls.js';
import { moveThroughMaze, dampedMotion } from './movement.js';
import { createFlightProfile } from './flight.js';
import { createCameraRoute } from './camera-route.js';

export function createJourney(maze, camera, canvas, settings, changed) {
  const itinerary = createItinerary();
  const track = createCameraRoute(itinerary.points, maze.clearance);
  const length = track.length, opening = track.segments[0].length;
  const at = (d, out = new Vector3()) => track.at(d, out);
  const tangent = (d, out = new Vector3()) => track.tangent(d, out);
  let distance = opening, mode = 'automatic';
  let yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0, velocityX = 0, velocityZ = 0;
  const position = new Vector3(), direction = new Vector3();
  const previousPosition = new Vector3(), previousRotation = new Quaternion(), look = new Euler(0, 0, 0, 'YXZ');
  const flight = createFlightProfile(length, d => tangent(d, direction));
  function stop() { velocityX = velocityZ = 0; }
  function takeControl(resume = false) {
    if (mode === 'automatic') {
      // Preserve the visible pose exactly when switching to manual navigation.
      mode = 'manual'; position.copy(camera.position); look.setFromQuaternion(camera.quaternion, 'YXZ');
      yaw = targetYaw = look.y; pitch = targetPitch = look.x; stop();
      changed();
    }
    if (resume) settings.paused = false;
  }
  const controls = createNavigationControls(canvas, {
    takeControl, stop, changed,
    look(dx, dy) {
      targetYaw -= dx * .003; targetPitch = Math.max(-.8, Math.min(.9, targetPitch - dy * .003));
    },
  });
  function updateStep(dt) {
    const smoothing = 1 - Math.exp(-dt * 9);
    if (mode === 'automatic') {
      if (!settings.paused && dt > 0) distance = flight.advance(distance, dt, settings.speed);
      at(distance, position);
      const height = maze.height(position.x, position.z) + settings.height;
      position.y = dt === 0 ? height : camera.position.y + (height - camera.position.y) * (1 - Math.exp(-dt * 3.5));
      camera.position.copy(position);
      // Mouse drag adds a user-controlled offset to the route heading. It
      // leaves the flight running; reset clears the offset and faces forward.
      yaw += (targetYaw - yaw) * smoothing; pitch += (targetPitch - pitch) * smoothing;
      look.set(-.02 + pitch, flight.headingAt(distance) + yaw, 0); camera.quaternion.setFromEuler(look);
    } else {
      const input = controls.sample();
      if (!settings.paused) targetYaw += input.turn * 1.65 * dt;
      yaw += (targetYaw - yaw) * smoothing; pitch += (targetPitch - pitch) * smoothing;
      if (!settings.paused) {
        const speed = settings.walkSpeed;
        const x = (-Math.sin(yaw) * input.forward + Math.cos(yaw) * input.strafe) * speed;
        const z = (-Math.cos(yaw) * input.forward - Math.sin(yaw) * input.strafe) * speed;
        const rate = input.forward || input.strafe ? 8 : 18;
        const mx = dampedMotion(velocityX, x, rate, dt), mz = dampedMotion(velocityZ, z, rate, dt);
        velocityX = mx.velocity; velocityZ = mz.velocity;
        moveThroughMaze(maze, position, mx.distance, mz.distance);
      } else stop();
      const height = maze.height(position.x, position.z) + settings.height;
      position.y += (height - position.y) * (1 - Math.exp(-dt * 5));
      camera.position.copy(position); look.set(pitch, yaw, 0); camera.quaternion.setFromEuler(look);
    }
    camera.updateMatrixWorld();
  }
  function update(dt) {
    previousPosition.copy(camera.position); previousRotation.copy(camera.quaternion);
    // Bounded simulation steps keep turning and collision behavior stable even
    // during slow frames or deterministic, multi-second browser checks.
    if (dt === 0) updateStep(0);
    else { const steps = Math.ceil(dt * 90); for (let i = 0; i < steps; i++) updateStep(dt / steps); }
    return camera.position.distanceToSquared(previousPosition) > 1e-12 || 1 - Math.abs(camera.quaternion.dot(previousRotation)) > 1e-12;
  }
  function automatic(value) {
    controls.clear(); mode = 'automatic';
    distance = ((value % length) + length) % length; yaw = pitch = targetYaw = targetPitch = 0;
    update(0); changed();
  }
  return { track, length, opening, flight, itinerary, at, tangent, update, controls, takeControl,
    get distance() { return distance; }, get mode() { return mode; },
    seek(value) { automatic(value); },
    reset() { automatic(opening); },
    dispose() { controls.dispose(); },
  };
}
