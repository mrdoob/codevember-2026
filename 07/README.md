# Codevember 2026 / 07 / Hollow

Shapes all the way down.

An endless journey through nested metal primitives. Each object splits into two hollow shells, revealing a colored brushed-metal interior and the next shape inside. Everything is procedural: geometry, colors, surface textures, reflections, and studio lighting.

Plain JavaScript and three.js **0.187.0**, with import maps and no build step. **WebGPU is required.** Runtime dependencies load from jsDelivr.

## Run

```sh
npm start
```

Open **http://localhost:8007** in a WebGPU-capable browser. The server requires Python 3. To use another port, run `python3 scripts/serve.py --port 8017`. npm dependencies are only needed for tests.

For static hosting, publish `index.html`, `style.css`, and the root JavaScript files over HTTPS. No build output or `node_modules` is required.

## Controls

- **Drag** to adjust the camera.
- **Space** to play or pause.
- **Right arrow** to advance to the next layer.
- **R** to restart.
- **Settings** controls speed, materials, camera motion, reflections, depth of field, resolution, and color grading.

Reduced-motion preferences start on a paused reveal; advancing selects another still. Hidden tabs stop advancing, and paused scenes stop rendering after camera movement settles. Default resolution is capped at 1.5× device pixels; 2× is available in Settings.

## Structure

| Module              | Responsibility                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| `bootstrap.js`      | Startup and error display.                                                   |
| `main.js`           | Rendering loop, input, focus tracking, and resource cleanup.                 |
| `settings.js`       | Default values and the lil-gui panel.                                        |
| `journey.js`        | Bounded layer progression, opening, spin, fade, and seeded colors.           |
| `geometry.js`       | Eleven softened primitives and watertight hollow walls with thick cut edges. |
| `shells.js`         | Reusable shell slots, edge hinges, reflection probes, and retirement.        |
| `camera-motion.js`  | Shared orbit, fixed camera distance, and gentle pitch/yaw sway.              |
| `materials.js`      | Noisy silver, polished edges, colored brushed metal, and fade shaders.       |
| `depth-of-field.js` | Separate foreground/background blur and color grading.                       |
| `studio.js`         | Procedural light cards, environment, area lights, and soft shadows.          |

## Motion and rendering

The sequence starts with hexagonal bipyramid, icosahedron, barrel, and hexagonal prism, then dodecahedron, octahedron, cylinder, capsule, sphere, rounded cube, and triangular prism. Interior colors follow an independent 32-bit hue permutation.

A layer lasts six seconds. Splitting starts immediately and eases open over 5.04 seconds. Objects and departing halves keep the same continuous spin; edge hinges add up to 17.2° of outward tilt. Translation follows a fixed direction with continuing drift. The camera and sculpture share an orbit, keeping the cut oblique and the central view clear by construction. The camera never rolls.

Scaling only relative layer offsets gives the impression of endless forward travel without ever-growing coordinates. Eight reusable slots hold at most five active roots: the previous shell, the current object, and three descendants. Departing shells fade into the background over their final 3.3 seconds, including their reflections and shadows, then leave when the second subsequent split begins.

Closed objects use continuous outer meshes. Split surfaces retain the same texture coordinates. Each slot has a small HDR cube probe capturing its immediate enclosing shell; a 17-tap filter softens that reflection over the static studio environment. This approximates local reflections rather than tracing every mutual reflection.

Depth of field keeps a sharp band extending 2.0 scene units toward the camera and 2.6 behind the focus plane. Foreground and background use separate full-resolution Gaussian filters, with maximum radii of 14 and 26 CSS pixels at the default lens strength. Each field's color is premultiplied by its coverage before filtering to prevent sharp surfaces leaking into the blur. This remains a screen-space approximation: partially defocused surfaces blend sharp and filtered images, and hidden background is estimated from neighboring pixels.

Color grading applies white balance in linear HDR, followed by tone mapping, contrast, and saturation. Defaults are exposure **0.75**, warmth **−1**, and tint **−1**. Grading stays active when depth of field is disabled. Soft variance shadows can show light leakage around thin or overlapping surfaces.

## Validation

```sh
npm ci
npm test
```

Tests cover shell topology and winding, nesting and camera clearance, bounded recycling, continuous rotation and departure, edge hinges, fade and retirement, color variation, deterministic seeking, and billion-layer transforms.

Run the GPU regression checks in the served page's browser console:

```js
await (await import("./tests/rendering.browser.js")).runRenderingChecks();
```

These use a separate, unattached canvas to check near/far depth leakage, disabled blur, the final background tint, and zero reflection coverage after fading.

For deterministic inspection, `window.hollow` exposes the scene, renderer, camera, settings, journey, shells, and rendering controls:

```js
hollow.manual = true;
hollow.seek(1.3);
await new Promise(requestAnimationFrame);
hollow.render();
hollow.inspect();
hollow.manual = false;
```

Allow a fresh animation frame between manual renders. `advance(dt)` respects pause; `seek(depth)` selects an exact state. Save captures in the ignored `exports/` directory.

## Video capture

The capture follows the earlier days: **1024 × 1024 H.264 MP4 at 30 fps**, rendered at 1536 × 1536 and downsampled. This sequence runs for **66 seconds**, showing all eleven shapes for six seconds each, starting with the hexagonal bipyramid. The title and collapsed Settings panel are included at √2 UI scale, with no cursor.

Start the local page normally, then run the receiver in another terminal (FFmpeg and ffprobe must be on PATH):

```sh
python3 scripts/capture-server.py --previews
```

Set the browser viewport to **1024 × 1024 at device scale 1**, then run:

```js
await (await import("./scripts/capture-video.js")).captureVideo();
```

For this recording, appearance seeds repeat after eleven layers and the camera completes one orbit with periodic sine motion. Shape IDs continue advancing, so nesting, shell lifetime, and motion remain continuous. The ordinary interactive journey keeps its independent, nonrepeating colors and orientations.

Sixty-four preceding frames initialize the enclosing shells, reflection probes, and shadows before recording starts. The capture compares the rendered loop endpoint with frame zero before recording and again after the complete sequence. The endpoint is omitted from the video: the last frame is exactly one time step before the first, with no duplicated frame or crossfade. Motion and camera tests also check matching transforms and boundary velocity.

Each lossless PNG is acknowledged before the next frame. The receiver verifies all 1,980 decoded frames, resolution, frame rate, and duration, then writes a JSON report with the shape sequence, loop comparison, and frame hashes. `--previews` saves selected PNGs alongside the video. Outputs go into `exports/`; existing videos are never overwritten. To choose a filename, pass it to the receiver before `--previews`.

`window.captureProgress` reports status and frame count; call `captureProgress.cancel()` to stop. The renderer, camera, journey, settings, and UI are restored afterward. The sequence is defined in `scripts/capture-sequence.js`.
