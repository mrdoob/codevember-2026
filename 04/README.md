# Codevember 2026 / 04 / Tangle

[View experiment](https://mrdoob.github.io/codevember-2026/04/) · [Source](https://github.com/mrdoob/codevember-2026/tree/main/04)

Five evenly spaced feeders orbit a shared circle, dropping yarn onto an empty floor and gradually building a tangled nest. Startup and Reset begin with short hanging lengths; each GPU strand grows to about 194 units before its oldest end is removed. Pick up a thread and pull: the loops lift, tighten, and settle. Static friction and sleeping contacts hold resting yarn against the floor and neighboring strands; a strong pull can still make it slide. Three twisted plies, bump-mapped wool fibers, directional highlights, and wool sheen give each strand its texture. Old yarn ends with a flat cut that retreats smoothly at full thickness.

Plain JavaScript and three.js **0.187.0**, with the same minimal title and Settings panel as days 01–03. No build step. Browser modules load from jsDelivr, so an internet connection is required.

## Run

```sh
npm start
```

Open **http://localhost:8004**. Python 3 is required for the local server. Use `python3 scripts/serve.py --port 8005` for another port, or `servez --local --port=8004 .`. WebGPU runs both the physics and rendering. Browsers using the WebGL2 fallback retain the CPU solver and simpler shadows.

## Controls

- **Drag a thread** to lift and pull it. Mouse, pen, and touch use the same interaction.
- **Drag the background** to orbit; scroll or pinch to zoom.
- **Space** pauses/resumes; **R** resets the tangle; **C** changes the palette.
- **Settings** adjusts feeding, feeder orbit, softness, friction, speed, fiber relief, fiber alignment, sheen, shadows, grading, and resolution. Set Feeder orbit to zero for a stationary ring.

The four palettes are Haberdashery, Wildflower, Seaside, and Sorbet. A reduced-motion preference starts the scene paused; press Space to start it.

Auto orbit is enabled by default. Turn it off under Studio to hold the camera still.

## Implementation

- `rope-config.js` holds the dimensions, capacities, inlet height, and physics defaults shared by the GPU solver, CPU fallback, renderer, and capture scripts.
- `gpu-rope.js` reserves 10,800 particles and starts with 40 active particles per strand, entirely above the floor. Feeding activates more particles up to capacity; inactive slots are excluded from constraints, contacts, and picking. Initialization, feeding, integration, stretch, bending, hashed self-contact, static/sliding friction, and grabbing all run on the GPU at a fixed 120 Hz. Overlapping workgroup blocks solve 512 core particles with 64 neighbors on each side, alternating block boundaries between passes. Four contact passes alternate with eight local constraint iterations. Passes read one position buffer and write another, avoiding concurrent writes to neighboring particles.
- Quiet, supported particles sleep at a stored world position. Pulling, impacts, loss of support, or setting friction to zero releases them. Rest positions and material normals travel with the yarn when particle slots recycle. The GPU rotates each material frame with its local bend, so a moving inlet no longer spins already-settled yarn.
- The GPU also smooths centerlines. `yarn.js` reads its storage buffers directly to deform three helical plies. Animation performs no particle readback or per-frame position upload. Buffer allocations stay fixed; GPU indirect draws include only the active length, with full-width caps following its end. Once capacity is reached, the feed phase moves the cut continuously through the oldest segment. Its twist and texture coordinates advance with the cut, and recycling a particle leaves the cut position continuous. Upper leads extend beyond the simulated inlet. `yarn-layout.js` keeps the CPU and GPU sampling layouts in sync.
- Each ply carries an analytic fiber tangent through the same rotation and bend as its geometry. An anisotropic GGX lobe is smoother along that direction and broader across it, giving highlights that respond to the local fiber orientation. The Fiber alignment control adjusts this effect. Cut faces retain a rough, isotropic response. This uses the existing meshes without adding hair geometry or draw calls; it is a surface approximation, not a full fiber-scattering model.
- `yarn-surface.js` generates a tileable, mipmapped wool height texture, with color and roughness variation. Broad fiber bundles keep the bump visible at the normal camera distance, while fine filaments appear close up. Bump detail and ply twist use material distance so they follow the yarn through feeding. The Fiber relief control adjusts the bump strength.
- `rope-simulation.js` supplies the WebGL2 CPU fallback, with the same empty-floor start and growing strands. It retains up to 720 particles per strand (about 65 units), its 120 Hz compliant constraint solver, and contact friction. Both solvers start directly from hanging lengths without a prebuilt pile or warm-up. They use different constraint schedules and floating-point precision, so their motion is not identical.
- `studio.js` and `pcss-shadow.js` provide warm studio lighting and soft contact shadows. WebGL2 uses native PCF shadows because its comparison samplers cannot also supply raw blocker depths.
- `drag.js` picks the simulated centerline in screen space, preferring the front strand at crossings. In WebGPU mode a compute pass selects the particle, and only two vec4s are read back when a drag begins. Pointer motion updates a target uniform; the grab follows the same material as new yarn feeds in. A small soft grab patch distributes the pull.
- `post-processing.js` grades the scene, tone maps it with ACES, and applies FXAA.

This is a visual rope simulation. Particle contacts approximate continuous strand collisions; tight crossings and strong pulls can still intersect. Small stretch compliance keeps the simulation responsive, and removing the oldest segment keeps its length bounded.

The paused scene stops rendering once the camera settles. Hidden tabs stop advancing. Geometry, textures, controls, and rendering resources are released when leaving the page.

## Validation

```sh
npm ci
npm test
```

The thirteen Node.js tests cover consistent GPU diagnostic snapshots, the CPU fallback, and shared geometry: empty-floor startup, growth to capacity, the visible mesh following growth and reset, fixed-step consistency, a full recycling cycle, floor clearance and stretch limits, coincident contacts, grabbing and release, deterministic reset, static floor grip, friction between strands, outward triangle winding, orthonormal yarn frames, fiber tangent directions, and continuous, full-width cuts across recycling events.

To check the actual GPU solver in an open WebGPU experiment tab, run:

```js
const { runGPUChecks } = await import('./scripts/gpu-checks.js');
await runGPUChecks(tangle);
```

This checks empty-floor initialization, paused feeding, growth and indirect drawing, settled positions and material orientation while feeding continues, GPU picking and grabbing, waking contacts, release, a complete recycling cycle, finite frame buffers, full width through the cut, and resetting to an empty floor. It temporarily drives the scene and restores the settings afterward. Full-buffer readbacks happen only in these diagnostics.

Browser checks exercised WebGPU and WebGL2 rendering, dragging, background orbit, keyboard shortcuts, idle pause, portrait layout, and reduced motion. Local screenshots and check reports live in the ignored `exports/` directory.

For inspection or frame-by-frame capture, `window.tangle` exposes `pause`, `reset`, `palette`, `advance`, `render`, `inspect`, the simulation, camera, and renderer. `await tangle.inspect()` identifies the active physics engine and checks its state; in GPU mode this performs an explicit readback. The `simulationMs` metric measures CPU dispatch/update time, not GPU execution time. Set `tangle.manual = true` to suspend the interactive loop, then call `tangle.advance(1 / 30)` and `tangle.render()` for each frame. `advance` accepts at most 0.1 seconds per call.

For static hosting, copy `index.html`, `style.css`, and the root JavaScript files together. The server, tests, npm dependencies, and exports are not required by the hosted page.

## Video export

The capture scripts use the same ordered PNG-to-FFmpeg workflow as days 01–03: a 60-second, 30 fps, 1024 × 1024 H.264 MP4, rendered at 1536 × 1536 and downsampled, with the title and collapsed Settings overlay enlarged by √2.

With the experiment running on port 8004 and FFmpeg/ffprobe on PATH, start a receiver:

```sh
python3 scripts/capture-server.py exports/tangle-1024x1024-60s.mp4 --previews
```

Use the existing browser with a 1024 × 1024 viewport and device pixel ratio 1, then run:

```js
const { captureVideo } = await import('./scripts/capture-video.js');
await captureVideo();
```

Recording begins from the empty floor. The camera follows the default auto orbit speed, covering 180° in 60 seconds. At 10 and 30 seconds, a visible falling strand is swung back and forth. At 20, 40, and 50 seconds, a floor loop is lifted and shaken across the pile. Each gesture uses the normal GPU picker and grab constraints; feeding continues throughout. A small ring marks the grab target.

Use `captureVideo({interaction:'none'})` to record the yarn feeding and camera orbit with no dragging or cursor marker.

For a more playful recording, use `captureVideo({interaction:'human',seed:20261104})`. This varies the intervals, selected strands, and paths: accelerating tosses released in motion, brief tugs, and longer shakes with uneven strokes and occasional hesitations. Short follow-ups and longer pauses give the yarn time to fly and settle. `scripts/human-gestures.js` generates the plan once from the seed, so encoding speed cannot affect gesture timing. Change the seed for another sequence; the original regular ten-second schedule remains available.

Pass `interactionCount:25` to fit exactly 25 gestures into the minute, for example `captureVideo({interaction:'human',interactionCount:25,seed:2026110425})`. This busier plan mixes small flicks, tosses, tugs, lifts, and shakes. Rounded hand paths preserve motion between waypoints, with little overshoots and corrections. Irregular pauses include quick re-grabs of the same strand, and the last few seconds let the yarn settle. Hand targets still update at the 120 Hz physics rate so throws retain their release momentum.

Every frame advances exactly 1/30 second, renders, snapshots a lossless PNG before presentation, and waits for the encoder's acknowledgement. The receiver verifies all 1,800 decoded frames, dimensions, frame rate, and duration. The JSON report includes gesture timings, selected yarn, and actual displacement. Existing videos are never overwritten.

Inspect `window.captureProgress` for progress, or call `window.captureProgress.cancel()` to stop. `captureVideo({duration:15})` makes a short check with only gestures that fit. The normal renderer, camera, controls, and UI are restored afterward. Generated videos, reports, and selected preview frames remain in the ignored `exports/` directory.
