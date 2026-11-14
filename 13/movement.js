// The hedge's foliage projects beyond its traced core. Include that envelope
// and the camera near plane in the walking radius.
export const WALK_RADIUS = .52;

export function moveThroughMaze(maze, position, dx, dz, radius = WALK_RADIUS) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .075));
  const sx = dx / steps, sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    if (maze.clearance(position.x + sx, position.z + sz) >= radius) {
      position.x += sx; position.z += sz;
    } else {
      // Resolve each axis independently to slide along the hedge at corners.
      if (maze.clearance(position.x + sx, position.z) >= radius) position.x += sx;
      if (maze.clearance(position.x, position.z + sz) >= radius) position.z += sz;
    }
  }
}

// Integrate exponential acceleration analytically, including distance traveled.
// Input acceleration is consistent at different render frame rates.
export function dampedMotion(current, target, rate, dt) {
  const decay = Math.exp(-rate * dt);
  return { velocity: target + (current - target) * decay,
    distance: target * dt + (current - target) * (1 - decay) / rate };
}

export function joystickAxes(dx, dy, radius = 46) {
  const length = Math.hypot(dx, dy), raw = Math.min(1, length / radius);
  if (raw <= .12) return { x: 0, y: 0 };
  const strength = Math.pow((raw - .12) / .88, 1.25);
  return { x: dx / length * strength, y: dy / length * strength };
}
