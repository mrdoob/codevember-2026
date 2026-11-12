# Codevember 2026 / 11 / Rust

A large, corroded naval mine rises slowly from below, uncoiling a single heavy tether until the chain catches and stops it. The tether catches it lower in the frame, leaving space above its horns. Drag the shell sideways to swing it, or upward to break the iron. The camera slowly orbits as the mine floats out above, the detached chain falls, and another mine rises from below. Fine bubbles escape from the shell, while flexible algae trails behind its motion.

Plain JavaScript with **WebGPURenderer and TSL**, pinned to Three.js dev commit [`a70ee1ad92a681b7b8c42d23b6ede4febb28b25c`](https://github.com/mrdoob/three.js/commit/a70ee1ad92a681b7b8c42d23b6ede4febb28b25c) (`188dev`). **Box3D 0.1.1** handles rigid-body collisions in WebAssembly. WebGPU is required; there is no WebGL fallback. Geometry, corrosion, lighting and particles are procedural. Runtime modules load from jsDelivr.

## Run

```sh
npm start
```

Open **http://localhost:8011**. Python 3 is required. No build or dependency installation is needed for the preview. For another port, use `python3 scripts/serve.py --port 8021`.

For static hosting, serve `index.html`, `style.css`, and the root JavaScript files over HTTPS or localhost. `scripts/`, `tests/`, and ignored `exports/` are not runtime assets.

## Controls

| Control       | Action                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------ |
| Drag the mine | Move the shell with mouse or touch; lift it to tension its chain                           |
| H             | Hide or show the interface                                                                 |
| Settings      | Adjust speed, breaking strength, corrosion, lighting, GTAO, fog softness and color grading |

Each mine rises, settles against its tether, and waits for dragging. The entrance and idle buoyancy cannot break the chain. Reduced motion opens on a settled mine; dragging starts its motion. Hidden tabs stop advancing; losing focus releases the drag. As the user tensions the chain, a localized light grows at the link that will break. Links retain their original shape until fracture.

## Physics and sequence

`mine-simulation.js` adds a buoyant spherical Box3D body to the contact-based chains in `tension-simulation.js`. The forged bottom eye shares its dimensions with a capsule collision surface on the shell body. The first link is threaded through it and bears on the eye through physical contact. Dragging applies a force-limited, strongly damped spring; the heavier shell responds with inertia. The mine tilts, transfers force into the tether, and returns toward its resting position when released. The hull collides with the chains. Its horns are visual details rather than separate collision shapes.

Each mine has a single 19-link tether, initially folded beneath it. Buoyancy lifts the shell and uncoils that slack against a fixed lower mount. The chain physically catches the mine; dragging is available as soon as the shell enters the view. All ordinary chain connections use capsule contact, without hidden joints. The lower endpoint stays centered beneath the mine while it pulls above. Box3D advances at 120 Hz with four solver substeps and continuous collision detection. Rendering interpolates poses. Underwater links have non-bouncing contacts and a damped lower anchor. Once the tether settles, stronger linear and angular water resistance suppresses chatter; breaking it restores freer recoil and sinking.

The mine must take up slack before the failure load can trigger a break. A random visible, loaded link is selected as tension builds; a warm point light follows it and grows with the load. Releasing the pull fades the light, while the selected link remains the same for the next pull. The light flashes at that exact link when it finally breaks. Failure alternates between a two-piece snap, a hinged tear, and a four-piece split. Jagged caps reveal fresh iron. Fragments retain their parent's rust pattern and motion.

Once the tether breaks, buoyancy lifts the mine with its remaining dangling links. A brief release pulse travels through both surviving sections, adding stronger recoil, a sideways bend and link rotation. These are physical impulses with distance falloff; contact keeps the unbroken links interlocked, and water drag settles the motion. The detached lower section falls under gravity.

`mine-journey.js` orbits the camera at 2.5 degrees per second, keeping its height, distance and target steady. The orbit continues while dragging; the grab plane follows the camera so the held point keeps following the pointer. Settings → Camera controls its speed; zero holds the current view. Reduced motion disables automatic orbiting. Dragging uses a plane facing the camera, so sideways motion follows the pointer from every angle. The lighting stays in world space, revealing different reflections as the view moves. After a break, the shell floats above the top of the frame and the detached chain falls. Once the entire shell has cleared the current view, the next mine starts below the bottom edge. Rust patterns, corrosion coverage, surface relief, tether orientation, failure site and fracture style vary between encounters. Per-mine geometry attributes vary the finish while sharing compiled materials; the corrosion and relief sliders adjust the overall look. Old shells and chains remain until every body has been outside the view for one second. There is no fixed count that removes visible objects.

`algae-roots.js` places 84 strands in shell tufts and 73 along the chain. `seaweed-simulation.js` gives each strand nine Verlet nodes, water drag, currents, distance constraints and collision against its host. Roots follow each body’s full rotation and position; when a link fractures, its algae transfers to the matching metal fragment and keeps its momentum. `marine-life.js` updates their geometry and emits 64 small bubbles from three corroded seams. Bubbles inherit some shell velocity, then rise independently with buoyancy and water drag; they grow slightly and fade at the end of their lifetime. Their rise speed is 35% faster than the original slow drift.

This is an art-directed rigid-body simulation. Capsule shapes approximate chain stock, the shell has a spherical collision shape, buoyancy and gravity are subdued, and fracture uses predefined cuts. Corrosion changes appearance; strength has a separate control. The earlier chain-only journey lives in `tests/fixtures/chain-journey.js` for its physics regression tests.

## Rendering

- `submarine-mine.js`: cast shell, welded meridians, a riveted equatorial band, 16 bolted horns, bottom collar, forged shackle and clustered barnacles. Rounded horn tips retain polished steel between small, rough oxide patches tied to each mine's corrosion. Rings and fasteners share the shell's pitted corrosion and retain rougher, subdued reflections. Static hardware is merged into four meshes; moss, algae and bubbles use separate batched geometry.
- `moss.js`: irregular olive-green cushions around seams, horn bases and lower plates, with several thousand fine tips. TSL shades the porous surface and sways the tips with water motion and shell velocity. Each mine gets its own growth pattern.
- `breaking-chain.js`: identical instanced racetrack links and capped fracture meshes, retaining all pieces from successive breaks.
- `corrosion.js`: TSL-baked oxidation, pitted substrate, dense mineral grains and fine color variation. Rough oxide dominates the surface, with sparse smoother patches of exposed iron. Surface-gradient normals combine coarse pits, individual grains and microscopic grit; mineral flecks catch small highlights. Each link retains its own rust pattern across a fracture.
- `atmosphere.js`: TSL depth and height fog sharing the exact background radiance. A procedural PMREM chamber supplies most illumination at environment intensity 0.5: a broad warm opening, a narrow cool rim, overhead water light, subdued fill and a large lower bounce for the chain. Soft emitter edges and dark walls shape the reflections. A directional key retains shadows. One warm point light follows the selected link, smoothly builds with user-applied tension, fades on release and flashes at fracture. Its small camera-facing offset keeps the illuminated iron readable throughout the orbit. Settings → Light & water → Fracture light controls its intensity.
- `debris.js`: 1,000 tumbling metal and oxide chips per break, including 50 larger flakes.
- `dust.js`: 16,000 fine cyan dust motes with position and velocity stored on the GPU. A TSL compute pass adds ambient currents, wakes from up to 32 nearby moving links and mine shells, and expanding fracture impulses. Three overlapping banks of 480 fracture glints preserve successive bursts. Fracture density, water impulses and peak flash intensity are five times the subdued version, with faster fragment scattering and longer glint decay. Particles use scene depth for occlusion and stay small through the fog. Water motes are invisible within two scene units of the camera and fade in smoothly between two and four units of view depth.
- `main.js`: scene setup, frame loop and resource lifetime. `settings.js` owns defaults and the settings panel; `mine-drag.js` owns picking, pointer capture and the camera-facing drag plane.
- `post-processing.js`: 32-sample GTAO at three-quarter resolution, depth-aware denoising, water fog composited after occlusion, fog scattering blur, ACES, vignette and SMAA. `water-blur.js` covers every texel with a dense Gaussian kernel and pairs adjacent taps with bilinear filtering; increasing softness expands the kernel instead of spreading samples apart. Depth guidance rejects distant highlights over nearer geometry while allowing silhouettes to feather into empty water. Bubbles share this scattering pass without dark halos; fine dust stays sharp. Color grading exposes exposure, temperature, tint, contrast, saturation, black level and shadow tint. Automatic resolution caps rendering at approximately 1.25 million pixels and 1.5× device scale.

Box3D supplies contact-rich rigid-body motion; TSL supplies the materials, particle motion and rendering. There are no GLSL shaders or pre-rendered images.

## Validation

```sh
npm install
npm test
```

Physics tests cover dragging and release, buoyant ascent, the physical eye attachment, idle chain stability, finite algae motion, strand constraints and algae on all three fracture styles, orbiting entrances and replacements in desktop and portrait views, continuous orbit during dragging, the illuminated link matching the actual break even after release and renewed pulling, and retirement from side and rear views, plus the existing chain fracture regressions.

In a separate preview tab, run:

```js
await (await import("./tests/rendering.browser.js")).checkRendering();
```

This reads actual GPU pixels to check mine corrosion, per-mine relief and corrosion profiles, independence from spherical UVs, GTAO, color grading, fog convergence to the background, and bubble scattering without dark halos. A bright-texel probe checks that the fog filter produces no repeated highlights across the softness range and rejects light from behind nearer geometry. GPU velocity buffers verify dust wakes and fracture impulses. It also checks algae lag, independent bubble motion, pause, upward dragging, visible fracture meshes, buoyant ascent and the next mine and its single tether. It resets the sequence and restores settings afterward.

`window.rust` exposes scene components, settings, `pause()`, `setPull(value)`, `setAuto(value)`, `reset()`, `advance(dt)`, `render()`, `inspect()`, and `dispose()`. Set `manual = true` for deterministic stepping; `reset(seed)` also gives a repeatable layout and failure sequence. Wait for a new animation frame between manual renders because Three.js caches render passes within a frame.

## Video capture

The looping video uses the other days' silent **1024 × 1024 H.264 MP4 at 30 fps**, rendered at 1536 × 1536 and downsampled. The title and collapsed Settings label use √2 UI scale. A single circle shows the drag position: hollow on approach, lightly filled while held, then expanding and fading on release. The current material, lighting and water settings are preserved.

`scripts/capture-sequence.js` gives each of two mines a broad, slow sideways/downward drag, then pulls upward until its tether physically breaks. The camera keeps orbiting, the first mine leaves and its replacement rises naturally. After the second break, the third entrance waits below the frame until the last loose metal has fallen away. The source lasts 46 seconds; a 24-frame circular crossfade of empty water gives a **45.2-second loop**. The opening mine's entrance then follows continuously. The interactive experiment's timing is unchanged.

Start the preview on port 8011 and the receiver in a second terminal:

```sh
python3 scripts/capture-server.py exports/rust-source.mp4 --previews
```

In a separate browser tab with a **1024 × 1024 viewport and device scale 1**, run:

```js
await (await import("./scripts/capture-video.js")).captureVideo();
```

This resets the physics sequence. Capture advances at fixed 30 Hz and waits for each lossless PNG receipt, so slow rendering cannot drop video frames. The receiver checks the encoded frame count, dimensions and duration. `window.captureProgress` reports progress and provides `cancel()`. Settings, renderer size and interface are restored afterward. A short receiver check can use `captureVideo({ duration: 1 })` with a fresh output filename.

Join the full source into its loop:

```sh
python3 scripts/loop-video.py exports/rust-source.mp4 exports/rust-loop.mp4
```

FFmpeg and FFprobe must be on PATH. Existing outputs are never overwritten. Source and final metadata, along with optional PNG previews, are saved in ignored `exports/`. The capture regression test verifies both slow drags, different failure sites and that every mine and chain body has left the view before the loop overlap.
