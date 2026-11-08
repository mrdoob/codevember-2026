# Codevember 2026 / 08 / Tesseract

A love letter to @nonotakstudio

A complete neon tesseract floating in a dark industrial room. Its 16 vertices and 32 luminous edges rotate through four dimensions, casting colored light onto a smooth coated floor and structural columns beneath a flat industrial ceiling. Frosted fluorescent tubes carry blue, green, and purple hues, with independent randomized blinking that also switches their illumination. Exposed beams, wrapped ducts, suspended rails, cable trays, and service pipes take their proportions from the room reference. The rear is open. Drifting dust catches the colored light, while three moving proxy lights cast soft shadows through the ceiling services.

Everything is procedural: tube geometry, metal fittings, the room, concrete grain, and lighting. Plain JavaScript and three.js **0.187.0**, with import maps and no build step. **WebGPU is required.** Modules load from jsDelivr.

## Run

```sh
npm start
```

Open **http://localhost:8008** in a WebGPU-capable browser. Python 3 is required. To change the port, run `python3 scripts/serve.py --port 8018`. npm dependencies are only needed for tests.

For static hosting, include `index.html`, `style.css`, the root JavaScript files, and `vendor/LTC-LICENSE.txt`. No build output or `node_modules` is required.

## Controls

- **Drag** to orbit through 360 degrees; scroll or pinch to zoom between 6 and 24 units from the target. A slow automatic orbit is enabled by default, with its toggle and speed under **Camera**.
- **Change view** cycles through seven camera positions and angles with a 1.1-second eased transition. Dragging interrupts the transition.
- **Space**, or **Pause / Play**, to play or pause.
- **Right arrow** to turn a quarter revolution in 4D.
- **C** to cycle Multicolor, Blue, Green, and Purple.
- **R** to restart and restore the camera.
- **Settings** controls rotation, perspective, radiance, tube radius, room illumination, random blinking, blink speed, electrical shimmer, floor roughness, bloom, particles, ceiling shadows, exposure, and resolution.

Reduced-motion preferences start paused and make camera changes and quarter turns immediate. Hidden tabs stop advancing. Paused scenes stop rendering when camera damping and manual rotation settle.

## Tube area lights

`TubeAreaLight` extends `THREE.Light` with local endpoints, radius, color, and radiance. Its registered WebGPU light node transforms the endpoints into view space. `TubeLightingModel` extends the physical lighting model used by the room, fluorescent diffusers, and metal fittings.

Diffuse shading analytically integrates the cosine-weighted contribution along the complete finite cylinder. Specular shading transforms that segment into a fitted GGX cosine distribution using the engine's LTC tables, including the correction for transformed tube width. Segments are clipped against both the surface horizon and the transformed cosine horizon. The tangent frame and two table samples are shared across all 32 emitters at each shaded point.

This is a thin-cylinder approximation with non-emissive end caps. It produces continuous lighting and roughness-dependent specular highlights without point-light chains or screen-space reflections. It does not trace indirect bounces or cast shadow maps. The floor applies the column-visibility approximation described below to each tube’s diffuse and specular contribution. Tube radius and radiance drive both the geometry and the lighting. Each edge has its own color and brightness attribute. The frosted tube material combines a pale, rough glass body with continuous phosphor emission. The matching area light uses the same color and transmitted radiance. Unlit tubes remain visible through illumination from their neighbors. One blink envelope controls both the visible emission and the light intensity. All four edge directions use the same peak radiance, including the links between the inner and outer cubes. **Light the room** disables illumination while leaving the visible phosphor emission and bloom intact, making the distinction easy to inspect.

The room's lighting pass runs at half resolution with MSAA. Tubes and fittings render at full resolution and are composited over the room in linear HDR, comparing depth so foreground columns correctly hide tubes behind them. Dust has its own full-resolution pass: each fragment samples room and tube depth at its screen coordinates, then surviving particles are added after the opaque composition. Normal image-based bloom, a photographic vignette in HDR, tone mapping, restrained grading, and FXAA follow composition. Device resolution is capped at 1.5× by default.

The floor has a smooth plastic-like coating with **0.15 base roughness**, faint broad color variation, and filtered expansion joints. Six-octave fractal noise creates irregular worn patches, sampled at two scales for broad patch outlines and finer scuff detail within them. **Settings → Rendering → Floor** exposes **Min roughness** (0.15), **Max roughness** (0.6), and **Texture low / high** (0.15 / 1). The first pair bounds surface roughness; the second controls patch coverage and edge contrast. Equal roughness limits produce a uniform finish. The controls keep each range ordered and update live. This detail affects gloss; the surface has no cracks, pits, or granular bump mapping. Concrete texture remains on the columns and ceiling. Four concrete columns have rounded edges, plinths, and steel capitals, placed outside the entire projected motion envelope.

The flat ceiling combines I-beams with web stiffeners and bolted splice plates, insulated round ducts, flanged sheet-metal trunks, access hatches, suspended diffuser boxes and angled louvers. Ladder trays branch into junction boxes with curved cable bundles. Smaller service pipes have couplings, flanges, handwheel valves, and sprinkler drops. Galvanized metal has fine variation in color and roughness. Ceiling assemblies share their geometry across nine instanced bays, covering the full 24-unit camera orbit. Ducts and pipework join at bay boundaries. The floor and flat deck extend 192 units in every horizontal direction so their edges stay beyond the camera's viewing range. The ceiling geometry stays above the sculpture's clearance boundary.

**Ceiling shadows** use three broad upward-facing spotlights as proxies for the blue, green, and purple tube groups. Their color and energy follow the actual emitters, including blinking and monochrome settings. Their paths follow the sculpture's eased angular travel, casting filtered PCF shadows during transitions and holding still between poses. Only overhead materials use these lights; the floor, walls, columns, particles, and sculpture retain tube illumination. Each proxy uses one 512×512 shadow map, with a default filter radius of 6. Shadow movement and softness are adjustable, and the shadow toggle preserves the overhead lighting. This is an approximation of colored ceiling illumination, separate from the floor’s tube lighting and column occlusion.

**Column shadows** attenuate each tube’s diffuse and specular floor contribution before the lights are summed. Horizontal rays toward representative points on the tube test the four column silhouettes. Diffuse light uses the closest tube point; specular light uses the point nearest the reflected viewing ray, so a column can block a bright floor reflection. A soft penumbra approximates the tube’s width and length, and a separate contact mask anchors the plinths. **Rendering → Floor** provides a toggle, strength, and softness. This needs no shadow maps or extra draw calls; it approximates partial tube occlusion and only applies to the floor.

**Floating particles** are 120,000 soft instanced billboards in one draw call. Each grain has a circular falloff and can grow beyond one pixel when close to the camera; its projected physical area controls opacity below pixel size. The default grain diameter is 3.6–12 mm, with an adjustable size control. Particle brightness defaults to 16.

A GPU compute pass evaluates the finite-cylinder solid-angle integral of all 32 tubes on a 48×24×48 world-space lighting grid. Each contribution fades smoothly from full strength at 0.75 units to zero at 2.5 units from its tube's surface. This confines illuminated dust to the sculpture's surroundings and follows its morphing edges and blinking lights. Each particle samples this half-float volume once, with trilinear interpolation, instead of integrating every light itself. The grid updates when tube positions, colors, radiance, radius, or blinking change; camera-only changes reuse it, and hiding the particles skips it. Local light colors and the fade boundary are approximated at the grid's roughly 35 cm spacing. This produces discrete illuminated dust without raymarching or changing normal bloom.

A separate **32×16×32 fluid simulation** drives the air. It transports velocity with semi-Lagrangian advection, adds gentle room circulation and vorticity confinement, then solves pressure with 20 Jacobi iterations and subtracts the pressure gradient. Velocities live on cell faces so the divergence and pressure operators agree. Room boundaries and approximate column footprints block normal flow. This follows the projection approach described in [GPU Gems: Fast Fluid Dynamics Simulation on the GPU](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu).

A GPU compute pass advances persistent particle positions and velocities through the air with drag and slight settling. The fluid simulation has no tube inputs: changing the sculpture's speed, rotation, or color does not change the particle trajectories. Tube lighting still colors the dust through the separate irradiance grid. **Air speed** controls how strongly particles follow the air, and **Air turbulence** controls the smaller eddies and vorticity confinement. Their defaults are 3 and 2 respectively.

Particle motion and fluid updates freeze when paused. Restart or a seek resets both deterministically; seeking does not replay prior fluid history. Hiding the particles suspends their simulation. Particles test both room and tube depth at screen coordinates before compositing.

## Geometry and motion

The sculpture is a single hypercube with the 16 vertices and 32 edges of `[-1,1]^4`. All edges, including the eight W-direction links, are neon tubes with matching area lights. Each frame applies an orthogonal 4D rotation and perspective projection. Instanced cylinders, fittings, and light endpoints follow those same projected vertices. Each junction has a faceted metal hub with four stepped sockets, pale ceramic sleeves, and twin metal retaining rings. The sockets follow their individual edges while staying inside the original clearance envelope.

The projected origin stays at a fixed height of 1.125 units; the floor is at −3. A nominal scale of 4 enlarges the tesseract to fill the room. Each projected frame receives one uniform scale factor that leaves at least 0.08 units between its largest fittings and the floor, flat ceiling services, or side boundaries. This keeps the proper projected shape and its origin intact while allowing it to approach the room surfaces throughout the morph. The default tube radius is 0.035 units, with adjustment up to 0.06; the fitting margin includes the largest supported joints. At rest, the default tubes have roughly 0.13 units of clearance to the floor and the conservative ceiling boundary. There are no feet or per-frame translations. Projected edge crossings remain a natural part of viewing a 4D object in 3D.

The sculpture’s morph does not drive the camera framing. The initial framing accommodates the full rotation envelope, and narrow viewports center the installation. Automatic orbit takes approximately two minutes per revolution at the default speed. Dragging temporarily takes control, and pausing also stops automatic orbit. **Change view** visits seven presets, from close floor-level views to elevated and distant angles. Horizontal orbit is unrestricted; the near side wall cuts away when the camera moves outside it. Camera altitude is constrained between −2.82 and 5.07, leaving clearance above the floor and below the ceiling services. Orbit and zoom remain available.

**Inside out**, the default, uses XW rotation alone. Each pose holds for four simulation seconds, followed by a six-second transition with quintic easing: two seconds still and three seconds moving at default speed 2. Each transition advances 45 degrees, completing one revolution in 40 real seconds. Rotations remain orthogonal throughout, preserving the hypercube's form.

Alternative modes remain in Settings: **Coupled rotation** combines XW rotation with gentle YW and ZW oscillation; **Double rotation** turns simultaneously in XW and YZ; **Multi-axis poses** visits 24 curated orientations across all six rotation planes. The latter sequence takes 240 simulation seconds, or two minutes at default speed. Optional electrical shimmer is disabled by default.

**Blink during moves** is enabled by default at blink speed 8. Each edge has its own period, phase, and changing outage duration, with brief fades at the transitions. Outages occupy 50–80% of each edge’s cycle, giving roughly 60% fully dark time while the blink clock advances. The blue, green, and purple palette stays attached to the edges as they rotate. The blink clock follows angular travel: it accelerates through each transition, slows near its ends, and freezes on each pose, retaining the last mix of lit and unlit tubes. Ceiling shadow movement uses the same eased travel, stopping with the sculpture. Pause and reduced-motion startup freeze animation; Restart resets it. Deterministic per-edge hashes make seeking repeatable without frame-rate-dependent randomness. Disable blinking to keep every tube steadily illuminated.

## Structure

| File                  | Responsibility                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `hypercube.js`        | 4D topology, rotation, and projection.                                                       |
| `pose-motion.js`      | Held poses, eased rotations, 24 multi-axis orientations, and angular travel.                 |
| `neon-pattern.js`     | Edge colors and deterministic randomized blink envelopes.                                    |
| `sculpture.js`        | Instanced neon tubes, fittings, uniform room fitting at a fixed origin, and emitter updates. |
| `tube-area-light.js`  | Custom light, WebGPU light node, analytical diffuse and LTC specular integration.            |
| `tube-integral.js`    | Independent CPU reference used for numerical validation.                                     |
| `room-layout.js`      | Shared floor, roof, and wall bounds used by the scene and fitting.                           |
| `concrete-texture.js` | Seamless concrete color, roughness, and height data.                                         |
| `studio.js`           | Batched industrial room, columns, and concrete materials.                                    |
| `ceiling.js`          | Flat deck, beams, exposed ducts, pipes, and suspended rails.                                 |
| `ceiling-lights.js`   | Three moving colored proxies with soft ceiling shadows.                                      |
| `column-shadows.js`   | Per-tube column visibility for diffuse/specular floor lighting and plinth contact shading.   |
| `tube-field.js`       | GPU compute pass and 3D texture for tube irradiance.                                         |
| `airflow.js`          | Independent 3D fluid solver, pressure projection, circulation, and column boundaries.        |
| `particles.js`        | GPU dust advection, 120,000 soft instanced grains, cached lighting, and depth occlusion.     |
| `post-processing.js`  | Room/foreground composition, bloom, grading, and antialiasing.                               |
| `camera-framing.js`   | Responsive framing and seven camera presets.                                                 |
| `main.js`             | Input, timing, rendering, and lifecycle.                                                     |
| `settings.js`         | Defaults and settings panel.                                                                 |

## Validation and capture

```sh
npm ci
npm test
```

Tests cover hypercube incidence, length-preserving rotation, loop continuity, cube exchange, finite projection, uniform projection scaling at a fixed origin, close floor/ceiling placement, flat ceiling geometry, floor and ceiling coverage across the full camera orbit, room and column clearance including fittings, matching light endpoints and per-edge emission, independent repeatable blinking, fixed-camera framing, and analytical tube illumination against numerical integration, including horizon clipping, reversal, additivity, scaling, and distant inverse-square falloff.

For deterministic inspection, use a separate tab and render each manual frame on a fresh animation frame:

```js
tesseract.manual = true;
await new Promise(requestAnimationFrame);
tesseract.seek(12);
tesseract.render();
tesseract.inspect();
// Resume:
tesseract.manual = false;
```

`window.tesseract` also exposes the room, neon and particle scenes, renderer, camera, controls, settings, sculpture, particles, irradiance field, fluid solver, and post-processing passes. `advance(dt)` respects pause, advances the morph by `dt × speed`, and advances the air clock `lightTime` by `dt`. `seek(seconds)` resets these clocks and derives angular travel for deterministic capture. Blinking and ceiling movement advance with angular travel when rendering; fluid motion uses the independent air clock. Save screenshots in the ignored `exports/` directory.

## References and license

The analytical line-light implementation is adapted from the [LTC reference code](https://github.com/selfshadow/ltc_code/blob/master/webgl/shaders/ltc/ltc_line.fs). Its copyright notice and redistribution terms are retained in [`vendor/LTC-LICENSE.txt`](vendor/LTC-LICENSE.txt).

- Eric Heitz, Jonathan Dupuy, Stephen Hill, and David Neubelt. [Real-Time Polygonal-Light Shading with Linearly Transformed Cosines](https://eheitzresearch.wordpress.com/415-2/). ACM Transactions on Graphics (SIGGRAPH 2016), 35(4).
- Eric Heitz and Stephen Hill. [Real-Time Line- and Disk-Light Shading with Linearly Transformed Cosines](https://blog.selfshadow.com/publications/s2017-shading-course/heitz/s2017_pbs_ltc_lines_disks.pdf). SIGGRAPH 2017 course.
