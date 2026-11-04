# Codevember 2026 / 03 / Melt

Pastel wax sculptures melt beneath a descending sphere of fire. WebGPU compute handles the particles, heat transfer, Marching Cubes surface, and light-path thickness. Pale colored interiors emerge as the wax flows into a puddle.

[Live experiment](https://mrdoob.github.io/codevember-2026/03/)

## Run

```sh
npm start
```

Open http://localhost:8003 in a WebGPU-capable browser. Python 3 serves the files; no build step is needed. Browser modules load three.js **0.187.0** from jsDelivr, so internet access is required. Use `python3 scripts/serve.py --port 8004` to choose another port.

## Controls

- Click the sculpture, press Enter or Right Arrow, or use **Settings → Melt → Primitive** to advance.
- Drag to orbit; scroll or pinch to zoom. **Auto orbit** starts enabled, with the camera at the lowest allowed angle, 3.6° above horizontal.
- Space pauses or resumes; R resets the current sculpture; Escape releases the graphics device.
- Settings adjusts heating, descent, viscosity, cohesion, material, shadows, color grading, and resolution.

The cycle is **Octahedron, Cube, Cone, Cylinder, Capsule, Sphere, Torus, Torus Knot**. Each selection has a random 3D rotation and seeded material variation. Reset repeats that orientation and material. The next shape starts when the fire reaches the floor, after five simulation seconds.

The heat radius defaults to **1**, with **0.5** units of soft falloff. The visible sphere has an independent **0.2** radius. Hiding the sphere leaves its heat and illumination active.

Appearance defaults: SSS **1.5**, scatter distance **0.5**, EON diffuse roughness **0.65**, contrast **1.25**, exposure **0.9**, and tint **1**. Reset grade restores the default color grading.

## Implementation

| File | Responsibility |
| --- | --- |
| `main.js` | Scene, controls, settings, frame scheduling, and lifecycle |
| `sculpture.js` | Primitive distance fields, volume sampling, rotations, and palettes |
| `gpu-melt.js` | Compute simulation, spatial bins, surface reconstruction, and thickness integration |
| `heat-source.js`, `fire-particle.js` | Fire trajectory and visible emitter |
| `wax-material.js` | EON diffuse shading, wax finish, and subsurface scattering |
| `lighting-config.js`, `studio-lighting.js`, `pcss-shadow.js` | Studio lights, PCSS shadows, and shadow-derived ambient occlusion |
| `post-processing.js` | Color grading, ACES tone mapping, and FXAA |
| `runtime.js` | Drawing resolution and fixed simulation steps |

### Simulation and surface

Volumes are sampled at 0.11-unit spacing, with 3,166–4,096 particles per shape. Rotation transforms both the particle volume and its analytic distance field, then lifts the sculpture onto the floor. The torus knot uses a 96-segment centerline with a 0.35-unit tube radius.

Heat arrives by proximity to the moving sphere and conducts between neighbors. Seeded heat capacities make some regions soften sooner. A latent-heat interval gradually releases elastic bonds; gravity, viscosity, cohesion, four contact-projection iterations, and floor friction produce the flow. Fixed 1/60-second steps keep simulation speed independent of display refresh rate. A long frame contributes at most 0.1 second, avoiding a catch-up backlog.

Cold surfaces follow the analytic primitive, warped by particle displacement. Melting regions blend into a smoothed density surface. A 113 × 85 × 77 field at 0.065-unit spacing supplies **715,008 Marching Cubes cells**. Empty spatial neighborhoods skip field evaluation. Meshing writes directly to preallocated GPU geometry and indirect draw buffers, with a **60,000-triangle** limit. Smooth field gradients provide normals for both shading and receiver-plane shadow correction.

This is a visual approximation: it does not solve incompressibility, conserve reconstructed volume exactly, or simulate rigid-body fracture. Thermal parameters are accelerated artistic controls. Grid and particle spacing limit small droplets and thin threads.

### Wax and lighting

The pastel surface has a diagonal ivory gradient. Interior pigments blend smoothly into pale blue, rose, peach, mint, or aqua. Color stays attached to each particle during melting. Local liquid fraction reduces roughness and EON diffuse roughness and fades the fine surface grain.

During meshing, bounded rays integrate wax thickness toward two directional lights and the moving fire. Trilinear field sampling preserves thin edges and air gaps. Per-channel Beer–Lambert attenuation and an angular scattering lobe approximate subsurface transmission. Finite-radius attenuation avoids a lighting singularity when the fire enters the wax. This is an approximate scattering model, not volumetric multiple scattering or path tracing.

One **2048 × 2048** shadow map supplies floor and self shadows. PCSS uses a deterministic 16-sample blocker search and 64 hardware-filtered comparison samples. Receiver-plane correction follows the smooth surface normal. **Shadow AO** reuses blocker depth to darken nearby contacts; it cannot see occluders absent from the light's shadow map.

The rendering pipeline applies color grading to HDR scene color, followed by ACES tone mapping and FXAA.

### Runtime budget

Storage buffers use approximately **35.7 MB** and are reused across shape changes. Only one graphics frame is in flight. Hidden tabs stop submitting work, and paused scenes redraw only when the view or settings change. Device loss, graphics timeouts, and triangle overflow stop the experiment.

Resolution follows the viewport and device pixel ratio, with optional 75% and 50% scales in Settings. There is no application frame-rate cap. Performance depends on resolution, shape, melt state, and hardware. A 32-byte status buffer is read once per second; `?profile` enables GPU timestamps when supported.

## Validation

```sh
npm ci
npm test
```

CPU tests cover particle and field budgets, rotations, floor placement, buffer reuse, native WGSL parsing and binding limits, drawing resolution, fixed timesteps, and EON/SSS/clearcoat compatibility.

Browser checks run against the actual WebGPU scene. Run them one at a time in the developer console; they deliberately pause and reset the scene:

```js
const checks = await import('./scripts/browser-checks.js');
await checks.primitiveShapes(melt);
await checks.fieldCulling(melt);
await checks.directionalThickness(melt);
await checks.pcssSoftness(melt);
await checks.colorGradingComparison(melt);
await checks.coldAndReset(melt);
await checks.topDownHeating(melt);
await checks.proximityHeating(melt);
melt.reset();
await melt.advance(0);
melt.resume();
```

Additional helpers compare shadow and scattering output, inspect material state, and measure settled-puddle motion. Full particle and image readbacks are limited to these explicit checks.

## Video export

The capture workflow records a **40-second, 30 fps, 1024 × 1024 H.264 MP4**, rendered at 1536 × 1536 and downsampled. It requires FFmpeg and ffprobe on PATH.

With the experiment running, start the receiver:

```sh
python3 scripts/capture-server.py exports/melt-1024x1024-40s-clean.mp4 --previews
```

Set the browser viewport to 1024 × 1024 with device pixel ratio 1, then run:

```js
const { captureVideo } = await import('./scripts/capture-video.js');
await captureVideo({ rotationSeed: 20261105 });
```

All eight shapes appear once, in chronological order, for five seconds each. The camera completes one 360° orbit. Shape changes are immediate, including the final knot to opening octahedron when playback loops. There are no fades or appended opening frames. Change `rotationSeed` for different orientations while retaining the same thermal seeds.

Recordings default to the lowest camera angle allowed by the controls, currently 3.6° above horizontal. Pass `cameraPolarAngle` in radians to choose another allowed angle while preserving the framing distance and target. For the original elevated view, use `cameraPolarAngle: Math.atan2(9.4, 2.8)`.

Frames are copied before browser presentation, encoded to PNG, and acknowledged individually by the receiver. FFmpeg uses two encoding threads. The receiver verifies all 1,200 decoded frames, dimensions, frame rate, and duration before finalizing the MP4. Existing outputs are never overwritten.

`window.captureProgress` reports progress; set its `cancelled` flag to stop. Restore the normal viewport after recording. Generated videos and previews stay in the ignored `exports/` directory.
