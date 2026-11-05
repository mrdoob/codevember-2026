# Codevember 2026 / 05 / Moss

[View experiment](https://mrdoob.github.io/codevember-2026/05/) · [Source](https://github.com/mrdoob/codevember-2026/tree/main/05)

A moss-covered rock and three smaller companions rise from a wooded clearing, surrounded by fireflies. Tap a stone to send it drifting and spinning on a soft spring. The insects notice the movement after individual delays and fly toward the moss with their own momentum.

Everything visible is procedural: individual moss leaves, fractured stones, lichen, soil, woodland, sky, and firefly lanterns. There are no image textures, imported models, or HDR files. A generated environment probe provides the reflections and ambient light.

Plain JavaScript with import maps and no build step. Uses three.js **0.187.0**, its experimental **MeshletDrawingPipeline**, **ClusteredLighting**, and **SkyMesh**. **WebGPU is required.** Library modules load from jsDelivr, so an internet connection is needed.

## Run

```sh
npm start
```

Open **http://localhost:8005**. The server requires Python 3. Use `python3 scripts/serve.py --port 8007` for another port. Installing npm dependencies is only necessary for Node.js tests.

For static hosting, keep `index.html`, `style.css`, and the root JavaScript files together on an HTTPS host. The scripts, tests, npm dependencies, and exports are not needed by the hosted page. `file://` is unsupported.

## Controls

- **Tap a floating rock** to nudge it on pointerdown. Reactions primarily spin around Y, with a little randomized X/Z wobble. Repeated taps blend and remain bounded.
- **Drag** to orbit; scroll or pinch to zoom. Right-drag or two-finger drag pans. Auto orbit is enabled by default and stays enabled after interaction.
- **Double-click or double-tap nearby surfaces** to explore. Double-click distant woodland or empty sky to restore the camera.
- **Space** pauses/resumes; **R** restores the camera.
- **Settings** controls moss density, moisture, breeze, optional spore capsules, camera blur, lighting, fireflies, color grading, and rendering. Select **Bare stone** to inspect the rock surface or **Show meshlets** to visualize the clusters.

The camera follows the opening ascent with a slightly delayed ease. All four rocks remain in the sharp depth interval; blur increases gradually outside it. The camera can orbit below the stones while staying above the soil. Reload to replay the opening.

Rendering defaults to 4× MSAA, ambient occlusion off, and 100% of CSS resolution, independent of high-DPI scaling. FXAA is used only when MSAA is disabled. Higher resolution and lower LOD error improve detail at additional GPU cost.

Reduced-motion preferences start the scene paused on the ground. Hidden tabs stop advancing. A paused scene stops rendering once the camera settles. Resources are released when leaving the page.

## Implementation

- `main.js` assembles the scene, handles navigation, and drives rendering. `settings.js` holds defaults and the Settings panel.
- `stone.js` builds irregular beveled fracture planes with erosion and warped fissures. `geology.js` shades continuous mineral fields and ragged lichen, with filtered detail to reduce distant shimmer. Floating-rock patterns use local coordinates so they follow the stone.
- `botany.js` builds seven seeded tuft variants with tapered stems and closed, keeled leaves. `garden.js` distributes them over raised colonies on all four rocks. The floating garden contains about 34,552 shoots and 588,407 modeled leaves. One scene unit represents approximately 5 cm.
- `floating-rocks.js` fits the starting positions to the terrain and animates the staggered ascent and hovering. `rock-reaction.js` evaluates damped spring gestures against absolute animation time, keeping pause and fixed-step capture consistent. Moving pivots invalidate their render bundles so GPU transforms stay current.
- `materials.js` provides thin-leaf transmission, moisture, pigment variation, basal occlusion, and vertex wind. `woodland.js`, `outcrops.js`, `floor-moss.js`, and `outcrop-moss.js` generate the forest, 106 grounded stones, and moss on nearby stones and soil.
- `habitat.js` captures SkyMesh and the woodland into an environment probe, refreshing it after sky controls are released. `soft-shadow.js` uses a fixed 16-sample disk filter for soft directional shadows without per-pixel random rotation.
- `fireflies.js` combines 48 pulsing lanterns with clustered point lights. Half seek moss using `firefly-flight.js`: delayed observations, bounded acceleration, and independent world-space motion. `background-light.js` supplies a separate moving woodland light.
- `focus-volume.js` follows the transformed bounds of the rock group. `post-processing.js` keeps that interval sharp, gathers the blurred surroundings at half resolution, composites depth-aware firefly glow, and applies ACES and `color-grading.js`.

The scene has approximately **20.7 million full-detail source triangles** with capsules hidden. Meshlet LOD and GPU culling reduce the submitted geometry according to the view. These counts exclude repeated shadow and post-processing draws.

`moss-pipeline.js` contains two r187-specific safeguards:

1. Botanical variants use separate batches with enough draw-queue capacity for every cluster. The stock pipeline's delayed capacity adjustment can discard meshlets immediately after a rapid zoom. The guard rejects batches exceeding the upstream queue limit.
2. Visible botanical batches use the first three LODs; coarser levels prune the canopy into isolated flecks. Woodland and shadow passes retain all six levels. Macro views tighten LOD error based on distance to the actual rock surface.

These safeguards use pinned internal hooks and a batch-table field. Run the meshlet checks when upgrading three.js. Frustum and occlusion culling remain enabled.

This is an artistic real-time scene. Leaf transmission and basal occlusion are approximations, firefly lights do not cast shadows, and the extended sharp interval is not a physical camera lens. Background foliage and distant moss are simplified. Performance depends on viewport, magnification, and GPU; small LOD transitions can remain visible.

## Validation

```sh
npm ci
npm test
```

The Node.js tests cover closed plant geometry, deterministic placement, terrain and cushion contact, rock fractures, meshlet attribute preservation, focus bounds, camera clearance, spring reactions, and delayed firefly pursuit.

In a running WebGPU tab:

```js
await (await import('./scripts/browser-checks.js')).runBrowserChecks();
await (await import('./scripts/meshlet-checks.js')).runMeshletChecks();
await (await import('./scripts/benchmark.js')).benchmark();
```

Browser checks inspect actual GPU batches, light-grid population, surface illumination, focus, navigation, animated transforms, AA switching, grading, and WebGPU validation. The meshlet regression reads requested draw counts immediately after rapid camera changes to detect queue overflow. The benchmark warms each view for 40 frames and measures CPU submission plus GPU completion, rather than display refresh rate. Diagnostics restore the previous view and settings.

`window.moss` exposes the scene, settings, camera, controls, renderer, `pause()`, `resetView()`, `focusAt(x, y)`, `nudgeAt(x, y)`, `inspect()`, `advance(dt)`, and `render()`. For deterministic stepping, set `moss.manual = true`, then call `moss.advance(1 / 30)` and `moss.render()`. `advance()` accepts finite, nonnegative steps capped at 0.1 seconds. Set `manual = false` to resume the interactive loop.

## Video export

The capture uses the same ordered PNG-to-FFmpeg workflow as previous days: **60 seconds, 30 fps, 1024 × 1024 H.264 MP4**, rendered at 1536 × 1536 and downsampled. It includes the title, collapsed Settings panel, and click rings, with no cursor.

With the experiment running and FFmpeg/ffprobe on PATH, start a receiver:

```sh
python3 scripts/capture-server.py --previews
```

The default filename includes a timestamp. To choose a filename, pass it before `--previews`. Existing videos are never overwritten.

In a separate experiment tab with a 1024 × 1024 viewport and device pixel ratio 1:

```js
const { captureVideo } = await import('./scripts/capture-video.js');
await captureVideo();
```

`scripts/capture-shots.js` holds the camera path and tap schedule:

| Time | View and interaction |
| --- | --- |
| 0–17 s | Rocks rise, then a group orbit; tap the hero at 9 s and a companion at 13 s. |
| 17–22.5 s | Close orbit across the front moss cushions. |
| 22.5–28 s | A second close-up across the side cushions, with a companion in the background. |
| 28–40 s | Low orbit looking up beneath the rocks; tap a companion at 31 s and the hero at 35 s. |
| 40–50 s | 75° polar angle, or 15° above the horizon; show meshlets from 44–48 s, without a label. |
| 50–60 s | Tight macro orbit, approaching from 1.15 to 0.85 units from the target; switch to meshlets again for the final three seconds. |

The low orbit uses 25 on the requested camera scale (0 below, 45 horizontal, 90 above), equivalent to −40° elevation about its orbit target. A wider lens keeps the nearby stones in view while the camera stays above the terrain. Both meshlet reveals omit a text label.

Taps use the real pointerdown handler and raycast-confirmed surfaces; each reaction is checked before pointerup. Each frame advances exactly 1/30 second. Views and render modes are warmed before capture, and extra internal renders at cuts let culling settle without advancing animation.

The receiver verifies all decoded frames, dimensions, frame rate, and duration before finalizing the MP4. A JSON report records the camera path and interactions. `window.captureProgress` reports progress; call its `cancel()` method to stop. `captureVideo({ duration: 15 })` makes a short check with only taps whose reactions fit. Use a fresh receiver for another recording. Camera, renderer, controls, settings, and UI are restored afterward.

Videos, previews, and local reports stay in the ignored `exports/` directory.

## Sources

- [three.js r187 MeshletDrawingPipeline](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/pipelines/MeshletDrawingPipeline.js) and [MeshletGeometryUtils](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/utils/MeshletGeometryUtils.js).
- [SkyMesh](https://threejs.org/docs/pages/SkyMesh.html) and [r187 ClusteredLighting](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/lighting/ClusteredLighting.js).
- [Mossy Forest by Greg Zaal / Poly Haven](https://polyhaven.com/a/mossy_forest), used as a visual reference. Its panorama is neither included nor loaded.
