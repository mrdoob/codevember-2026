import {
  HalfFloatType,
  Storage3DTexture,
  StorageTexture3DNode,
  Vector3,
  Vector4,
} from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  instanceIndex,
  uvec3,
  vec3,
  vec4,
  uniformArray,
  texture3D,
  textureStore,
} from "three/tsl";
import { FLOOR_Y, CEILING_Y, CEILING_FIXTURE_DEPTH } from "./room-layout.js";

export const LIGHT_GRID_SIZE = [48, 24, 48];
export const LIGHT_GRID_MIN = [-8.5, FLOOR_Y, -8.5];
export const LIGHT_GRID_MAX = [8.5, CEILING_Y - CEILING_FIXTURE_DEPTH, 9.5];
export const DUST_LIGHT_FADE_START = 0.75;
export const DUST_LIGHT_CUTOFF = 2.5;

// Cache tube irradiance in world space. Its cost depends on grid resolution,
// not dust count. Each particle only needs one trilinear texture lookup.
// A local falloff keeps dust illumination close to the moving neon tubes.
export function createTubeField(lights) {
  const starts = lights.map(() => new Vector4()),
    ends = lights.map(() => new Vector3());
  const colors = lights.map(() => new Vector3());
  const a = uniformArray(starts),
    b = uniformArray(ends),
    radiance = uniformArray(colors);
  const [nx, ny, nz] = LIGHT_GRID_SIZE,
    voxelCount = nx * ny * nz;
  const minimum = vec3(...LIGHT_GRID_MIN);
  const extent = vec3(...LIGHT_GRID_MAX.map((v, i) => v - LIGHT_GRID_MIN[i]));
  const texture = new Storage3DTexture(nx, ny, nz);
  texture.type = HalfFloatType;
  texture.name = "Tube irradiance";
  const target = new StorageTexture3DNode(texture);
  const compute = Fn(() => {
    If(instanceIndex.lessThan(voxelCount), () => {
      const coord = uvec3(
        instanceIndex.mod(nx),
        instanceIndex.div(nx).mod(ny),
        instanceIndex.div(nx * ny),
      );
      const point = vec3(coord)
        .add(0.5)
        .div(vec3(nx, ny, nz))
        .mul(extent)
        .add(minimum)
        .toVar();
      const result = vec3(0).toVar();
      Loop(lights.length, ({ i }) => {
        const source = a.element(i),
          end = b.element(i),
          energy = radiance.element(i);
        const segment = end.sub(source.xyz),
          length = segment.length().max(0.001);
        const axis = segment.div(length),
          q = point.sub(source.xyz);
        const along = q.dot(axis),
          remaining = length.sub(along);
        const distance2 = q.dot(q).sub(along.mul(along)).max(0.0025);
        If(energy.dot(vec3(1)).greaterThan(0), () => {
          // Thin-cylinder solid angle, integrated along its complete length.
          const angle = along
            .div(distance2.add(along.mul(along)).sqrt())
            .add(remaining.div(distance2.add(remaining.mul(remaining)).sqrt()))
            .max(0);
          const irradiance = source.w
            .mul(2)
            .div(distance2.sqrt())
            .mul(angle)
            .div(4 * Math.PI);
          const nearest = q
            .sub(axis.mul(along.clamp(0, length)))
            .length()
            .sub(source.w)
            .max(0);
          const local = nearest
            .smoothstep(DUST_LIGHT_FADE_START, DUST_LIGHT_CUTOFF)
            .oneMinus();
          result.addAssign(energy.mul(irradiance).mul(local));
        });
      });
      textureStore(target, coord, vec4(result, 1));
    });
  })()
    .compute(voxelCount)
    .setName("Tube irradiance grid");
  const volume = texture3D(texture);
  let initialized = false,
    updates = 0;
  return {
    texture,
    compute,
    voxelCount,
    sample(position) {
      return volume.sample(position.sub(minimum).div(extent)).level(0).rgb;
    },
    get updates() {
      return updates;
    },
    update(renderer) {
      let changed = !initialized;
      lights.forEach((light, i) => {
        const r = light.color.r * light.intensity,
          g = light.color.g * light.intensity,
          bl = light.color.b * light.intensity;
        changed ||=
          starts[i].x !== light.start.x ||
          starts[i].y !== light.start.y ||
          starts[i].z !== light.start.z ||
          starts[i].w !== light.radius ||
          !ends[i].equals(light.end) ||
          colors[i].x !== r ||
          colors[i].y !== g ||
          colors[i].z !== bl;
        starts[i].set(
          light.start.x,
          light.start.y,
          light.start.z,
          light.radius,
        );
        ends[i].copy(light.end);
        colors[i].set(r, g, bl);
      });
      if (changed) {
        renderer.compute(compute);
        initialized = true;
        updates++;
      }
    },
    dispose() {
      compute.dispose();
      texture.dispose();
    },
  };
}
