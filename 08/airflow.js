import {
  HalfFloatType,
  Storage3DTexture,
  StorageTexture3DNode,
} from "three/webgpu";
import {
  Fn,
  If,
  float,
  instanceIndex,
  ivec3,
  vec3,
  vec4,
  uniform,
  texture3D,
  textureStore,
} from "three/tsl";
import {
  FLOOR_Y,
  CEILING_Y,
  CEILING_FIXTURE_DEPTH,
  COLUMN_LOCATIONS,
} from "./room-layout.js";

export const AIR_GRID_SIZE = [32, 16, 32];
export const AIR_MIN = [-8.5, FLOOR_Y + 0.1, -8.4];
export const AIR_MAX = [8.5, CEILING_Y - CEILING_FIXTURE_DEPTH - 0.1, 9.4];
export const PRESSURE_ITERATIONS = 20;

// A small incompressible flow solver with velocities on cell faces (MAC):
// semi-Lagrangian advection,
// external circulation, vorticity confinement, and a pressure projection.
// Room boundaries and columns are fixed obstacles; tubes are not inputs.
export function createAirflow() {
  const [nx, ny, nz] = AIR_GRID_SIZE,
    count = nx * ny * nz;
  const minimum = vec3(...AIR_MIN),
    extent = vec3(...AIR_MAX.map((v, i) => v - AIR_MIN[i]));
  const size = vec3(nx, ny, nz),
    cell = extent.div(size),
    inverseCell = cell.reciprocal();
  const weights = inverseCell.mul(inverseCell),
    denominator = weights.dot(vec3(2));
  const step = uniform(1 / 30),
    clock = uniform(0),
    turbulence = uniform(0.65);
  const textures = [],
    kernels = [];
  function grid(name) {
    const texture = new Storage3DTexture(nx, ny, nz);
    texture.type = HalfFloatType;
    texture.name = name;
    textures.push(texture);
    return {
      texture,
      read: texture3D(texture),
      write: new StorageTexture3DNode(texture),
    };
  }
  const velocity = grid("Air velocity"),
    advected = grid("Advected air");
  const pressure = [grid("Air pressure A"), grid("Air pressure B")];
  const divergence = grid("Air divergence"),
    curl = grid("Air curl");
  const coord = () =>
    ivec3(
      instanceIndex.mod(nx),
      instanceIndex.div(nx).mod(ny),
      instanceIndex.div(nx * ny),
    );
  const world = (c) => vec3(c).add(0.5).mul(cell).add(minimum);
  const load = (g, c) =>
    g.read.load(c.clamp(ivec3(0), ivec3(nx - 1, ny - 1, nz - 1))).level(0);
  const fluid = Fn(
    ({ c }) => {
      const p = world(c);
      const valid = c
        .greaterThanEqual(ivec3(0))
        .all()
        .and(c.lessThan(ivec3(nx, ny, nz)).all())
        .toVar();
      for (const [x, z] of COLUMN_LOCATIONS) {
        valid.assign(
          valid.and(
            p.x
              .sub(x)
              .abs()
              .lessThan(0.5)
              .and(p.z.sub(z).abs().lessThan(0.5))
              .not(),
          ),
        );
      }
      return valid;
    },
    { c: "ivec3", return: "bool" },
  );
  const offsets = [ivec3(1, 0, 0), ivec3(0, 1, 0), ivec3(0, 0, 1)];
  const sampleVelocity = (g, c) => fluid({ c }).select(load(g, c).xyz, vec3(0));
  const sampleFlow = (g, p) => {
    const uv = p.sub(minimum).div(extent);
    return vec3(
      ...offsets.map((d, i) =>
        g.read
          .sample(uv.sub(vec3(d).div(size).mul(0.5)))
          .level(0)
          .element(i),
      ),
    );
  };
  const centeredVelocity = (g, c) =>
    vec3(
      ...offsets.map((d, i) =>
        sampleVelocity(g, c)
          .element(i)
          .add(sampleVelocity(g, c.sub(d)).element(i))
          .mul(0.5),
      ),
    );
  function boundary(v, c) {
    return vec3(
      ...offsets.map((d, i) =>
        fluid({ c: c.add(d) }).select(v.element(i), float(0)),
      ),
    );
  }
  function circulation(p) {
    const q = p.mul(0.47),
      t = clock.mul(0.08);
    const large = vec3(
      q.z.add(t).sin().sub(q.y.cos()),
      q.x.sin().sub(q.z.sub(t.mul(0.7)).cos()),
      q.y
        .add(t.mul(0.8))
        .sin()
        .sub(q.x.add(t.mul(0.6)).cos()),
    );
    const small = vec3(
      p.z.mul(1.4).sub(t).sin(),
      p.x.mul(1.2).add(t).sin(),
      p.y.mul(1.6).sub(t).cos(),
    );
    return large
      .mul(0.12)
      .add(small.mul(turbulence).mul(0.045))
      .add(vec3(p.z.negate(), 0, p.x).mul(0.012));
  }
  function kernel(name, body) {
    const node = Fn(() => {
      If(instanceIndex.lessThan(count), () => body(coord()));
    })()
      .compute(count)
      .setName(name);
    kernels.push(node);
    return node;
  }
  const initialize = kernel("Air reset", (c) => {
    const initial = vec3(
      ...offsets.map((d, i) =>
        circulation(world(c).add(vec3(d).mul(cell).mul(0.5))).element(i),
      ),
    );
    const v = fluid({ c }).select(boundary(initial, c), vec3(0));
    for (const g of [velocity, advected]) textureStore(g.write, c, vec4(v, 1));
    for (const g of pressure) textureStore(g.write, c, vec4(0));
  });
  const calculateCurl = kernel("Air vorticity", (c) => {
    const dx = centeredVelocity(velocity, c.add(offsets[0]))
      .sub(centeredVelocity(velocity, c.sub(offsets[0])))
      .mul(inverseCell.x)
      .mul(0.5);
    const dy = centeredVelocity(velocity, c.add(offsets[1]))
      .sub(centeredVelocity(velocity, c.sub(offsets[1])))
      .mul(inverseCell.y)
      .mul(0.5);
    const dz = centeredVelocity(velocity, c.add(offsets[2]))
      .sub(centeredVelocity(velocity, c.sub(offsets[2])))
      .mul(inverseCell.z)
      .mul(0.5);
    const omega = fluid({ c }).select(
      vec3(dy.z.sub(dz.y), dz.x.sub(dx.z), dx.y.sub(dy.x)),
      vec3(0),
    );
    textureStore(curl.write, c, vec4(omega, omega.length()));
  });
  const advect = kernel("Air advection and forces", (c) => {
    const result = vec3(0).toVar();
    If(fluid({ c }), () => {
      const current = load(velocity, c).xyz,
        p = world(c);
      const gradient = vec3(
        ...offsets.map((d, i) =>
          load(curl, c.add(d))
            .w.sub(load(curl, c.sub(d)).w)
            .mul(inverseCell.element(i))
            .mul(0.5),
        ),
      );
      const confinement = gradient
        .div(gradient.length().max(0.0001))
        .cross(load(curl, c).xyz)
        .mul(turbulence)
        .mul(0.12);
      const v = vec3(
        ...offsets.map((d, i) => {
          const face = p.add(vec3(d).mul(cell).mul(0.5));
          const back = face
            .sub(sampleFlow(velocity, face).mul(step))
            .sub(minimum)
            .div(extent)
            .clamp(vec3(0.5).div(size), size.sub(0.5).div(size));
          const traced = ivec3(back.mul(size));
          const transported = fluid({ c: traced }).select(
            velocity.read
              .sample(back.sub(vec3(d).div(size).mul(0.5)))
              .level(0)
              .element(i),
            current.element(i),
          );
          const force = circulation(face)
            .element(i)
            .mul(0.22)
            .add(confinement.element(i));
          return transported.mul(step.mul(-0.22).exp()).add(force.mul(step));
        }),
      );
      result.assign(boundary(v, c));
    });
    textureStore(advected.write, c, vec4(result, 1));
  });
  const calculateDivergence = kernel("Air divergence", (c) => {
    const value = float(0).toVar();
    for (let i = 0; i < 3; i++)
      value.addAssign(
        sampleVelocity(advected, c)
          .element(i)
          .sub(sampleVelocity(advected, c.sub(offsets[i])).element(i))
          .mul(inverseCell.element(i)),
      );
    textureStore(
      divergence.write,
      c,
      vec4(fluid({ c }).select(value, 0), 0, 0, 0),
    );
  });
  function pressureStep(source, target) {
    return kernel("Air pressure relaxation", (c) => {
      const sum = float(0).toVar(),
        center = load(source, c).x;
      for (let i = 0; i < 3; i++)
        for (const sign of [-1, 1]) {
          const n = c.add(offsets[i].mul(sign));
          sum.addAssign(
            fluid({ c: n })
              .select(load(source, n).x, center)
              .mul(weights.element(i)),
          );
        }
      const p = sum.sub(load(divergence, c).x).div(denominator);
      textureStore(target.write, c, vec4(fluid({ c }).select(p, 0), 0, 0, 0));
    });
  }
  const relax = [
    pressureStep(pressure[0], pressure[1]),
    pressureStep(pressure[1], pressure[0]),
  ];
  const clearPressure = kernel("Air pressure clear", (c) => {
    for (const g of pressure) textureStore(g.write, c, vec4(0));
  });
  const project = kernel("Air pressure projection", (c) => {
    const center = load(pressure[0], c).x;
    const gradient = vec3(
      ...offsets.map((d, i) => {
        const p = c.add(d);
        return fluid({ c: p })
          .select(load(pressure[0], p).x, center)
          .sub(center)
          .mul(inverseCell.element(i));
      }),
    );
    const corrected = load(advected, c).xyz.sub(gradient);
    textureStore(
      velocity.write,
      c,
      vec4(fluid({ c }).select(boundary(corrected, c), vec3(0)), 1),
    );
  });
  // Solve the pressure impulse (dt * pressure) with matching face operators.
  const projection = [
    calculateDivergence,
    clearPressure,
    ...Array.from({ length: PRESSURE_ITERATIONS }, (_, i) => relax[i % 2]),
    project,
  ];
  let lastTime = null,
    initialized = false,
    updates = 0;
  return {
    velocityTexture: velocity.texture,
    advectedTexture: advected.texture,
    count,
    sample(position) {
      return sampleFlow(velocity, position);
    },
    get updates() {
      return updates;
    },
    update(time, settings, renderer) {
      const elapsed = lastTime === null ? 0 : time - lastTime;
      lastTime = time;
      clock.value = time;
      turbulence.value = settings.airTurbulence;
      if (!settings.particles) {
        initialized = false;
        return;
      }
      if (!initialized || elapsed < 0 || elapsed > 0.2) {
        step.value = 1 / 30;
        renderer.compute([initialize, ...projection]);
        initialized = true;
        updates++;
      } else if (elapsed > 0) {
        step.value = Math.min(elapsed, 0.1);
        renderer.compute([calculateCurl, advect, ...projection]);
        updates++;
      }
    },
    reset() {
      initialized = false;
    },
    dispose() {
      kernels.forEach((k) => k.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
