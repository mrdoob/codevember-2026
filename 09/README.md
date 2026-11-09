# Codevember 2026 / 09 / Membrane

A tensioned circular membrane, white sand, and flowing iridescent soap reveal the shapes of sound. A mechanical exciter drives the membrane; grains bounce, slide, roll, collide and gradually collect along quiet regions. A contact pickup turns the simulated surface velocity into sound. The dark charcoal plastic surface with softly rounded grain, brushed steel housing, worn coated floor and studio lighting remain procedural.

Plain JavaScript, WGSL and three.js **0.187.0**, with no application build step or npm dependencies. **WebGPU is required.** Three.js modules load from jsDelivr. The browser runs the physics on the GPU; the JavaScript/WebAssembly implementation remains available for reference tests and offline checkpoint generation.

## Run

```sh
cd 09
npm start
```

Open **http://localhost:8009**. The Python development server disables caching. To use another port: `python3 scripts/serve.py --port 8019`.

For static hosting, include `index.html`, `style.css`, the root JavaScript files, `wave-field.wgsl`, `film-fluid.wgsl`, and **the entire `physics/` directory**, including `solver.wgsl` and `initial-state-fine.bin`. Serve over HTTPS; `file://` is unsupported. Tests, scripts and exports are not runtime dependencies.

## Controls

The header description stays fixed. The footer shows frequency with previous/next resonance arrows around its slider on the left, and Wave, Particles, Sound, Reset on the right.

- **Drag** to orbit; scroll or pinch to zoom. The minimum camera distance is 2 scene units, allowing close inspection of individual grains. The camera starts at (0, 7, −13), facing the device. Automatic orbit defaults to 0.4 and runs counterclockwise viewed from above, continuing during dragging and zooming. Orbit pauses with playback; the camera toggle can disable it.
- **Particles / Wave** independently toggle the white sand and the iridescent wave overlay. The wave starts visible and particles start hidden; either can be shown alone, both together, or both hidden. Particles ease in and out with a slightly staggered change in their rendered size, and their shadows follow the same transition. It can reverse smoothly, works while paused, and switches immediately for reduced motion. Hiding particles only changes their rendering, so the simulation continues. The wave rises from and settles onto the physical membrane with a smooth, reversible transition that also works while paused; reduced motion switches immediately. Reset remains available, and the controls stay in place when toggled. Settings → Wave appearance adjusts height magnification, film lighting, film stirring and glow. Height starts at 100× and can be lowered to 5×; film lighting starts at 2. Film stirring controls the strength of resonance-driven flow; zero removes the forcing while existing motion gradually decays. The footer toggles stay synchronized with Settings → Wave and Settings → Surface → Particles.
- **Frequency slider** beside the bottom-left readout tunes the drive from 40 to 300 Hz in 0.1 Hz steps. It has 11 marks at the preset resonances, with the current resonance highlighted. The range also exposes these stops through a datalist. It stays synchronized with Settings and the resonance presets. Manual tuning disables automatic cycling; keyboard arrows adjust the focused slider.
- **Arrows beside the frequency slider / Left and Right keys** glide the exciter to another unloaded natural frequency with a critically damped transition (most movement within a second, settling in about 1.5–2 seconds). Repeated clicks retarget the glide without a frequency jump. All modes remain active; the drive phase, membrane motion, sand and film momentum are preserved. The slider and readout follow the actual frequency; touching the slider cancels the glide. Preset selection and automatic cycling use the same transition. While paused, the control can finish tuning without advancing physical state. Reduced motion selects the frequency immediately. The arrows step through resonances in frequency order and wrap at either end; from free tuning they find the next lower or higher resonance. Automatic tuning changes every 120 physical seconds. There are 11 stops in frequency order: Cross (117.5 Hz), One ring (126.2), Six petals (145.9), Line + ring (160.4), Eight petals (173.5), Cross + ring (192.5), Two rings (197.9), Six spokes (223.2), Twelve petals (227.2), Eight spokes (253.1), and Cross + two rings (265.7). These are presets for modes already present in the solver; adding stops does not add physics modes or per-step work.
- **Reset / R** replaces the sand with a loose, non-overlapping layer, clears its velocity and spin, and reinitializes the soap film’s thickness and flow. It works with either layer hidden and while paused. The current resonance, vibration, simulation clock, camera, layer visibility and visual settings stay intact. Settings → Reset particles & fluid invokes the same action.
- **Sound / S** enables the contact pickup. It starts muted and requires a user gesture. The Sound label stays fixed: yellow means enabled and gray means disabled, also exposed through `aria-pressed`. Pause and tab hiding silence it and clear queued audio.
- **Space** pauses/resumes. Changing frequency while paused leaves the physical state frozen until playback resumes.
- **Color grading** in Settings adjusts exposure, contrast, saturation, warmth, tint, shadows, highlights and vignette. Defaults are exposure 0.5, contrast 1.25 and saturation 1.5. Changes apply immediately in both views, including while paused. Reset grading restores only these image controls. `color-grading.js` applies color balance in linear light before tone mapping, then adjusts tonal ranges and saturation in display space; the uniforms share the existing final render pass and require no extra render targets or shader recompilation when adjusted.
- **Settings** exposes continuous drive frequency (40–300 Hz), force (newtons), playback rate, Coulomb friction, restitution, white sand visibility, 14,000 / 28,000 / 56,000 grains, materials, camera, resolution and volume. Changing frequency manually disables automatic tuning; the preset reads **Free tuning** between the named resonances.

The experiment loads a checkpoint after **46 physical seconds of the CPU reference model with 14,000 fine grains**, so a figure is already visible. It contains positions, velocities, spins and modal state; there is no nodal placement or animation cache. The checkpoint was baked at 192.5 Hz; startup retunes to 223.2 Hz (Six spokes), and the grains evolve toward the new resonance. Subsequent motion is solved live on the GPU. GPU and CPU contact iteration differ, so their trajectories are not bit-for-bit identical. Reset shows the formation process from loose sand. Regenerate the checkpoint with `node scripts/bake-initial-state.mjs` after changing physical defaults. If the checkpoint cannot load, the app starts from loose sand.

Changing the grain count scatters a new, non-overlapping population while preserving membrane displacement, velocity, drive phase and simulation time. Grain radii are scaled to keep total sand mass at 2.371 g. Higher counts use more GPU time.

Reduced motion starts paused with camera orbit disabled. Playback offers **2×, 1×, ¼× and ¹⁄₁₀×**, advancing all physics together with the same 4,800 Hz fixed step; geometry is never magnified. Audio playback changes by the same factor, including pitch. The selected rate is a target; high grain counts can prevent the GPU from keeping up. The frequency readout always reports the exciter's physical frequency.

## Wave visualization

`wave-view.js` and `wave-field.wgsl` keep the displayed shape steady at a fixed drive frequency and force. The shape is the analytical steady sinusoidal response of the same 34 unloaded, damped membrane modes. Its quadrature magnitude sets the raised envelope. Changes in frequency, force or damping blend over a 0.16-second smoothing time, then settle exactly; the shape pass stops running once settled. The selected resonance still glides smoothly, and height magnification and view transitions remain available.

A separate live field reads all 34 simulated modal displacements and velocities, subtracts static gravity equilibrium, and expresses the motion relative to the exciter phase. It is smoothed over 0.08 physical seconds and continues to stir the soap fluid. Instantaneous vibration and grain impacts therefore affect the fluid without making the displayed sheet wobble. The visualization passes never write to the physical solver. The visible shape is a steady unloaded response, not the instantaneous displacement or the loaded membrane's transient envelope. A single translucent soap-film surface uses spectral reflection and transmission; the physical membrane remains visible beneath it.

Only the displayed height is magnified. The soap-film material, fluid layer and bloom are visual aids; they do not represent emitted light or the physical membrane's material. The underlying membrane and all grains continue simulating at their original scale, and the contact pickup still uses the physical velocity. Switching views never resets or scatters the grains. The wave field stays on the GPU and vertex displacement reads it directly, with no per-frame readback. Its compute pass runs once per rendered update, outside the fixed-step solver. Bloom reads a separate attachment containing only reflected light from the film, so it does not make the housing glow; sand view keeps its original render path without that attachment or the bloom passes.

### Flowing film

`film-fluid.js` and `film-fluid.wgsl` run a separate **256 × 256 GPU fluid simulation** at a fixed 60 Hz of experiment time. A staggered MAC grid stores face velocities inside the circular rim. Each step advects momentum with midpoint backtracing, applies viscosity and drag, solves pressure with 40 Jacobi iterations initialized from the preceding solution, and projects velocity toward a divergence-free field. Closed rim faces have zero normal flow. Mild vorticity confinement offsets numerical smoothing of small eddies. The method follows the advection/pressure-projection approach described in [GPU Gems, Chapter 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu).

The spatial gradient of the membrane envelope's squared amplitude supplies a **stylized cycle-averaged force**, with thickness-dependent mobility generating circulation. A shared GPU display field also stores the exact magnified elevation used by the soap geometry and its smoothed vertical velocity. Elevation changes during wave transitions, resonance glides and height adjustment add bounded forcing along the surface slopes. The soap stays still at a fixed resonance while its color layer flows. Static height adds no motion force, and adjustments while paused do not inject a velocity spike or advance the fluid. This elevation coupling is an artistic approximation within the planar solver, not a full fluid simulation on a deforming 3D surface. Existing momentum survives frequency changes. Limited MacCormack advection transports a varied initial optical thickness (approximately 180–885 nm), retaining fine color structures without introducing new extrema. Before the first frame, the film advances eight seconds (480 normal fixed steps) under the starting frequency’s analytical steady response. This prepares visible flow at 223.2 Hz without advancing the membrane, grains, contact audio or experiment clock, and without inheriting the older sand checkpoint’s resonance. It then returns to live membrane forcing. Reset restores the fresh, unperturbed film rather than repeating this startup preparation. The fragment shader samples this field directly for thin-film interference with a film refractive index of 1.33. There is no animated noise or periodic color scroll. All working fields stay on the GPU, with roughly 3.1 MB of fluid buffers and no per-frame CPU readback.

This is a 2D incompressible-flow approximation in the membrane's flat coordinates, with optical thickness transported as a scalar. It is **not a calibrated soap-film model**: forcing strength is artistic, pressure convergence is finite, scalar transport is not exactly mass-conserving, and the model omits drainage, evaporation, surfactants, Marangoni stresses and the geometry of the magnified curved surface. Coupling is one-way; fluid never changes the physical membrane or grains. Pausing freezes flow, playback speed scales its clock, and sand view suspends fluid work while retaining its state. Reset reinitializes the film even when the wave is hidden. Long stalls discard excess elapsed time after six fluid steps per update.

### Soap optics

`soap-optics.js` evaluates an ideal **air → soap → air** sheet, with air IOR 1 and a constant film IOR of 1.33. It uses Snell refraction, exact s/p Fresnel coefficients and the Airy sum of coherent internal reflections, averaged for unpolarized illumination. The optical phase is determined by the advected thickness in nanometres and the viewing angle. The front/back interface phase reversal produces quarter-wave reflection maxima and half-wave minima, as in [UCSB's soap-film demonstration](https://web.physics.ucsb.edu/~lecturedemonstrations/Composer/Pages/84.24.html).

Reflectance is integrated over 95 wavelengths (360–830 nm at 5 nm spacing) using the [CIE 1931 2-degree observer](https://doi.org/10.25039/CIE.DS.xvudnb9b) and [D65 illumination](https://doi.org/10.25039/CIE.DS.hjfjmt59). A 512 × 256 half-float lookup stores linear RGB reflectance versus thickness and angle, taking about 1 MB on the GPU. The renderer combines reflected environment light with `background × (1 − reflectance)` in linear space. The film has no diffuse pigment, metal coating, arbitrary opacity or emitted edge light. Bloom represents bright reflections. Film lighting scales the incident PMREM illumination. Studio softboxes and windows concentrate reflections, with dark, transparent regions shaped by the surrounding room and flags; there is no added uniform white fill.

The two locally parallel interfaces transmit in the original direction; their sub-micrometre lateral offset is neglected. A framebuffer copy supplies the transmitted background. This is an accurate ideal-film optical model within real-time approximations: constant IOR (no measured solution or wavelength dispersion), RGB environment lighting under a D65 spectral assumption, finite lookup precision and gamut clipping, filtered environment reflections, and only the nearest visible film layer. It does not trace repeated intersections, reflections between distant folds, or full spectral light transport. The fluid model remains the separate approximation described above.

`soap-spectrum.js` contains derived spectral weights from the two CIE datasets. Those data/weights are **CC BY-SA 4.0**, attributed to the International Commission on Illumination; their DOIs and license are recorded in the file. `python3 scripts/build-soap-spectrum.py` regenerates the weights from checksum-verified CIE CSVs. It samples the datasets, weights them by D65, converts XYZ to linear sRGB, and normalizes the white response. No dataset download occurs at runtime.

## Physical model

This is a numerical model of an **ideal, uniformly tensioned circular membrane and spherical grains**, not a calibrated digital twin of a commercial loudspeaker or the square metal plate in [the reference video](https://www.youtube.com/watch?v=wvJAgrUBF4w). The plate uses bending stiffness and different boundary conditions. [Stanford's discussion of this exact video](https://mathematics.stanford.edu/events/student-analysis/chladni-figures-sand-vibrating-metal-plate) explains that distinction.

All physics uses metres, kilograms and seconds. The renderer applies a uniform scale of 20 scene units/metre, including particle sizes and displacement. Parameters:

| Quantity | Value |
| --- | --- |
| Membrane diameter | 0.30 m |
| Surface mass density | 1 kg/m² |
| Uniform tension | 464.60044 N/m |
| Modal damping ratio | 0.008 |
| Exciter footprint | Gaussian, 9 mm standard deviation, centred at (47, 31) mm |
| Default drive | 0.12 N peak at 223.2 Hz (Six spokes) |
| Grains | 14,000 spheres, radius 0.185–0.301 mm, density 2,650 kg/m³; total mass 2.371 g |
| Gravity | 9.81 m/s² |
| Sliding / rolling friction | 0.32 / 0.025 |
| Restitution | 0.35, suppressed for resting contacts |
| Integration | Fixed 4,800 Hz; grain-pair contacts every second step |

### Membrane

`modes.js` retains all 34 circular-membrane eigenmodes up to the 12.3386 Bessel root (about 282 Hz), including both angular orientations of every non-axisymmetric mode. The fixed rim is built into `J_m(root × r/R) × cos(mθ)` and its sine counterpart. Modal masses are the integrals of surface density times squared mode shape; natural frequencies follow `ω = root/R × sqrt(tension / surface density)`. See [Penn State's circular membrane modes](https://www.acs.psu.edu/drussell/Demos/MembraneCircle/Circle.html).

`modal-system.js` evolves each coordinate independently:

```
M q̈ + 2 ζ ω M q̇ + M ω² q = F(t) × exciter_overlap + gravity_force
```

The integrator uses exact damped homogeneous propagation with midpoint forcing. A finite Gaussian force footprint excites the modes according to spatial overlap. Gravity produces the membrane's small static sag. Changing frequency produces a transient followed by a resonant response; stopping the drive allows energy to decay. Local taps change generalized momentum. Particle impacts apply equal and opposite impulses to the modal velocities, so the sand also loads the membrane.

### Grains

`simulation.js` provides the readable JavaScript reference solver, and `physics/contacts.c` accelerates CPU contact evaluation in WebAssembly. The live experiment uses `physics/gpu-kernel.js` and `physics/solver.wgsl` for modal integration, membrane evaluation, grain contacts and collisions. Every selected particle participates in the simulation. Positions, velocities and spins occupy separate contiguous planes in GPU memory, so collision searches read positions without fetching unused angular state. Each grain has three-dimensional position, velocity, radius, mass, angular velocity and solid-sphere inertia. Flight follows gravity. Contacts use the moving membrane's height, velocity and normal, impulse-based restitution, Coulomb sliding friction and rolling resistance. GPU pair contacts use a spatial hash with cells sized to the largest grain diameter and conserve linear momentum; their tangential impulses also change spin. A vertical retaining rim keeps grains on the instrument. There is **no attraction to nodes, random agitation, packing-pressure force or prescribed hopping**.

Modal fields are bilinearly interpolated from a **145 × 145 grid**. The GPU evaluates one quadrant, groups modal contributions by reflection parity, and reconstructs all four quadrants using exact symmetry; this reduces memory traffic without reducing spatial resolution or the 34-mode basis. Surface impulses are deposited onto grid vertices and projected back into the modes. A compact list of touched vertices avoids visiting every vertex for every mode. A precomputed inverse-mass Gram matrix supplies the membrane's contact effective mass.

GPU state uses float32; atomic reaction accumulation uses fixed-point increments of 10⁻¹² N·s. Reactions are consumed before the next modal advance. Each pair-contact event runs two simultaneous (Jacobi) iterations, with symmetric contact-count weighting to stabilize dense neighborhoods. Isolated impacts satisfy the specified restitution; densely coupled contacts are only iteratively approximated and can be more dissipative. Lists above 64 contacts fall back to a complete cell traversal rather than discarding neighbors. CPU modal state and impulses use double precision, and CPU pairs use sequential impulses. Contact penetration is corrected at the discrete step. These are finite-resolution numerical approximations. See [Baraff's rigid-body simulation course](https://www.cs.cmu.edu/~baraff/sigcourse/slidesd.pdf) for impulse/contact mechanics.

### Sound

`audio.js` streams PCM sampled directly from membrane velocity at a virtual contact pickup at (61, −37) mm. Small asynchronous GPU readbacks deliver the samples; particle state stays on the device. The pickup is sampled after modal integration, before that substep’s grain impulses. It has no independent tone oscillator or decorative harmonics. Playback adds gain, a high-pass filter, a compressor and a short queue for scheduling jitter. This is an ideal contact-microphone signal, **not a solution for airborne sound pressure** or a phase-locked acoustic measurement.

### Limits

The model assumes small transverse displacement, constant isotropic tension, a fixed rim and a finite modal cutoff. It omits nonlinear elasticity, bending stiffness, voice-coil/electrical mechanics, air loading/radiation and aerodynamic grain drag. Grains have spherical contact geometry and constant material coefficients. Contacts use discrete impulses rather than resolving grain deformation. Modes above the cutoff and behavior near/above it are not quantitatively reliable. Parameters have not been fitted to a measured instrument. Analytical checks verify the implemented ideal model, not experimental fidelity to the reference video.

## Rendering

`speaker.js` renders each matte white grain as a **two-triangle sphere sprite**, with analytic hemisphere normals, circular clipping and spherical fragment depth. The shadow pass explicitly renders the light-facing fronts of the billboards (the usual back-face shadow setting culls flat sprites). It uses the same silhouette and spherical depth from the light camera, so all grains cast and receive shadows. Spin remains part of the contact physics; an untextured sphere needs no visible orientation. The membrane mesh and sprites read GPU storage buffers directly, avoiding per-frame particle transfers. `pcss-shadow.js` preserves grain contact shadows while softening separated shadows.

`studio-environment.js` builds an enclosed photographic studio for the PMREM: a curved floor-to-wall cyclorama, side walls, ceiling beams, three octagonal softboxes (key, fill and a smaller overhead source), two rim strips, a frosted window with mullions, dark flags and white bounce cards. Neutral diffusion panels have soft intensity falloff; three bake-only point lights and a restrained hemisphere fill illuminate the room geometry. The walls and ceiling provide broad reflected gradients, while flags and housings preserve contrast. This is an approximate studio lighting rig, not a path-traced multi-bounce solution. The entire reflection scene is rotated 90° clockwise around Y, viewed from above. `studio.js` bakes this scene once at startup, then disposes its geometry and materials. There is no additional room rendering in the animation loop. One directional light remains for the grain and housing shadows; the scene needs no RectAreaLights or LTC lookup-table download.

`speaker.js` groups 87 repeated hardware parts into eight instance batches (fasteners, ribs, coil turns and feet), reducing the speaker from 98 meshes to 19 while preserving the original transforms and shadow settings. In a fixed-camera browser check with 28,000 grains, total draw calls fell from 144 to 36 and warmed render/queue-completion time fell from about 21.5 ms to 7.4 ms, excluding physics. The removed LTC module was 314,764 bytes of JavaScript before compression. These timings depend on the device and view; shader compilation time was not measured separately. The speaker stands directly on the floor, with the cable resting beside it.

`floor-surface.js` reuses Day 08’s procedural texture and layered roughness treatment: subtle color mottling and broad worn patches mixed with finer scuffs. `floor-scratches.js` adds a seeded, seamless 1024² mask of random curved scratches and small parallel scuff groups. The marks slightly lighten the plastic, increase roughness and indent the bump normal. They are generated once, use mipmaps and anisotropic filtering, and add no draw calls or external texture download. Base roughness varies from 0.45 to 0.85 (up to 0.94 on scratches), with the pattern scaled for the smaller subject. The dark charcoal plastic coating (`#2e393c`) has zero metalness and clearcoat, with muted dielectric highlights (specular intensity 0.15 and floor environment intensity 0.85). Slight color mottling keeps the wear visible with this matte finish. Exponential fog density is 0.018, keeping the speaker clear while softening the distant floor. Analytic ambient darkening beneath the basket and magnet, plus six soft contact arcs beneath the support feet, grounds the speaker without another render pass.

`surface-textures.js` generates steel brushing, graphite grain and a seamlessly blurred polymer height map. The membrane uses dark charcoal (`#101617`) and a matte dielectric material (0 metalness, 0 clearcoat, 0.88 roughness), with soft grain bump and no iridescence.

Default resolution is capped at 1.5×; selecting 1× helps on slower GPUs. Physics steps are never enlarged for performance. At most two physics batches are queued, and long frame stalls are capped rather than replayed. In the 14,000-grain checkpoint benchmark, this optimization pass reduced solver time from about 13.4 ms to 11.6 ms per 20 ms of simulated motion (roughly 15% more throughput). The original CPU solver took roughly 200 ms for that interval. A scattered 28,000-grain population took about 19 ms; rendering, shadows, dense clusters and higher playback rates add further cost. Timing depends on the device, viewport and current contacts.

## Validation and rebuilding

```sh
npm test
```

Tests check fixed boundaries, dimensional frequencies, conservative free vibration, analytical damping, the forced oscillator transfer function and time-step convergence, ballistic motion, membrane reaction impulses, grain momentum/restitution, frictional dissipation, frame-rate independence, JavaScript/WebAssembly agreement, drive-off decay, reset, snapshot round-trip and invalid input. Long runs check emergent migration and finite state through resonance changes. Browser checks cover rendering, sound, controls, mobile layout and reduced motion.

GPU checks run separately in the browser, with animation suspended:

```js
membrane.manual = true;
await membrane.simulation.gpu.idle();
await (await import('./tests/gpu-checks.js')).runGPUChecks(membrane.renderer);
membrane.manual = false;
```

A rendering regression check compares the actual shadow depth map and rendered pixels with grain casting disabled/enabled:

```js
await (await import('./tests/sprite-shadow-check.js')).checkSpriteShadows(membrane);
```

It verifies that the previous default side produces no grain shadow texels, while front-face casting produces blockers in the shadow map and darkens the rendered scene. It restores the previous animation and shadow settings afterward.

The eleven GPU checks cover basis symmetry, reconstructed fields, 2× stepping, ballistics, reaction impulses, isolated-pair momentum/restitution, frictional dissipation, contact-list overflow, modal/PCM agreement with the double precision reference, controls/reset, and emergent migration from scattered grains. The migration check runs for 60 physical seconds and samples the last 20 seconds once per second. Its average squared driven-mode amplitude at grain positions must fall below 75% of the initial value, requiring sustained nodal accumulation instead of relying on one noisy instantaneous sample. CPU tests and GPU tests have separate floating-point tolerances; neither requires chaotic dense-particle trajectories to match exactly.

The wave visualization has an isolated browser check:

```js
await (await import('./tests/wave-view-check.js')).checkWaveView(membrane);
```

It checks live analytical quadratures and fixed boundaries, carrier-phase invariance, unmodified modal inputs, height adjustment while paused, static-sag removal, the analytical steady shape, shape stability under changing live motion, matching display/fluid elevation, signed motion during rising and falling transitions, isolation while paused, and smooth settling after a drive change. Synthetic modal inputs are separate from the running simulation.

The film solver also has an isolated GPU check:

```js
await (await import('./tests/film-fluid-check.js')).checkFilmFluid(membrane);
```

It checks a stationary unforced film, pressure projection, zero flow through the rim, resonance-driven transport, finite bounded thickness, mean thickness drift, pause behavior, identical results at 30/60 render updates per second, unmodified membrane input, static-height isolation and elevation-driven transport with zero resonance energy. The motion-only case remains finite and within the initial thickness range at maximum stirring. A ten-second synthetic forcing case changed mean thickness by about 0.15%; the projection test reduced RMS divergence by about 99%. A separate 120-second run at maximum stirring stayed finite and within the initial thickness bounds. A 120-second run at 256 × 256 averaged about 1.3 ms per fluid step on the development GPU, including command submission and queue completion while the other preview was open. This is not an isolated GPU timing; device and concurrent workloads affect it.

The startup film preparation has a separate browser check:

```js
await (await import('./tests/film-prewarm-check.js')).checkFilmPrewarm(membrane);
```

It verifies initial thickness transport and flow, finite bounded thickness, the normal fixed step, different patterns for different starting resonances, unchanged physical modes and clock, and a fresh film after Reset.

The optical CPU tests cover the zero-thickness limit, interference extrema, angle-dependent refraction, independent reflection/transmission energy conservation and lookup accuracy. The production GPU material also has a rendering check:

```js
await (await import('./tests/soap-render-check.js')).checkSoapRendering(membrane);
```

It verifies an equal-illumination white-furnace test, rendered reflection against the spectral calculation, zero-thickness transparency, complementary transmission and zero emitted light. Browser interaction checks cover continuous repeated resonance changes, exact preset settling, readout synchronization, slider interruption, automatic cycling and frozen physics while paused.

The compiled CPU contact module is committed. To rebuild it with Emscripten (built with 4.0.8):

```sh
sh physics/build.sh
node scripts/bake-initial-state.mjs
```

The preset comparison is reproducible with `node scripts/check-resonances.mjs 60 600`. It runs equal-duration CPU trials with identical fine-grain populations. The original comparison found little sand migration at 0,2 and 5,1 (mean squared mode amplitude ratios 1.07 and 0.97), while 2,3 was weaker at 0.80. The first five presets ranged from 0.35 to 0.67 and showed clearer accumulation near their nodes. Six more presets now expose additional shapes in the soap view, including 0,2 and 2,3; their sand patterns can be less pronounced. These small-population trials guide preset curation, rather than guaranteeing an identical pattern in every dense run. Other frequencies remain available through Free tuning, and the complete 34-mode physical basis remains active.

Checkpoint baking defaults to the fine 14,000-grain state and can take several minutes on the CPU. Pass `--coarse` to regenerate the older 1,400-grain checkpoint.

`window.membrane` exposes the simulation, settings, renderer, camera, controls, speaker, audio and interaction functions. Set `manual = true` to suspend animation before calling `advance(dt)` and `render()`. `setView("wave" | "sand")` animates the view change; pass `{immediate: true}` as the second argument for a fixed capture. `viewBlend` reports its progress from 0 (sand) to 1 (wave). `advance(dt)` submits GPU work asynchronously, accepts up to one second, and uses a fixed step independently of rendering. Await `simulation.gpu.idle()` for completion. Await `simulation.gpu.readback()` before inspecting or encoding the CPU copies of `p`, `velocities`, `spin`, `height` and `modal.q/v`; these are not refreshed every frame. Positions and velocities use SI units; `positions` is the scene-scaled inspection copy. `simulation.gpu.stats` reports batch timing and the last inspected maximum contact count. `simulation.gpu.upload()` explicitly replaces GPU state with edited CPU inspection arrays. `await membrane.setGrainCount(28000)` changes density using the same path as the GUI.
