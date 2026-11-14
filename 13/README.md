# Codevember 2026 / 13 / Labyrinth

An endless flight through a snowbound hedge maze at night, inspired by *The Shining*. Snow-covered yew, recessed footprints, blue floodlights, blowing powder, fog, and an evolving orchestral score are generated in code.

Built with plain JavaScript, Three.js `WebGPURenderer`, TSL, `MeshletDrawingPipeline`, and `ClusteredLighting`. WebGPU is required. Dependencies load through an import map pinned to the same Three.js revision as Day 12. There is no install or build step.

## Run

```sh
npm start
```

Open **http://localhost:8013/**. The Python 3 preview server disables caching of local source files. To browse the gallery with the other days, serve the parent directory and open `/13/`.

## Controls

- **Automatic flight** starts in a lit corridor, makes three turns, and enters the central clearing after about 20 seconds. Press a key or touch the screen to take over at the current pose.
- **W/S** or **↑/↓** move forward and backward. **A/D** strafe. **←/→** turn.
- **Mouse drag** looks around during automatic flight or manual navigation. Dragging during flight changes the view while the camera keeps moving; the view offset stays after release.
- **Touch** uses one joystick: drag up/down to move and left/right to turn. It appears at the first touch position, remains anchored there, and hides on release or cancellation. Additional fingers do not steer or look around.
- **Space** pauses or resumes. **R** restarts the flight facing forward. **H** hides the header, settings, and map. **M** toggles the maze plan.
- **Audio off / Audio on**, at the bottom left, starts or mutes the score without taking over the camera. Scene interactions also enable sound; a deliberate mute stays muted. This is the only footer control.
- **Settings** controls flight and walking speeds, eye height, sound, fog, lighting, snow, exposure, bloom, resolution, and meshlet visualization.

Hidden tabs stop advancing. Reduced-motion preferences start the scene paused until the user moves or resumes it. Losing focus or canceling a touch clears held input.

## Scene and motion

- `maze-plan.js` transcribes the supplied 39 × 55 reference map. Each wall or ordinary passage occupies one 2.56 m cell; the central clearing spans five cells. `maze.js` subdivides the map for terrain and foliage, merges walls into 137 hedge rectangles, and provides snow height and collision queries. Hedges are 4.65 m tall.
- `maze.js` also traces a continuous circuit, removes dead-end excursions, and routes the opening through the clearing's central axis and southern gate. `camera-route.js` joins straight passages with quintic Bézier corners whose curvature reaches zero at both ends. Bends use up to five metres of adjoining passages, constrained by neighboring corners and 0.8 m of hedge clearance.
- `flight.js` regulates travel speed along the physical route. Cruise speed is 2.4 m/s and acceleration is limited to 0.65 m/s². The 1.27 km loop takes about 11 minutes 10 seconds at the default setting. Without mouse input, the view follows the exact direction of travel, with a slight downward pitch and damped ground height. The route closes continuously without reversals or independent camera scanning.
- `journey.js` handles automatic and manual camera motion. `navigation-controls.js` handles pointer and keyboard input; `movement.js` supplies frame-rate-independent acceleration, joystick response, and collision sliding. `minimap.js` caches the static wall plan and draws the camera marker over it.
- `hedge-geometry.js` builds twelve botanical variants with branching sprays, solid leaves, and separate snow cushions. `hedges.js` places 77,088 patches over the hedge sides and tops. `hedge-pipeline.js` uses GPU culling and automatic detail selection to render roughly 1.06 billion instanced source triangles. Per-variant work queues stay within WebGPU storage limits; ground tiles retain boundary vertices to prevent cracks.
- `snow.js` creates drifted terrain and 1,954 boot impressions, using displaced geometry and a generated height atlas. `lighting.js` places 53 blue floodlights, including dedicated lights in the three opening corridors. Surface lighting uses clustered lighting; a baked, hedge-occluded irradiance field supplies the fog's light distribution.
- `atmosphere.js` integrates 32 samples through the visible air at half resolution, with depth-aware reconstruction at hedge silhouettes. `post-processing.js` adds ambient occlusion, bloom, a blue grade, and vignette. There is no film-grain pass. The geometry pass uses 4× MSAA.

**Auto** resolution caps device pixel ratio at 1.25. Native DPR and explicit 1×, 1.5×, and 2× options are available. Meshlet detail scales with resolution; performance depends on hardware and viewpoint.

## Sound

The original score takes its atmosphere from the supplied [*De Natura Sonoris No. 1* reference](https://www.youtube.com/watch?v=pOHK7kc6QXA). `score.js` composes overlapping string clouds, brass-like swells, bass tones, filtered air, metallic resonances, knocks, and scraped textures. `orchestra.js` synthesizes these with Web Audio oscillators, noise, filters, modulation, and generated reverberation. No recordings or sample libraries are used.

`music.js` creates its AudioContext after an interaction and schedules against the audio clock independently of rendering. Mute, zero volume, pause, and hidden tabs fade and suspend processing. Voices disconnect after release, and disposing the experiment closes the context. Restarting the camera leaves the score running.

## Validation

```sh
npm test
```

CPU checks cover map connectivity and coverage, route continuity, three turns before the clearing, corner geometry and clearance, exact heading alignment, deterministic flight timing, collision sliding, joystick response, and bounded audio scheduling.

With the experiment loaded, run:

```js
await (await import('./tests/rendering.browser.js')).checkLabyrinth();
await (await import('./tests/rendering.browser.js')).checkPerformance();
await (await import('./tests/navigation.browser.js')).checkNavigation();
await (await import('./tests/flight.browser.js')).checkFlight();
await (await import('./tests/music.browser.js')).checkMusic();
```

The browser checks cover native WebGPU, meshlet and clustered-lighting activation, complete route clearance, GPU queue capacity across 36 views, keyboard controls, pose-preserving takeover, the audio-only footer, opening lights, camera alignment, and seamless wrapping. The music check silently renders the synthesis graph to inspect signal levels, stereo output, release tails, and resource cleanup.

`window.labyrinth` exposes the scene, renderer, camera, journey, geometry, lighting, settings, and music for inspection. `journey.mode` reports `automatic` or `manual`; `journey.takeControl()` enters manual navigation. For deterministic captures, set the top-level `manual = true`, call `reset()`, `advance(seconds)`, or `journey.seek(distanceInMeters)`, then call `render()` on an animation frame. Render a second frame after large viewpoint changes to settle meshlet visibility. Restore `manual = false` to resume animation. Audio continues to follow its own clock.

Local captures and diagnostic exports under `exports/` are excluded from version control.
