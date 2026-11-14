// Validate the complete camera route without drawing tens of thousands of frames.
export async function checkFlight(app = window.labyrinth) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const { journey, maze, settings, camera } = app, capture = app.manual, saved = { ...settings };
  app.manual = true; settings.paused = false;
  try {
    app.reset();
    assert(maze.clearance(camera.position.x, camera.position.z) < 1.4, 'The opening is outside a narrow passage');
    const forward = journey.tangent(journey.opening);
    for (let offset = 0; offset <= 6; offset += 1) {
      const p = journey.at(journey.opening + offset);
      // A side junction can briefly increase clearance without leaving the passage.
      assert(maze.clearance(p.x, p.z) < 1.65 && journey.tangent(journey.opening + offset).dot(forward) > .99, 'The opening does not face along a passage');
    }
    const openingLight = app.lighting.lamps[0].light.position.clone().sub(camera.position); openingLight.y = 0;
    assert(openingLight.length() < 8 && openingLight.normalize().dot(forward) > .9, 'The opening corridor has no light ahead');
    const { flight, length } = journey, speed = 2.4, duration = flight.duration(speed), dt = 1 / 30;
    let openingDistance = journey.opening, clearingArrival;
    for (let time = 0; time < 30; time += dt) {
      const p = journey.at(openingDistance);
      if (Math.abs(p.x) < 6.4 && Math.abs(p.z) < 26.88) { clearingArrival = time; break; }
      openingDistance = flight.advance(openingDistance, dt, speed);
    }
    assert(clearingArrival !== undefined, 'The opening does not reach the central clearing promptly');
    let distance = 0, previousSpeed, maxTurn = 0, maxAcceleration = 0, samples = 0, maxAimError = 0;
    for (let time = 0; time < duration; time += dt) {
      const next = flight.advance(distance, dt, speed), velocity = ((next - distance + length) % length) / dt;
      const delta = flight.headingAt(next) - flight.headingAt(distance);
      maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) / dt);
      if (previousSpeed !== undefined) maxAcceleration = Math.max(maxAcceleration, Math.abs(velocity - previousSpeed) / dt);
      distance = next; previousSpeed = velocity; samples++;
    }
    assert(maxTurn < .63, `Abrupt turn: ${maxTurn * 180 / Math.PI} degrees/second`);
    assert(maxAcceleration < .66, `Abrupt speed change: ${maxAcceleration}`);
    const view = forward.clone();
    for (let d = 0; d < length; d += .1) {
      journey.seek(d); const q = camera.quaternion;
      const actual = journey.at(d + .001).sub(journey.at(d - .001)).normalize();
      camera.getWorldDirection(view); view.y = 0; view.normalize();
      maxAimError = Math.max(maxAimError, view.angleTo(actual));
      const upX = 2 * (q.x * q.y - q.z * q.w);
      const upZ = 2 * (q.y * q.z + q.x * q.w);
      assert(Math.hypot(upX, upZ) < .021, 'Automatic flight tilted or rolled away from its fixed pitch');
    }
    assert(maxAimError < 1e-5, `Camera looks away from movement by ${maxAimError * 180 / Math.PI} degrees`);
    assert(!('grain' in settings) && !('grain' in app.post), 'Film grain is still connected');
    return { passed: true, samples, durationSeconds: duration, clearingArrivalSeconds: clearingArrival, maxTurnDegreesPerSecond: maxTurn * 180 / Math.PI, maxAcceleration, maxAimErrorDegrees: maxAimError * 180 / Math.PI };
  } finally { Object.assign(settings, saved); app.reset(); app.render(); app.manual = capture; }
}
