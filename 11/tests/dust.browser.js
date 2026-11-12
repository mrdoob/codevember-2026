import { Vector3 } from "three/webgpu";

export async function checkDust(app) {
  const { dust, renderer, camera } = app;
  const empty = { shots: [] };
  const read = async (node) =>
    new Float32Array(await renderer.getArrayBufferAsync(node.value));
  const initialize = () => {
    dust.clear();
    dust.update(renderer, empty, camera);
  };
  initialize();
  const positions = await read(dust.positions);
  const point = new Vector3(...positions.slice(0, 3));
  dust.advance(1 / 60);
  dust.update(renderer, empty, camera);
  const ambient = await read(dust.velocities);
  initialize();
  const moving = {
    shots: [
      {
        z: 0,
        simulation: {
          links: [
            {
              position: [point.x - 0.15, point.y, point.z],
              velocity: [3, 0, 0],
            },
          ],
          fragments: [],
        },
      },
    ],
  };
  dust.advance(1 / 60);
  dust.update(renderer, moving, camera);
  const wake = await read(dust.velocities);
  if (!wake.every(Number.isFinite) || wake[0] - ambient[0] < 0.08)
    throw new Error("Moving links must accelerate nearby GPU dust");
  initialize();
  dust.burst(new Vector3(point.x - 0.3, point.y, point.z));
  dust.advance(1 / 60);
  dust.update(renderer, empty, camera);
  const shock = await read(dust.velocities);
  if (!shock.every(Number.isFinite) || shock[0] - ambient[0] < 0.08)
    throw new Error("Fractures must push GPU dust outward");
  initialize();
  const rotating = {
    shots: [
      {
        z: 0,
        simulation: {
          links: [],
          fragments: [],
          mine: {
            position: [point.x - 1.7, point.y, point.z],
            velocity: [0, 0, 0],
            angularVelocity: [0, 0, 2],
          },
        },
      },
    ],
  };
  dust.advance(1 / 60);
  dust.update(renderer, rotating, camera);
  const spin = await read(dust.velocities);
  if (spin[1] - ambient[1] < 0.05)
    throw new Error("Rotation must stir water tangentially around the shell");
  dust.advance(0.16);
  dust.update(renderer, rotating, camera);
  const beforeWake = await read(dust.velocities);
  dust.advance(1 / 60);
  dust.update(renderer, empty, camera);
  const afterWake = await read(dust.velocities);
  if (dust.trailCount !== 2 || afterWake[1] <= beforeWake[1])
    throw new Error(
      "Detached eddies must continue driving the water after the mine leaves",
    );
  dust.advance(4.3);
  dust.update(renderer, empty, camera);
  if (
    dust.trailCount !== 0 ||
    !(await read(dust.positions)).every(Number.isFinite)
  )
    throw new Error("Old wakes expire and particle positions remain finite");
  initialize();
  return {
    particles: dust.mesh.geometry.instanceCount,
    wake: wake[0] - ambient[0],
    shock: shock[0] - ambient[0],
    spin: spin[1] - ambient[1],
    lingeringWake: afterWake[1] - beforeWake[1],
  };
}
