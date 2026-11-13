# Codevember 2026 / 12 / Feather

Copper feathers fall through a wheat field at sunset, with wind-driven trees, a small farm, and layered depth of field. Built with plain JavaScript, Three.js `WebGPURenderer`, and TSL. WebGPU is required; dependencies load from a pinned Three.js revision through an import map. There is no build step.

## Run

```sh
npm start
```

Open **http://localhost:8012/**. Python 3 serves the files. To browse the gallery and the experiment together, serve the parent directory and open `/12/`.

## Controls

- **Drag horizontally** to orbit. **Drag down** to raise the camera; **drag up** to lower it, keeping the viewing angle fixed.
- **Scroll or pinch** to zoom. Focus follows the orbit center.
- **G** sends a gust through the feathers.
- **Space** pauses or resumes the scene. Camera dragging remains available while paused.
- **R** resets the feathers and camera. **H** hides the interface.
- **Settings** controls wind, time, fall speed, auto orbit, lighting, subsurface scattering, focus, blur, bloom, saturation, and resolution.

The camera starts at Y = −1.75 at a target distance of 6, with room to drag lower. Zoom spans 5–11 units, height spans −2.5–5, and the camera looks upward at a fixed 10° angle. Auto orbit runs at 6°/second (one turn per minute) and resumes after dragging. The vertical field of view is 40°, widening to 46° in portrait. Rendering uses the full device DPR by default, with explicit 1×, 1.5×, and 2× overrides. Reduced-motion preferences start the scene paused; hidden tabs stop advancing.

## Scene and motion

- `scene-constants.js` defines camera limits, feather scale, spread, descent, and the focus band.
- `feather-geometry.js` builds four levels of feather detail using curved barbs, branching barbules, sparse down, and rounded quills. `feather-material.js` uses `MeshSSSNodeMaterial` with TSL thickness and absorption. Thin rims transmit more light, while quills and denser fibers absorb it. Scattering depends on direct illumination and remains strongest when backlit.
- `feather-field.js` animates 256 feathers within a 6-unit horizontal radius. Feathers bank, slip sideways, flutter, and descend at a varying rate around 0.42 units/second. The three central feathers have the finest detail. Feathers recycle overhead only once their bounds leave the view or pass below the ground, including at portrait framing and maximum zoom. Their lengths are approximately 0.5–1.4 units, enlarged to make the fibers readable. They do not collide with wheat.
- `wheat.js` plants 348,496 stalks and 8,000 straw tufts. Each stalk uses 48 triangles; each straw tuft uses 12. Nearby 4×4 patches retain full density, while outer 8×8 patches gradually thin to one quarter density. Placement, rotation, height, and patch slopes vary to break up repetition. The entire center and camera orbit remain planted; small clearings follow farm footprints.
- `wheat-wind.js` creates irregular traveling gust fronts, crosswind, and fine ripples. Gust strength is 1.125. Stalks bend above fixed roots, with lateral reach limited to 98% of their height above the soil. Normals tilt with the stalks, and canopy illumination follows the gust fronts so the waves remain visible through blur. Instance transforms stay static.
- `field-terrain.js` supplies matching CPU and TSL terrain functions for soil, placement, and wind. The field rises gradually from Y = −6 beneath the camera into rolling terrain. Ground fades into the landscape before the far clipping plane.
- `farm.js` and `farm-layout.js` place the farmhouse, tractor, fence, barn, silo, shed, hay bales, and five trees around the horizon. Foundations, posts, tires, bales, and trunks meet the same terrain. Farm geometry totals about 19,800 triangles in 29 merged meshes. `tree-wind.js` gives branches a delayed response to the wheat gusts, with faster foliage flutter and 3× displacement. Tree bases stay fixed, and culling bounds include their motion.
- `landscape.js` renders the sky, distant hills, and fixed sunset through `scene.backgroundNode`. The sun direction also lights the geometry. Shadows are disabled.

## Rendering

`wheat-pipeline.js` extends the pinned `MeshletDrawingPipeline` for GPU culling and automatic LOD. The 125 source wheat/straw batches contain 24,304 patch/tuft instances in a static `BundleGroup`. The adapter separates patch queues and reserves enough capacity for abrupt camera changes. Vertex wind retains finite culling bounds. Farm meshes also use meshlets; feathers use ordinary instancing.

`scene-layers.js` renders the environment once and feathers in three additional passes: far, focused, and near. `depth-instances.js` compacts visible feathers into those passes, detaching empty batches. Each pass uses 4× MSAA at full DPR. Feather passes use `StandardDrawingPipeline` to preserve the environment's meshlet visibility cache, and compare against environment depth for occlusion.

`depth-of-field.js` blurs the environment progressively beyond focus. Feathers stay sharp from 2 units before focus to 3 units beyond it, then transition through a 4.5-unit blur range. Far feathers use 42% of the foreground blur radius. Color and alpha blur together before compositing, and focused feathers never enter the blur filters. Wide filters run at half resolution; their radii scale with DPR. Zero aperture bypasses blur, and **Environment blur** toggles only the environment filter for motion inspection.

`post-processing.js` applies bloom, vignette, ACES tone mapping, and the color grade. Scattering, wind, and the lens are real-time visual approximations rather than physical simulations.

## Validation

Browser checks run against the loaded scene:

```js
await (await import('./tests/rendering.browser.js')).checkFeather();
await (await import('./tests/feather-lighting.browser.js')).checkFeatherLighting();
await (await import('./tests/depth-of-field.browser.js')).checkDepthOfField();
await (await import('./tests/scene-scale.browser.js')).checkSceneScale();
(await import('./tests/camera.browser.js')).checkCamera();
await (await import('./tests/meshlets.browser.js')).checkMeshlets();
await (await import('./tests/wheat-wind.browser.js')).checkWheatWind();
await (await import('./tests/tree-wind.browser.js')).checkTreeWind();
(await import('./tests/field-coverage.browser.js')).checkFieldCoverage();
(await import('./tests/landmarks.browser.js')).checkLandmarks();
await (await import('./tests/performance.browser.js')).checkPerformance();
```

The checks cover native WebGPU/DPR, lighting on both feather faces, focused-edge isolation, near/far blur, environment occlusion, camera interactions, deterministic motion, and hidden feather recycling across 144 views. GPU checks verify anchored wind motion, finite meshlet bounds, and queue capacity. Coverage checks count actual planted stalks, and grounding checks raycast the rendered terrain at 37 model contact points. Performance sampling reports frame cadence across 16 views without a hardware-dependent pass threshold.

`window.feather` exposes the scene, camera, renderer, materials, field, farm, post-processing, and controls for inspection. For deterministic captures, set `manual = true`, call `reset()` or `advance(dt)`, wait for `requestAnimationFrame`, then call `render()`. Restore `manual = false` afterward. Programmatic changes to wheat visibility or transforms require `wheat.group.needsUpdate = true`. Local experiment snapshots under `exports/` are excluded from version control.

## Video capture

The 60-second shot makes one full orbit at 6°/second while descending from Y = 5 to −2.5. The descent eases at both ends; orbit radius and viewing angle stay fixed. Feathers, wheat, and trees advance together at a fixed timestep. This is a continuous shot, not a seamless loop.

Start the local experiment and a separate FFmpeg receiver (requires `ffmpeg` and `ffprobe` on PATH):

```sh
python3 scripts/capture-server.py --previews
```

In a fresh tab at **http://127.0.0.1:8012/**, use a 1024×1024 viewport with device scale 1. Wait for the scene to load, then run:

```js
await (await import('./scripts/capture-video.js')).captureVideo();
```

This renders 1,800 frames at 1536×1536, downsamples to 1024×1024, and encodes a silent 30 fps H.264 MP4 with the title and collapsed Settings label at √2 scale, matching the other days. PNG frames are acknowledged in order, so capture speed does not affect timing. The receiver verifies the decoded frame count, dimensions, frame rate, and duration before finalizing the output. Video, metadata, and optional preview frames go into ignored `exports/`; existing videos are never overwritten.

`window.captureProgress` reports progress; call its `cancel()` method to abort. Capture resets the simulation, disables interaction, and restores the opening camera and prior settings afterward. Keep the capture tab visible and its viewport fixed. Preview a frame with `createCaptureSession().preview(frameIndex)` and call the session's `restore()` before starting a recording. Use `npm test` to check the capture path; the browser camera check also verifies orbit timing at 30, 60, and 120 fps.
