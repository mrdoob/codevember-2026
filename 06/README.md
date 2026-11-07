# Codevember 2026 / 06 / Orrery

[View experiment](https://mrdoob.github.io/codevember-2026/06/) · [Source](https://github.com/mrdoob/codevember-2026/tree/main/06)

An animated bronze orrery on a travertine pedestal, surrounded by a warm plaster room. Five coloured glass planets orbit an opal sun. Wind moves the foliage behind a paper window and its shadows across the room. Night reveals coloured caustic projections, soft light shafts, and drifting dust.

All geometry, materials, foliage, and environment lighting are procedural. There are no imported models, image textures, or HDR files. The rendering combines physical transmission, screen-space global illumination (SSGI), screen-space reflections (SSR), temporal denoising, and subtle background depth of field.

Plain JavaScript with an import map and no build step. **WebGPU is required.** The engine and addons load from three.js dev commit **`a70ee1ad92a681b7b8c42d23b6ede4febb28b25c`**, pinned through jsDelivr. Internet access is needed for those imports.

## Run

```sh
npm start
```

Open **http://localhost:8006** in Chrome for Testing or another WebGPU-capable browser. The server requires Python 3. Use `python3 scripts/serve.py --port 8016` for another port. npm dependencies are only needed for tests.

For static hosting, keep `index.html`, `style.css`, the root JavaScript files, and `vendor/` together on an HTTPS host. Scripts, tests, npm dependencies, and local exports are not runtime dependencies. `file://` is unsupported.

## Controls

- **Drag a planet** to wind the coupled carriers with easing and release momentum. Hover and grab highlights fade smoothly. Auto orbit continues during winding.
- **Drag the background** to orbit; scroll or pinch to zoom.
- **Change View** cycles through eight framings, including close views of the mechanism and base.
- **Day / Night** animate the outdoor sun's position, illumination, and window shadows.
- **SSGI / SSR** toggle the two effects independently. **Compare** shows a fixed 50/50 view of base lighting and the selected effects.
- **Settings** contains Motion, Lighting, Screen space, and Glass controls. Defaults include time speed 1, indirect light 6, caustic strength 0.5, IOR 1.7, and transmission 1. **Refraction blur** softens only the transmitted image; its default footprint is 2 CSS pixels.
- **Left / Right** wind time; **G / S / C** toggle SSGI, SSR, and comparison; **R** restores the starting camera.

Reduced-motion preferences start paused with auto orbit disabled. Hidden tabs stop advancing. Startup precompiles scene materials asynchronously and waits for the first GPU frame before revealing controls. Paused scenes render settling frames after changes, then stop drawing. Pointer cancellation, lost focus, and lost capture safely release a grabbed planet.

## Implementation

- `main.js` assembles the scene and drives rendering; `settings.js` holds defaults and the Settings panel.
- `orrery.js`, `plinth.js`, and `geometry.js` build the mechanism. Hollow concentric sleeves support the carriers, bearings support the tilted hoop, and struts support Saturn's ring. Moving assemblies retain clearance through a full revolution. `motion.js` provides coupled motion, easing, and frame-rate-independent release momentum; `winding.js` projects the pointer onto each orbit.
- `materials.js` and `surface-materials.js` shade brushed bronze, brass, stone, plaster, and the sun. Metal wear and stone/plaster fields are baked once on the GPU into mipmapped textures. Fine irregular scratches affect bump, roughness, and colour; subpixel detail fades to reduce shimmer.
- `room.js` builds four walls, the recessed paper window, double doors, tiled floor, and four lit vase niches with oak shelves and white flowers. `foliage.js` shares wind deformation between colour, shadow, and motion-vector passes. `paper-foliage.js` captures the animated leaves from the paper. The final background depth of field supplies softness; there are no separate leaf-depth blur passes.
- `studio.js` creates the environment, window fill, and shadow-casting ProjectorLight. `lighting-transition.js` eases Day/Night changes. `pcss-shadow.js` filters the projector's shadows, with extra diffusion on the paper.
- `sphere-area-light.js` approximates the finite sun with analytic diffuse irradiance and twelve-segment LTC specular integration. Distant surfaces use the punctual approximation; room materials omit the unused finite-source shader branch entirely. A softly filtered 512-pixel point-light cube map supplies shadows from the instrument and pedestal; it does not model area-light penumbras.
- `glass.js` and `filtered-transmission.js` use physical transmission with a sphere-specific refracted chord length, volume absorption, dispersion, and frosting. Neutral surface colour avoids filtering the transmitted light twice. The opaque-scene transmission buffer retains HDR radiance before tone mapping; absorption can still tint bright sources. Transmission reuses its existing mip pyramid with a minimum sampling footprint, leaving surface roughness and highlights unchanged and adding no render passes. Setting Refraction blur to zero restores the stock filtering. The transmission lighting model follows the pinned upstream optics, with the sampling LOD as the only optical change.
- `caustics.js` projects broad coloured lens patterns along the actual sun/planet axes. Their wall emission participates in SSGI. `light-shafts.js` and `beam-dust.js` add eight faint sun shafts, coloured planet cones, and 2,240 drifting motes at Night. These are artistic approximations, not photon tracing, and do not resolve secondary beam occluders.
- `background-dof.js` keeps a focus volume around the instrument sharp while softening the room. A half-resolution 24-tap gather reuses colour and depth, rejects foreground samples, and preserves premultiplied coverage. This is background defocus without foreground blur or a full optical lens simulation.

### Screen-space rendering

`post-processing.js` manages the G-buffer and effect graph:

1. **Scene:** fixed DPR 2, with octahedral normals and packed material flags keeping the G-buffer within WebGPU's default colour-attachment byte limit. Environment and area-light specular are captured separately.
2. **SSGI:** one-third resolution, two slices and eight steps. Colour bounce and contact shading come from the visible scene. Metals reject diffuse GI; glass receives it in proportion to its non-transmitted fraction.
3. **SSR:** 0.375 resolution, stochastic GGX rays, binary refinement, and dielectric Fresnel from the glass IOR. Hit coverage replaces the corresponding environment/area-light specular contribution. The room floor and matte surfaces skip SSR; the pedestal and instrument retain it.
4. **Denoising:** the merged upstream `DenoiseNode` uses separate GI and SSR histories, motion/depth/normal rejection, and two spatial iterations each. SSR also supplies roughness and hit distance. Reflection radiance stays premultiplied by hit coverage through filtering and upsampling to avoid bright speckles near missed rays.
5. **Finish:** shafts and dust, background defocus, temporal antialiasing, restrained bloom, and ACES tone mapping. Camera cuts and resize reset temporal histories. Disabling an effect removes its passes from the active graph; diagnostic views explicitly request the selected pass.

Screen-space effects cannot recover hidden or off-screen geometry. Transmission samples the opaque scene and does not trace an unlimited chain of transparent objects. Temporal filtering may briefly lag abrupt changes. The orrery is an artistic mechanism rather than an astronomical ephemeris.

## Validation

```sh
npm ci
npm test
```

Tests cover coupled winding, eased pointer tracking, release settling, reversal and cancellation, angular wraparound, pause/drag state, refresh-rate independence, Day/Night transitions, and swept-volume clearances measured from the generated geometry. CPU geometry tests use three.js 0.187.0; browser checks use the pinned dev build.

`window.orrery` exposes the scene, renderer, camera, controls, settings, clock, model, glass, studio, post-processing, and GUI, along with `pause()`, `reset()`, `resetView()`, `setView('Desk')`, `advance(dt)`, `render()`, and `inspect()`.

For deterministic browser captures:

```js
orrery.manual = true;
orrery.pause(false);
orrery.advance(1 / 30);
await new Promise(requestAnimationFrame);
orrery.render();
```

Allow a fresh animation frame between renders because three.js caches pass updates within a frame. `advance()` respects pause and drag state. Set `orrery.manual = false` to resume normal playback. The live loop caps catch-up at 0.05 seconds. Screenshots and local reports belong in the ignored `exports/` directory.

## Sources

- [three.js dev commit `a70ee1a`](https://github.com/mrdoob/three.js/commit/a70ee1ad92a681b7b8c42d23b6ede4febb28b25c), including the upstream denoiser and SSGI fixes.
- `vendor/HoustonStratifiedNoise.js`: unchanged from [bhouston/three.js PR #121](https://github.com/bhouston/three.js/pull/121), commit `eb7187278b74e41c7b0ea420ef78d781ee891366`. See [Houston Stratified Noise](https://ben3d.ca/blog/houston-stratified-noise) for the sampling rationale. SSR uses it; SSGI retains its original sequence.
- `vendor/SSRNode.js`: three.js 0.187.0 SSR with the two analytic-noise calls replaced by Houston Stratified Noise and imports redirected to the pinned addons. Ray marching and BRDF code are unchanged.

Vendored modules retain the three.js MIT license and source notices in `vendor/`.
