# Codevember 2026 / 02 / Shatter

Solid glass primitives fall, fracture on impact, and scatter across a dark studio with cyan and magenta lighting. Drops cycle through **Cone, Capsule, Cube, Cylinder, Torus, Octahedron, and Sphere** every 3 simulation seconds. Each dropped object gets its own tint, shared by its shards, and starts with a randomized X-axis tilt and a random spin axis and speed. The camera travels forward while objects spawn at a constant horizontal offset from it, leaving a trail of shattered glass. Rendering extends day 01's physical glass shading with fracture normals, roughness variation, exit-surface refraction, absorption, and dispersion. Box3D simulates the solid pieces and their collisions.

## Run

```sh
npm start
```

Open http://localhost:8002 in a WebGPU-capable browser. Python 3 is required for the local server. There is no build step; the browser loads three.js **0.187.0** and **box3d.js 0.1.1** (single-threaded, inlined WebAssembly) from jsDelivr, so it requires internet access. Use `python3 scripts/serve.py --port 8003` for another port.

## Controls

- Click the scene or press Enter to drop the next primitive. **Cycle shapes** in Settings controls automatic shape selection.
- Drag to orbit; scroll or pinch to zoom.
- **Space** pauses/resumes. **Settings → Simulation → Reset simulation** clears the trail and returns the camera and drop point to the start.
- Settings adjusts automatic drops, camera travel speed, time scale, fracture energy, impact-speed threshold, minimum drop height, tint balance, color density, roughness, IOR, refraction, fracture detail, absorption, dispersion, floor reflections, reflection blur, contact shading, exposure, and resolution.

## Geometry and simulation

Primitive mode is active. Letter imports, font loading, geometry generation calls, and keyboard queue integration are commented out in `main.js`; `letters.js` and the font assets are retained for switching back. Letter geometry remains covered by the tests.


`letters.js` extrudes Helvetiker Bold outlines into 2.8-metre-high, 0.6-metre-deep solids. It triangulates the outlines with their holes and merges adjacent triangles into convex polygons. These become closed prisms for fracture and collision; O, D, B, and R keep their openings. `fracture.js` partitions the complete letter volume into 48 seeded Voronoi cells with capped interior fracture planes. Cells spanning disconnected strokes split into separate shards. Internal prism interfaces are removed from the rendered surface. The fragments are solid volumes, not extruded surface patches. A narrow normal interpolation band softens the lighting at sharp fracture edges without changing the enclosed volume.

`simulation.js` runs Box3D at a fixed 240 Hz with four solver substeps, continuous collision detection, friction, restitution, sleep, and collisions between shards. Mass comes from the convex volumes at a glass density of 2500 kg/m³. Public positions and velocities use metres and seconds; the engine uses 10 internal length units per metre to tighten small-fragment tolerances. Complex cells are decomposed into convex parts to fit Box3D's hull limits, with support-point simplification bounded to 1 mm.

Breakup is triggered by measured contact approach speed. Each new body inherits the parent motion at its own centre of mass. Radial separation spends at most the selected fraction of energy lost at impact, preserves net linear momentum, and adds no radial torque. Contact impulses generate subsequent spin. A conservative floor guard corrects residual vertex penetration from the soft contact solver and applies a normal impulse through Box3D using the body's world inverse inertia. Debris stays in world space as the camera moves. Once every shard is fully behind the camera, the whole drop is removed, including its physics bodies. Drops entirely beyond the fog are also retired. A 12-drop cap also bounds rapid manual drops or a stationary camera. The floor collider periodically recenters beneath the active stretch of trail.

`journey.js` translates the camera, orbit target, and launch point together. Travel follows the horizontal viewing direction, responds to orbiting, and pauses with the simulation. The studio floor lighting follows the launch point. Spawn height clears the camera’s top frustum plane by the full object radius, so even rotating objects begin outside the screen after zooming, orbiting, or resizing. The height control sets a minimum.

This is a rigid-body fracture approximation: the crack pattern is precomputed, the break threshold and released-energy fraction are adjustable, and cracks do not propagate through an elastic stress simulation. Fragments do not break again.

`glass.js` bends rays at the entry and exit surfaces. An additional back-face pass stores exit normals, depth, and an object ID; the ID prevents another shard from supplying the exit surface. The depth peel supplies refraction through another visible layer, with a studio-floor/backdrop fallback for missed and off-screen transmitted rays. Total internal reflections sample the lighting environment. Beer–Lambert attenuation varies with optical path length, and a small spectral IOR offset separates the environment's RGB rays. Hidden exit surfaces fall back to mean chord thickness. Internal reflection uses an environment approximation; this is not volumetric path tracing or unlimited multiple refraction.

`surface.js` creates 1024² tangent-space normal and roughness maps from conchoidal ripples, fine fracture ridges, and sparse scratches. Geometry attributes distinguish broken faces and edge bands from the smoother original exterior. Texture strength stays attached to the glass and independent of render resolution.

The studio uses broad neutral key/fill lights, narrow cyan and magenta rim lights, jewel-colored glass, and a dark glossy floor. `studio-lighting.js` combines an overhead key, broad neutral fill, a rear strip, and restrained cyan/magenta rims. The reflection environment uses feathered softboxes and a neutral gradient surround, captured at object height to retain midtones inside the glass. Area lights approximate the softboxes’ average emission and follow the launch point as the camera travels. `floor-surface.js` supplies periodic roughness and normal maps, sampled in world space so the texture stays fixed as the camera travels. Roughness varies subtly around the Floor roughness setting (default 0.22); Floor bump adjusts the shallow surface relief. Both feed the floor lighting and SSR from the same material inputs. No bloom or projected caustics are added. `studio.js` shares the floor palette with the refraction fallback. Stochastic screen-space reflections (SSR) sample a GGX lobe using the material roughness and bump-perturbed view normals. Dielectric Fresnel and microfacet masking weight the reflected radiance, which contributes indirect specular light instead of an opacity overlay. Motion-vector reprojection and depth/normal/roughness-aware denoising stabilize the samples; some noise or temporal lag can remain during rapid changes. Subtle GTAO contact shading grounds the fragments. SSR can only reflect visible screen-space geometry; reflections of hidden or off-screen shards are not available.

The Color grading GUI folder exposes exposure, contrast, saturation, and temperature. Exposure operates before tone mapping; the other controls grade the image after tone mapping and before antialiasing.

## Validation

```sh
npm ci
npm test
```

Node.js tests use the same pinned three.js and Box3D versions as the browser. They check all 26 letters (including unblocked counters) and all seven primitives for volume conservation, closed cuts, collision-hull bounds, impact timing, floor clearance, inter-shard contact, settling, mass and momentum preservation, bounded breakup energy, consistent stepping at 30/120 fps, gentle contacts, debris impacts, physics resource cleanup, fixed launch distance, camera reset, distant trail cleanup, and cleanup after the camera passes the last shard.

For browser inspection and deterministic capture, `window.shatter` exposes `pause`, `reset`, `selectShape`, `drop`, `advance`, `render`, the material uniforms, `journey`, and the simulation. `simulation.engine` identifies the active solver; `simulation.counts` reports bodies, shapes, and contacts. `advance` takes at most 0.1 seconds per call. Set `settings.auto = false` before stepping a single drop.

## Video capture

The capture scripts reuse day 01's ordered PNG-to-FFmpeg workflow and √2-scaled title/Settings overlay. With the site running, start a receiver (requires `ffmpeg` and `ffprobe`):

```sh
python3 scripts/capture-server.py exports/shatter-1024x1024-60s-high.mp4 --previews
```

In a separate browser tab, set the viewport to 1024 × 1024 with device pixel ratio 1, then run:

```js
const { captureVideo } = await import('./scripts/capture-video.js');
await captureVideo({ duration: 60 });
```

High resolution renders at 1536 × 1536 before downsampling to the 1024 × 1024 export. Capture resets the scene and verifies no object is visible in the first frame. Each output frame advances the simulation by `speed / 30`, preserving the scene's slow-motion setting. The receiver verifies all 1,800 frames, 30 fps, dimensions, and duration before finalizing the MP4. `window.captureProgress` reports progress; setting its `cancelled` flag stops capture. Use a fresh receiver and output filename for each recording.

## Physics sources

- [Box3D](https://github.com/erincatto/box3d), by Erin Catto.
- [box3d.js](https://github.com/isaac-mason/box3d.js), WebAssembly bindings by Isaac Mason.

The bundled Helvetiker Bold typeface comes from the three.js examples. Its Magenta copyright and permission notice are preserved in `assets/FONT-LICENSE.txt` and the original font JSON.
