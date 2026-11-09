import * as THREE from "three/webgpu";
import {
  Fn,
  cameraWorldMatrix,
  mix,
  mrt,
  pmremTexture,
  positionLocal,
  positionViewDirection,
  storage,
  texture,
  transformNormalToView,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  viewportTexture,
} from "three/tsl";
import { GRID } from "./simulation.js";
import { RADIUS, REST_HEIGHT, WORLD_SCALE } from "./modes.js";
import { createFilmFluid } from "./film-fluid.js";
import {
  createSoapOpticsLUT,
  SOAP_MAX_THICKNESS,
  SOAP_LUT_WIDTH,
  SOAP_LUT_HEIGHT,
} from "./soap-optics.js";

function createWaveGeometry(rings = 128, segments = 384) {
  const positions = [],
    indices = [];
  for (let r = 0; r <= rings; r++)
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2,
        radius = (RADIUS * r) / rings;
      positions.push(
        Math.cos(angle) * radius,
        REST_HEIGHT,
        Math.sin(angle) * radius,
      );
      if (r < rings && i < segments) {
        const k = r * (segments + 1) + i,
          next = k + segments + 1;
        indices.push(k, k + 1, next, k + 1, next + 1, next);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 5);
  return geometry;
}

export async function createWaveView(simulation, renderer) {
  const device = renderer.backend.device;
  const field = new THREE.StorageBufferAttribute(GRID * GRID, 4);
  renderer.backend.createStorageAttribute(field);
  const shapeField = new THREE.StorageBufferAttribute(GRID * GRID, 4);
  renderer.backend.createStorageAttribute(shapeField);
  const displayField = new THREE.StorageBufferAttribute(GRID * GRID, 4);
  renderer.backend.createStorageAttribute(displayField);
  const film = await createFilmFluid(renderer, displayField);
  const parameters = device.createBuffer({
    label: "wave envelope parameters",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const shapeParameters = device.createBuffer({
    label: "steady wave shape parameters",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const displayParameters = device.createBuffer({
    label: "animated wave height parameters",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const response = await fetch(new URL("./wave-field.wgsl", import.meta.url));
  if (!response.ok)
    throw new Error("Wave visualization source could not be loaded.");
  const shader = device.createShaderModule({
    label: "wave envelope",
    code: await response.text(),
  });
  const info = await shader.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length)
    throw new Error(
      errors
        .map((m) => `wave-field.wgsl:${m.lineNum}: ${m.message}`)
        .join("\n"),
    );
  const compute = await device.createComputePipelineAsync({
    label: "wave envelope",
    layout: "auto",
    compute: { module: shader, entryPoint: "waveField" },
  });
  const shapeCompute = await device.createComputePipelineAsync({
    label: "steady wave shape",
    layout: "auto",
    compute: { module: shader, entryPoint: "steadyField" },
  });
  const displayCompute = await device.createComputePipelineAsync({
    label: "animated wave height",
    layout: "auto",
    compute: { module: shader, entryPoint: "displayField" },
  });
  const displayBindGroup = device.createBindGroup({
    layout: displayCompute.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: displayParameters } },
      { binding: 4, resource: { buffer: renderer.backend.get(field).buffer } },
      {
        binding: 5,
        resource: { buffer: renderer.backend.get(shapeField).buffer },
      },
      {
        binding: 6,
        resource: { buffer: renderer.backend.get(displayField).buffer },
      },
    ],
  });
  const data = storage(displayField, "vec4", GRID * GRID).toReadOnly();
  const radiance = uniform(2),
    presence = uniform(1);
  const sample = Fn(([p]) => {
    const grid = p
      .add(RADIUS)
      .mul((GRID - 1) / (RADIUS * 2))
      .clamp(0, GRID - 1.0001)
      .toVar();
    const ij = grid.floor(),
      f = grid.fract();
    const k = uint(ij.y).mul(GRID).add(uint(ij.x));
    return mix(
      mix(data.element(k), data.element(k.add(1)), f.x),
      mix(data.element(k.add(GRID)), data.element(k.add(GRID + 1)), f.x),
      f.y,
    );
  });
  const height = Fn(([p]) => sample(p).z.mul(RADIUS));
  const p = positionLocal.xz;
  const h = height(p);
  const cell = (RADIUS * 2) / (GRID - 1);
  const normal = vec3(
    height(p.sub(vec2(cell, 0))).sub(height(p.add(vec2(cell, 0)))),
    cell * 2,
    height(p.sub(vec2(0, cell))).sub(height(p.add(vec2(0, cell)))),
  ).normalize();
  const sheetPosition = varying(p, "waveSheetPosition");
  const surfaceNormal = transformNormalToView(varying(normal, "waveNormal"));
  const facing = surfaceNormal
    .normalize()
    .dot(positionViewDirection)
    .abs()
    .clamp(0, 1);

  // Sample the advected thickness per fragment, independently of mesh density.
  const filmData = storage(
    film.attribute,
    "float",
    film.size * film.size,
  ).toReadOnly();
  const thickness = Fn(() => {
    const grid = sheetPosition
      .div(RADIUS)
      .add(1)
      .mul(film.size * 0.5)
      .sub(0.5)
      .clamp(0, film.size - 1.0001)
      .toVar();
    const ij = grid.floor(),
      f = grid.fract(),
      k = uint(ij.y).mul(film.size).add(uint(ij.x));
    return mix(
      mix(filmData.element(k), filmData.element(k.add(1)), f.x),
      mix(
        filmData.element(k.add(film.size)),
        filmData.element(k.add(film.size + 1)),
        f.x,
      ),
      f.y,
    );
  })();
  const opticsData = Uint16Array.from(
    createSoapOpticsLUT(),
    THREE.DataUtils.toHalfFloat,
  );
  const optics = new THREE.DataTexture(
    opticsData,
    SOAP_LUT_WIDTH,
    SOAP_LUT_HEIGHT,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  optics.minFilter = optics.magFilter = THREE.LinearFilter;
  optics.generateMipmaps = false;
  optics.needsUpdate = true;
  const material = new THREE.MeshBasicNodeMaterial({
    color: 0,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    forceSinglePass: true,
    fog: false,
  });
  // Both interfaces are already included in the Airy reflectance. The thin
  // parallel film transmits straight through, with negligible lateral offset.
  const opticsUV = vec2(
    thickness
      .div(SOAP_MAX_THICKNESS)
      .clamp(0, 1)
      .mul(SOAP_LUT_WIDTH - 1)
      .add(0.5)
      .div(SOAP_LUT_WIDTH),
    facing
      .sqrt()
      .mul(SOAP_LUT_HEIGHT - 1)
      .add(0.5)
      .div(SOAP_LUT_HEIGHT),
  );
  const reflectance = texture(optics, opticsUV).rgb;
  const reflectionDirection = positionViewDirection
    .negate()
    .reflect(surfaceNormal.normalize())
    .transformDirection(cameraWorldMatrix);
  // Directional studio reflections leave dark, transparent regions between
  // the soft light cards, instead of coloring the entire film evenly.
  const illumination = Fn(() =>
    pmremTexture(material.envMap, reflectionDirection, 0.025)
      .mul(0.8)
      .mul(radiance),
  )();
  const reflected = reflectance.mul(illumination);
  const backdrop = viewportTexture();
  const transmitted = backdrop.rgb.mul(reflectance.oneMinus());
  const composite = mix(backdrop.rgb, reflected.add(transmitted), presence);
  material.positionNode = vec3(
    positionLocal.x,
    h.add(REST_HEIGHT),
    positionLocal.z,
  );
  material.outputNode = vec4(composite, 1);
  // This attachment selects bright reflected light for the lens bloom pass.
  material.mrtNode = mrt({ emissive: vec4(reflected.mul(presence), 1) });
  const surface = new THREE.Mesh(createWaveGeometry(), material);
  surface.name = "Iridescent wave film";
  surface.frustumCulled = false;
  surface.renderOrder = 2;
  const mesh = new THREE.Group();
  mesh.name = "Magnified vibration envelope";
  mesh.add(surface);
  let bindGroup,
    shapeBindGroup,
    lastTime = null,
    lastShapeKey = null,
    lastDisplayKey = null,
    shapeRemaining = 0;
  function setSimulation(next) {
    simulation = next;
    lastTime = null;
    lastShapeKey = null;
    lastDisplayKey = null;
    const source = simulation.gpu.waveSource;
    const group = (pipeline, params, output) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: source.modes } },
          { binding: 2, resource: { buffer: source.basis } },
          {
            binding: 3,
            resource: { buffer: renderer.backend.get(output).buffer },
          },
        ],
      });
    bindGroup = group(compute, parameters, field);
    shapeBindGroup = group(shapeCompute, shapeParameters, shapeField);
  }
  function update(settings, blend = settings.view === "wave" ? 1 : 0) {
    presence.value = blend;
    mesh.visible = blend > 0.001;
    if (!mesh.visible) {
      lastTime = null;
      lastDisplayKey = null;
      return;
    }
    radiance.value = settings.waveLight;
    const displayKey = `${settings.waveHeight}/${blend}`;
    const advancing = lastTime !== simulation.time;
    if (!advancing && displayKey === lastDisplayKey) return;
    const first = lastTime === null || simulation.time < lastTime;
    const dt = first ? 0 : Math.max(0, simulation.time - lastTime);
    if (lastTime !== null && simulation.time < lastTime) film.reset();
    const alpha = first ? 1 : 1 - Math.exp(-dt / 0.08);
    const phase = simulation.phase;
    device.queue.writeBuffer(
      parameters,
      0,
      new Float32Array([
        Math.cos(phase),
        Math.sin(phase),
        1 / (Math.PI * 2 * simulation.frequency),
        alpha,
      ]),
    );
    const encoder = device.createCommandEncoder({
        label: "visualize membrane envelope",
      }),
      pass = encoder.beginComputePass();
    if (advancing) {
      pass.setPipeline(compute);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil((GRID * GRID) / 128));
    }
    const drive = simulation.drive ?? settings.drive ?? 0.12,
      damping = simulation.modal?.damping ?? 0.008;
    const shapeKey = `${simulation.frequency}/${drive}/${damping}`;
    if (shapeKey !== lastShapeKey) {
      shapeRemaining = 1.6;
      lastShapeKey = shapeKey;
    }
    if (advancing && (first || shapeRemaining > 0)) {
      shapeRemaining = first ? 0 : Math.max(0, shapeRemaining - dt);
      const shapeAlpha =
        first || shapeRemaining === 0 ? 1 : 1 - Math.exp(-dt / 0.16);
      device.queue.writeBuffer(
        shapeParameters,
        0,
        new Float32Array([
          2 * Math.PI * simulation.frequency,
          drive,
          damping,
          shapeAlpha,
        ]),
      );
      pass.setPipeline(shapeCompute);
      pass.setBindGroup(0, shapeBindGroup);
      pass.dispatchWorkgroups(Math.ceil((GRID * GRID) / 128));
    }
    updateDisplay(pass, settings, blend, dt, first);
    pass.end();
    film.encode(encoder, dt, settings.filmStirring ?? 1);
    device.queue.submit([encoder.finish()]);
    lastTime = simulation.time;
    lastDisplayKey = displayKey;
  }
  function updateDisplay(pass, settings, blend, dt, first, steadyForcing = 0) {
    // The renderer and fluid read the exact same height and vertical velocity.
    // Zero elapsed time changes the displayed height without injecting a kick.
    device.queue.writeBuffer(
      displayParameters,
      0,
      new Float32Array([
        (settings.waveHeight * WORLD_SCALE * blend) / RADIUS,
        steadyForcing,
        dt > 0 ? 1 / dt : 0,
        first || dt === 0 ? 1 : 1 - Math.exp(-dt / 0.06),
      ]),
    );
    pass.setPipeline(displayCompute);
    pass.setBindGroup(0, displayBindGroup);
    pass.dispatchWorkgroups(Math.ceil((GRID * GRID) / 128));
  }
  async function prewarm(settings) {
    film.reset();
    lastTime = null;
    update(settings, 1);
    // Form the opening pattern from the selected frequency's steady response,
    // independent of the older sand checkpoint. Physical state stays untouched.
    function setForcing(steady) {
      const encoder = device.createCommandEncoder({
        label: "initial film forcing",
      });
      const pass = encoder.beginComputePass();
      updateDisplay(pass, settings, 1, 0, true, steady);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
    setForcing(1);
    try {
      // Eight seconds at the normal 60 Hz fluid step. Wait after each second
      // to bound the GPU queue and let the loading indicator paint.
      for (let batch = 0; batch < 80; batch++) {
        film.advance(0.1, settings.filmStirring ?? 1);
        if (batch % 10 === 9) await device.queue.onSubmittedWorkDone();
      }
    } finally {
      setForcing(0);
      await device.queue.onSubmittedWorkDone();
    }
  }
  function reset() {
    film.reset();
    lastTime = null;
  }
  setSimulation(simulation);
  return {
    mesh,
    surface,
    material,
    field,
    shapeField,
    displayField,
    film,
    optics,
    radiance,
    presence,
    update,
    prewarm,
    setSimulation,
    reset,
    dispose() {
      surface.geometry.dispose();
      material.dispose();
      optics.dispose();
      backdrop.value.dispose();
      film.dispose();
      parameters.destroy();
      shapeParameters.destroy();
      displayParameters.destroy();
      for (const attribute of [field, shapeField, displayField]) {
        attribute.dispose();
        if (renderer.backend.has(attribute))
          renderer.backend.destroyAttribute(attribute);
      }
    },
  };
}
