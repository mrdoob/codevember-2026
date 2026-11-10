# Codevember 2026 / 10 / Caustic

A sunken observatory of light. A floating glass sphere refracts rainbow caustics onto limestone terraces, surrounded by schools of fish, swaying algae and distant columns disappearing into blue fog.

[Open the experiment](https://mrdoob.github.io/codevember-2026/10/)

Plain JavaScript with **Three.js WebGPURenderer and TSL**. Core and addons load from jsDelivr at commit [`a70ee1ad92a681b7b8c42d23b6ede4febb28b25c`](https://github.com/mrdoob/three.js/commit/a70ee1ad92a681b7b8c42d23b6ede4febb28b25c) (`188dev`), which includes the SVGF denoiser. WebGPU is required. There are no npm runtime dependencies or application build steps.

## Run

```sh
cd 10
npm start
```

Open **http://localhost:8010**. The development server requires Python 3 and disables caching. Use `python3 scripts/serve.py --port 8020` for another port.

Static hosting needs `index.html`, `style.css` and all root JavaScript files, served over HTTPS or localhost. Tests and development scripts are optional. All geometry, textures and environment lighting are generated procedurally.

## Controls

| Control                   | Action                                                                      |
| ------------------------- | --------------------------------------------------------------------------- |
| Drag / scroll or pinch    | Orbit / zoom                                                                |
| Ripple / R / double click | Send a wave through the water and caustics                                  |
| Change view / Right arrow | Cut to the next camera view                                                 |
| Pause / Space             | Pause or resume the shared animation clock                                  |
| F                         | Toggle the sphere's vertical motion                                         |
| H                         | Hide or show the interface                                                  |
| Settings                  | Adjust optics, atmosphere, color grading, marine life, particles and camera |

The eight views cycle through Observatory, Amber school, Azure school, Green school, Yellow school, Across the dais, Through the columns and Terrace overlook. School views follow the actual fish centroid and heading; dragging returns to Free orbit. Auto orbit is enabled by default.

The sphere emits a ripple when it rises into the surface. Its 20-second cycle reaches an 8 cm gap above the pedestal. Fish, plants, water, particles and following cameras share the same clock. Reduced motion starts paused; hidden tabs stop advancing time. Paused rendering settles the reflection history, then sleeps until something changes.

Settings includes independent fog and color-grading resets. Fog uses distance from the camera, with density 1.5, color `#295661` and start distance 4.5 m. Exposure defaults to 1.5, temperature to 0.25, saturation to 1.15, contrast to 1.5 and vignette to 1. Auto resolution caps rendering at approximately 1.2 million pixels and 1.5× device scale; explicit 1×, 1.5× and 2× overrides are available.

## Rendering

### Caustics and glass

`optics.js` computes refracted photon sheets from ten periodic water waves and six ripple packets. Rasterized area ratios concentrate irradiance where the sheet folds. Seven spectral bands produce chromatic separation, normalized independently per RGB channel. A 512² source sheet feeds the periodic water map; a separate 384² sheet traces water and glass into the pedestal receiver. Both maps are 2048², with Gaussian reconstruction, mipmaps and anisotropic sampling. Wavelengths share an instanced draw, and the maps reuse one reconstruction scratch target.

`crystal-optics.js` traces a water-filled glass shell, including four interfaces for rays crossing its core. The visible sphere and its photon map share this tracer. A live 384² cube capture supplies dispersed refraction and Fresnel reflection, with approximate parallax correction and absorption. The default shell thickness is 0.16 m; the refractive-index control is relative to surrounding water. Camera rays intersect the analytic sphere to keep grazing refraction and reflection normals consistent.

`caustic-lighting.js` modulates native direct sunlight on stone, fish and algae. Caustics redistribute incident light rather than add self-emission: the material BRDF, point-light attenuation and opaque shadows apply to them. PMREM fill, baked stone bounce and fish emission remain independent. Sphere photons replace the water field beneath the globe's soft incident footprint.

### Water and reflections

`water.js` uses analytic normals, water-to-air Fresnel and total internal reflection. `water-reflection.js` captures the scene with a mirrored camera every frame. Its multisampled, mipmapped target is capped at 1200 pixels wide. A warped planar capture and the environment cover SSR misses. The canopy has a white opening and broad cyan halo, without a projected caustic overlay.

`post-processing.js` traces stochastic SSR at half resolution and denoises it with SVGF, retaining up to six frames. Water and glass replace their captured reflection terms; fish replace the native single-scattering PMREM lobe using their DFG response, Fresnel, iridescence and roughness. Stone uses its rough PMREM finish. SSR samples the lit scene and is composed before fog, particles and color grading. There is no SSGI or screen-space AO.

Octahedral normals and packed surface metadata keep the attachment budget bounded. Fish retain previous instance and tail poses for correct motion vectors. Water-confidence derivatives are evaluated before material selection: moving them into a divergent branch can produce NaNs that spread through bloom. Photon-area derivatives likewise precede validity discards. SMAA keeps silhouettes stable without temporal camera jitter.

### Architecture and atmosphere

`architecture.js`, `stone-geometry.js` and `room.js` build sixteen beveled terraces, three dais steps, the pedestal and twelve sculpted columns evenly spaced on one ring. Static stone is merged into two material batches plus the pedestal. The final tread extends to a 60 m radius and fades into the fog.

One overhead point light casts shadows using six 2048² faces and PCF radius 2. Its shadow map updates once per animation frame and is shared by the optical captures. `environment.js` bakes a procedural 256² PMREM with cyan canopy light and warm stone bounce. Stair and pedestal sides receive additional warm irradiance baked into vertex colors. `stone-texture.js` supplies mipmapped relief; `moss.js` follows seams, column bases and the actual algae roots.

Fog uses reconstructed radial distance with transmission `exp(-((max(distance - start, 0) * density * 0.06) ** 2))`, plus colored absorption. `light-shafts.js` adds a localized volume below the surface opening using 64 fixed midpoint samples at half resolution, caustic illumination, point-light shadows and depth-aware reconstruction. It uses no jitter or temporal history. Bloom, Neutral tone mapping and `color-grading.js` complete the image.

### Marine life and particles

`fish-simulation.js` runs deterministic steering at 60 Hz: separation, alignment, cohesion, predictive obstacle avoidance and loose school guides. A sorted spatial sweep limits neighbor searches. The 1,164 instanced fish occupy four schools at distributed depths, plus twelve reef fish. The amber school starts to the right of the opening view and swims left past the initially unobstructed sphere; the other schools begin around the scene. Interpolated poses and limited turning rates avoid flips. `marine-life.js` deforms bodies, normals and previous poses on the GPU; fish cast and receive shadows and caustics. Native transmitted shadow maps filter sunlight with each school’s color: bodies retain a dense shadow, fins transmit more light, and eyes stay opaque. Fish surfaces remain opaque; the effect adds no emissive light or extra shadow render pass.

Each fish has 712 indexed vertices and 1,160 triangles. `fish-texture.js` generates two 256² textures for overlapping scale plates, normal relief, fin rays, roughness and thin-film iridescence. Fin gradients and eye geometry share the same mesh and material. Storage buffers keep instance transforms within GPU binding limits.

`algae-geometry.js` and `algae-material.js` render 1,008 tall and 4,096 small tapered blades. A shared current and per-blade flutter move the plants with anchored roots and matching deformed normals. Vertex colors, 45% rough transmission and a 0.02 m optical thickness suggest thin leaves without alpha dithering or subsurface scattering.

`particles.js` draws 32,000 drifting grains. Following Day 08, `particle-light-field.js` caches incident illumination in a 40×16×40 grid, combining the sun, approximate column occlusion, PMREM, caustics and nearby fish emission. The particles soften against scene depth and fade according to lighting and fog; dark grains remain unobtrusive.

## Approximation boundaries

This is a real-time optical study, not a full light-transport solution. Photon paths follow Snell's law and are normalized against a flat interface, but finite resolution limits sharp focus. Water caustics are computed at floor depth and reprojected onto higher receivers; ripple response combines bounded inverse lookup with approximate curvature-based focusing. Sphere photons trace the full ripple field into a receiver at pedestal height. Dispersion is exaggerated for visible rainbow fringes, and interface losses do not account for every internal reflection.

Reflection probes use floor and water-plane parallax proxies. SSR sees only screen-visible geometry. PMREM and baked vertex light approximate indirect illumination; moving fish do not produce global illumination on stone. Colored fish shadows are an artistic transmission approximation using the nearest caster in the shadow map; they do not accumulate multiple overlapping filters or retain every opaque blocker behind a fish. The localized shafts still use depth-only shadow visibility. Background fog is an analytic blend, while shafts approximate single scattering. Shafts and particles are composed in the main view and do not appear recursively in optical captures. Algae transmission samples the opaque scene rather than recursively refracting other leaves.

## Validation

```sh
npm test
```

The CPU suite checks deterministic fish playback, pause/rewind, bounded turns, obstacle clearance and full-depth swimming, plus sphere clearance, periodicity, surface contact and frame-rate-independent ripple timing.

GPU checks run in the served page's console after startup, from the Observatory view. Run them sequentially:

```js
await (await import("./tests/environment.browser.js")).checkEnvironment();
await (await import("./tests/optics.browser.js")).checkOptics();
await (await import("./tests/scene.browser.js")).checkScene();
await (await import("./tests/reflections.browser.js")).checkReflections();
await (await import("./tests/crystal.browser.js")).checkCrystalReflections();
await (
  await import("./tests/fish-reflections.browser.js")
).checkFishReflections();
await (await import("./tests/lighting.browser.js")).checkLighting();
await (
  await import("./tests/caustic-lighting.browser.js")
).checkCausticLighting();
await (await import("./tests/marine.browser.js")).checkMarine();
await (await import("./tests/fish-shadows.browser.js")).checkFishShadows();
await (await import("./tests/particles.browser.js")).checkParticles();
await (await import("./tests/scale-relief.browser.js")).checkScaleRelief();
await (await import("./tests/algae.browser.js")).checkAlgae();
await (await import("./tests/light-shafts.browser.js")).checkLightShafts();
```

These checks measure actual GPU output: photon energy and spectral separation, independent environment lighting, reflection contributions, motion vectors, cast shadows, colored transmission on an isolated stone receiver, caustic suppression in shadows, scale normals, plant movement, particle lighting and stable volumetric scattering.

`window.caustic` exposes scene components and settings, plus `pause()`, `ripple()`, `changeView()`, `setView(name)`, `reset()`, `advance(dt)`, `render()`, `inspect()` and `dispose()`. For deterministic captures, set `manual = true`, unpause, advance a fixed step and render. Wait for a new animation frame between renders for Three's pass cache. Set `manual = false` to resume playback. Local screenshots and reports belong in ignored `exports/`.

The refracted-light area-ratio technique is inspired by [Evan Wallace's WebGL Water](https://madebyevan.com/webgl-water/); this implementation uses native TSL.

## Video capture

The video uses the previous days' format: a silent **60-second, 1024 × 1024 H.264 MP4 at 30 fps**, rendered at 1536 × 1536 and downsampled. Each of the eight saved views lasts six seconds, followed by six seconds each revisiting Amber school and Azure school. Cuts are immediate. The simulation advances continuously, with the existing slow orbit in architectural views and live school tracking in fish views.

The title, description and collapsed Settings label appear at √2 UI scale; the footer and cursor are omitted. Reflection history settles at each cut without advancing the animation or adding duplicate video frames.

Start the experiment on port 8010, then start the receiver in another terminal (FFmpeg and FFprobe must be on PATH):

```sh
python3 scripts/capture-server.py --previews
```

In a separate browser tab with a **1024 × 1024 viewport and device scale 1**, run:

```js
await (await import("./scripts/capture-video.js")).captureVideo();
```

The receiver acknowledges each lossless PNG before accepting the next frame, then verifies all 1,800 decoded frames, dimensions, frame rate and duration. Video, metadata and optional preview frames go into ignored `exports/`; existing outputs are never overwritten. Pass an output filename to the receiver to name the export. `captureVideo({ duration: 1 })` records a short opening check. `window.captureProgress` reports progress and provides `cancel()`. The session restores the scene clocks, ripple packets, settings, camera, renderer and interface afterward. The shot order is defined in `scripts/capture-sequence.js`.
