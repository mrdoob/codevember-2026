import * as THREE from 'three/webgpu';
import { uniform, pass, depth, screenUV, renderOutput, normalView, vec4, vec3, mrt, output, positionWorld, float, texture, normalMap, vec2, roughness, metalness, velocity, getViewPosition } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js';
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { createStudioLighting } from './studio-lighting.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { createGlass, addRefraction } from './glass.js';
import { colorGrade } from './grading.js';
// import { FontLoader } from 'three/addons/loaders/FontLoader.js';
// import { LETTER_SEQUENCE, LETTER_SHARDS, letterGeometry, letterSeed } from './letters.js';
import { PRIMITIVES, primitiveGeometry, fractureGeometry } from './fracture.js';
import { ShatterSimulation } from './simulation.js';
import { CameraJourney } from './journey.js';
import { studioFloorColor, studioCenter } from './studio.js';
import { floorSurfaceTextures } from './floor-surface.js';
import { glassSurfaceTextures } from './surface.js';

const status = document.querySelector('#status');
try {
  const renderer = new THREE.WebGPURenderer({ canvas: document.querySelector('canvas'), antialias: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  await renderer.init();
  const settings = {
    shape: PRIMITIVES[0], travelSpeed: 1.4, auto: true, cycle: true, speed: 0.65, spread: 0.22, toughness: 1.2, height: 5.8, pause: false,
    color: '#ffffff', tint: 1, roughness: 0.1, ior: 1.5, transmission: 1,
    bump: 0.065, absorption: 5, dispersion: 0.008, exposure: 0, quality: 0.65,
    reflections: 1, floorRoughness: 0.22, floorBump: 0.4, contactShading: 1,
    contrast: 1.25, saturation: 1.1, temperature: 0
  };
  const uniforms = {
    color: uniform(new THREE.Color(settings.color)), tint: uniform(settings.tint), roughness: uniform(settings.roughness),
    ior: uniform(settings.ior), refraction: uniform(settings.transmission),
    bump: uniform(settings.bump), absorption: uniform(settings.absorption), dispersion: uniform(settings.dispersion),
    contrast: uniform(settings.contrast), saturation: uniform(settings.saturation), temperature: uniform(settings.temperature)
  };
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 80);
  camera.position.set(5.5, 2.8, 9.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 0); controls.enableDamping = true;
  controls.minDistance = 9; controls.maxDistance = 25; controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = false; controls.update();

  const journey = new CameraJourney(camera, controls);
  const floors = [];
  const lighting = createStudioLighting(renderer);
  const environment = lighting.environment;
  const floorGeometry = new THREE.PlaneGeometry(200, 200);
  const floorMaterial = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.2, metalness: 0.05, envMapIntensity: 0.08 });
  // A broad pool of light gives the seamless studio floor its soft falloff.
  floorMaterial.colorNode = studioFloorColor(positionWorld);
  const floorMaps = floorSurfaceTextures();
  const floorUV = vec2(positionWorld.x, positionWorld.z.negate()).mul(0.25);
  const floorBump = uniform(settings.floorBump);
  const floorRoughness = uniform(settings.floorRoughness);
  floorMaterial.roughnessNode = texture(floorMaps.roughness, floorUV).r.sub(0.5).mul(0.04).add(floorRoughness).clamp(0.02, 1);
  floorMaterial.normalNode = normalMap(texture(floorMaps.normal, floorUV), vec2(floorBump));
  function makeScene() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#030814');
    scene.environment = environment.texture; scene.environmentIntensity = 0.8;
    scene.fog = new THREE.Fog('#030814', 22, 55);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial); floor.rotation.x = -Math.PI / 2; floor.userData.isFloor = true; floors.push(floor); scene.add(floor);
    lighting.addTo(scene);
    return scene;
  }
  const scenes = [makeScene(), makeScene(), makeScene()];
  const surfaceMaps = glassSurfaceTextures();
  const glass = scenes.map(() => createGlass(uniforms, surfaceMaps));
  const opticalId = uniform(0).onObjectUpdate(({ object }) => object.userData.opticalId || 0);
  const exitMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  exitMaterial.normalNode = glass[0].material.normalNode;
  exitMaterial.outputNode = vec4(normalView.negate().mul(0.5).add(0.5), opticalId);
  const exitScene = new THREE.Scene(); exitScene.background = new THREE.Color(0);
  scenes.push(exitScene);
  const materials = [...glass.map(g => g.material), exitMaterial];
  const exitPass = pass(exitScene, camera);
  exitPass.getTexture('output').minFilter = THREE.NearestFilter;
  exitPass.getTexture('output').magFilter = THREE.NearestFilter;
  const exitColor = exitPass.getTextureNode('output'), exitDepth = exitPass.getTextureNode('depth');
  const geometryPass = pass(scenes[1], camera);
  const frontDepth = geometryPass.getTextureNode('depth');
  // The second visible layer uses the same optical exit and environment,
  // keeping transmission meaningful through overlapping fragments.
  addRefraction(glass[2].material, glass[2].pigment, uniforms, { exitColor, exitDepth }, environment.texture, opticalId);
  glass[2].material.maskNode = depth.greaterThan(frontDepth.sample(screenUV).r.add(0.000003));
  const peelPass = pass(scenes[2], camera);
  peelPass.getTexture('output').generateMipmaps = true;
  peelPass.getTexture('output').minFilter = THREE.LinearMipmapLinearFilter;
  addRefraction(glass[0].material, glass[0].pigment, uniforms, {
    frontDepth, behindColor: peelPass.getTextureNode('output'), behindDepth: peelPass.getTextureNode('depth'), exitColor, exitDepth
  }, environment.texture, opticalId);
  const scenePass = pass(scenes[0], camera);
  const floorMask = uniform(0).onObjectUpdate(({ object }) => object.userData.isFloor ? 1 : 0);
  scenePass.setMRT(mrt({
    output, normal: vec4(normalView, roughness),
    encodedNormal: vec4(normalView.mul(0.5).add(0.5), floorMask),
    floor: vec2(roughness, metalness),
    velocity
  }));
  // Stay within WebGPU's default 32-byte attachment budget.
  scenePass.getTexture('floor').type = THREE.UnsignedByteType;
  scenePass.getTexture('floor').format = THREE.RGFormat;
  scenePass.getTexture('encodedNormal').type = THREE.UnsignedByteType;
  scenePass.getTexture('velocity').format = THREE.RGFormat;
  const beauty = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const sceneNormal = scenePass.getTextureNode('normal');
  const encodedNormal = scenePass.getTextureNode('encodedNormal');
  const floorSurface = scenePass.getTextureNode('floor');
  const floorPixels = encodedNormal.a;
  const floorPosition = uniform(camera.matrixWorld).mul(vec4(getViewPosition(screenUV, sceneDepth,
    uniform(camera.projectionMatrixInverse)), 1)).xyz;
  // Default physical-material dielectric F0 = 0.04, mixed with base color by metalness.
  const floorF0 = vec3(0.04 * (1 - floorMaterial.metalness))
    .add(studioFloorColor(floorPosition).mul(floorMaterial.metalness));
  // Sample the floor's microfacet lobe using the SAME roughness and perturbed
  // normal as its lighting. F0/F90 include the material's dielectric response.
  const reflections = ssr(beauty, sceneDepth, sceneNormal, {
    stochastic: true, metalnessNode: float(floorMaterial.metalness), roughnessNode: sceneNormal.a,
    specularNode: floorF0.mul(floorPixels), specularF90Node: floorPixels,
    binaryRefine: true, camera
  });
  reflections.resolutionScale = 0.5;
  reflections.maxDistance.value = 12;
  reflections.thickness.value = 0.08;
  reflections.quality.value = 0.75;
  const reflectionStrength = uniform(settings.reflections);
  const contactStrength = uniform(settings.contactShading);
  const contact = ao(sceneDepth, sceneNormal, camera);
  contact.resolutionScale = 0.5;
  contact.radius.value = 0.55; contact.thickness.value = 0.3;
  const rawReflection = reflections.getTextureNode();
  // Temporal/spatial filters expect encoded normals; tracing uses signed normals.
  const temporalReflection = temporalReproject(rawReflection, sceneDepth, encodedNormal,
    scenePass.getTextureNode('velocity'), camera, { mode: 'specular' });
  const reflected = recurrentDenoise(temporalReflection, camera, {
    depth: sceneDepth, normal: encodedNormal, metalRoughness: floorSurface,
    raw: rawReflection, mode: 'specular'
  });
  temporalReflection.setHistoryTexture(reflected);
  temporalReflection.maxFrames.value = 12;
  reflected.maxFrames.value = 12;
  // Reflection RGB is already BRDF-weighted indirect specular light. Do not
  // treat ray distance/history alpha as opacity or paint over diffuse lighting.
  const floorLight = float(1).sub(float(1).sub(contact).mul(floorPixels).mul(contactStrength));
  const reflectionAmount = floorPixels.mul(reflectionStrength);
  const studio = beauty.rgb.mul(floorLight)
    .add(reflected.rgb.mul(reflectionAmount));
  const pipeline = new THREE.RenderPipeline(renderer); pipeline.outputColorTransform = false;
  pipeline.outputNode = fxaa(colorGrade(renderOutput(vec4(studio, 1)), uniforms));

  // Letter mode (retained for switching back):
  // const font = await new FontLoader().loadAsync('./assets/helvetiker_bold.typeface.json');
  // const sequence = LETTER_SEQUENCE;
  const sequence = PRIMITIVES;
  const templates = new Map();
  let sequenceIndex = 0;
  // const pendingLetters = [];
  function template(shape) {
    if (!templates.has(shape)) {
      // const source = letterGeometry(shape, font);
      // templates.set(shape, fractureGeometry(source, LETTER_SHARDS, letterSeed(shape), shape));
      const source = primitiveGeometry(shape);
      templates.set(shape, fractureGeometry(source, shape === 'Torus' ? 68 : 64, sequence.indexOf(shape) * 71 + 13, shape));
      source.setAttribute('fractureFace', new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.count), 1));
      source.setAttribute('fractureEdge', new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.count), 1));
      // Letter thickness: 0.6.
      source.setAttribute('glassThickness', new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.count).fill(shape === 'Torus' ? 2 * source.parameters.tube : 1.8), 1));
      source.computeBoundingSphere();
      templates.get(shape).intact = source;
    }
    return templates.get(shape);
  }
  let nextDrop = 0, drops = 0, nextOpticalId = 1;
  const allocateOpticalId = () => { nextOpticalId = nextOpticalId % 1800 + 1; return nextOpticalId; };
  const simulation = new ShatterSimulation();
  function remove(body) {
    for (const f of body.fragments) f.meshes.forEach((mesh, i) => scenes[i].remove(mesh));
    body.meshes.forEach((mesh, i) => scenes[i].remove(mesh));
    simulation.remove(body);
  }
  function selectShape(shape) {
    // Letter mode: shape = shape.toUpperCase();
    if (!sequence.includes(shape)) return false;
    settings.shape = shape;
    const index = sequence.indexOf(shape);
    if (index >= 0) sequenceIndex = index;
    return true;
  }
  function drop(shape) {
    if (simulation.bodies.some(body => !body.broken && !body.sleeping)) return false;
    const explicitShape = shape !== undefined;
    shape ??= settings.cycle ? sequence[sequenceIndex] : settings.shape;
    if (!sequence.includes(shape)) return false;
    while (simulation.bodies.length >= 12) remove(simulation.bodies[0]);
    const shards = template(shape), bounds = shards.intact.boundingSphere;
    const height = journey.spawnHeight(bounds.radius + bounds.center.length(), settings.height);
    const body = simulation.drop(shards, {
      height, x: journey.launchPoint.x, z: journey.launchPoint.z,
      spread: settings.spread, toughness: settings.toughness,
      rotation: new THREE.Euler(THREE.MathUtils.degToRad((Math.random() - 0.5) * 40), 0.35, Math.sin(drops * 2.4) * 0.15),
      angularVelocity: new THREE.Vector3().randomDirection().multiplyScalar(0.8 + Math.random() * 1.6)
    });
    body.shape = shape;
    // Advance around the hue wheel per drop, including repeated shapes.
    // Every render pass and fragment retains the parent's color.
    body.tint = new THREE.Color(['#8deeff', '#ff94d9', '#81f4c2', '#9ccaff', '#e9a4ff'][drops % 5]);
    const intactId = allocateOpticalId();
    body.meshes = scenes.map((scene, i) => { const mesh = new THREE.Mesh(template(shape).intact, materials[i]); mesh.userData.opticalId = intactId; mesh.userData.glassTint = body.tint; scene.add(mesh); return mesh; });
    for (const f of body.fragments) {
      const id = allocateOpticalId();
      f.meshes = scenes.map((scene, i) => {
        const mesh = new THREE.Mesh(f.geometry, materials[i]); mesh.userData.opticalId = id; mesh.userData.glassTint = body.tint; scene.add(mesh); return mesh;
      });
    }
    settings.shape = shape;
    if (!explicitShape && settings.cycle) sequenceIndex = (sequenceIndex + 1) % sequence.length;
    nextDrop = simulation.time + 3; drops++;
    return true;
  }
  /* Letter keyboard queue — disabled while trying primitives.
  function flushLetters() {
    if (pendingLetters.length && drop(pendingLetters[0])) pendingLetters.shift();
  }
  function throwLetter(letter) {
    letter = letter.toUpperCase();
    if (!/^[A-Z]$/.test(letter)) return false;
    // Preserve quick typing without spawning overlapping intact solids.
    pendingLetters.push(letter);
    flushLetters();
    return true;
  }
  */
  function sync() {
    for (const body of simulation.bodies) {
      for (const mesh of body.meshes) { mesh.visible = !body.broken; mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); }
      for (const f of body.fragments) for (const mesh of f.meshes) {
        mesh.visible = body.broken;
        mesh.position.copy(f.position);
        mesh.quaternion.copy(f.quaternion);
      }
    }
  }
  function reset() {
    for (const body of [...simulation.bodies]) remove(body);
    simulation.clear();
    // pendingLetters.length = 0;
    journey.reset(); updateStudio();
    if (settings.cycle) sequenceIndex = 0;
    drop(); sync();
  }
  function pause(value = !settings.pause) { settings.pause = value; }
  let pointerStart = null;
  renderer.domElement.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointerup', event => {
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 5) drop();
    pointerStart = null;
  });
  renderer.domElement.addEventListener('pointercancel', () => pointerStart = null);
  addEventListener('keydown', event => {
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
    // if (/^[a-z]$/i.test(event.key)) { event.preventDefault(); throwLetter(event.key); return; }
    if (event.code === 'Space') { event.preventDefault(); pause(); }
    else if (event.code === 'Enter') { event.preventDefault(); drop(); }
  });
  const gui = new GUI({ title: 'Settings', width: 240 }); gui.close();
  const motion = gui.addFolder('Simulation');
  motion.add(settings, 'auto').name('Auto drop'); motion.add(settings, 'cycle').name('Cycle shapes').listen();
  motion.add(settings, 'travelSpeed', 0, 3, 0.1).name('Camera travel');
  motion.add(settings, 'speed', 0.1, 1.5, 0.05).name('Time scale');
  motion.add(settings, 'spread', 0, 0.5, 0.01).name('Fracture energy');
  motion.add(settings, 'toughness', 0.2, 6, 0.1).name('Break threshold');
  motion.add(settings, 'height', 3, 8, 0.1).name('Min drop height');
  motion.add({ reset }, 'reset').name('Reset simulation');
  const material = gui.addFolder('Glass');
  material.addColor(settings, 'color').name('Tint balance').onChange(v => uniforms.color.value.set(v));
  material.add(settings, 'tint', 0, 1, 0.01).name('Color density').onChange(v => uniforms.tint.value = v);
  material.add(settings, 'roughness', 0, 1, 0.005).onChange(v => uniforms.roughness.value = v);
  material.add(settings, 'ior', 1, 1.9, 0.01).name('IOR').onChange(v => uniforms.ior.value = v);
  material.add(settings, 'transmission', 0, 1, 0.01).name('Refraction').onChange(v => uniforms.refraction.value = v);
  material.add(settings, 'bump', 0, 2, 0.01).name('Fracture detail').onChange(v => uniforms.bump.value = v);
  material.add(settings, 'absorption', 0, 5, 0.05).name('Absorption').onChange(v => uniforms.absorption.value = v);
  material.add(settings, 'dispersion', 0, 0.08, 0.001).name('Dispersion').onChange(v => uniforms.dispersion.value = v);
  const rendering = gui.addFolder('Rendering');
  rendering.add(settings, 'reflections', 0, 1, 0.01).name('Floor reflections').onChange(v => reflectionStrength.value = v);
  rendering.add(settings, 'floorBump', 0, 2, 0.05).name('Floor bump').onChange(v => floorBump.value = v);
  rendering.add(settings, 'floorRoughness', 0, 1, 0.01).name('Floor roughness').onChange(v => floorRoughness.value = v);
  rendering.add(settings, 'contactShading', 0, 1, 0.01).name('Contact shading').onChange(v => contactStrength.value = v);
  rendering.add(settings, 'quality', { Low: 0.65, Medium: 1, High: 1.5 }).name('Resolution').onChange(resize);
  rendering.close();
  const grading = gui.addFolder('Color grading');
  grading.add(settings, 'exposure', -2, 2, 0.01).name('Exposure').onChange(v => renderer.toneMappingExposure = 1.05 * 2 ** v);
  grading.add(settings, 'contrast', 0.5, 1.5, 0.01).name('Contrast').onChange(v => uniforms.contrast.value = v);
  grading.add(settings, 'saturation', 0, 2, 0.01).name('Saturation').onChange(v => uniforms.saturation.value = v);
  grading.add(settings, 'temperature', -1, 1, 0.01).name('Temperature').onChange(v => uniforms.temperature.value = v);
  grading.close();
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(Math.tan(21 * Math.PI / 180), Math.tan(17 * Math.PI / 180) / camera.aspect)));
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * settings.quality);
    renderer.setSize(innerWidth, innerHeight, false);
  }
  addEventListener('resize', resize); resize();
  drop(); sync();
  let last = performance.now(), failed = false;
  function updateStudio() {
    studioCenter.value.copy(journey.launchPoint);
    lighting.update(journey.launchPoint);
    for (const floor of floors) { floor.position.x = journey.launchPoint.x; floor.position.z = journey.launchPoint.z; }
    simulation.moveGround(journey.launchPoint.x, journey.launchPoint.z);
  }
  function advance(delta) {
    const before = simulation.time;
    simulation.update(delta);
    journey.advance(simulation.time - before, settings.travelSpeed);
    updateStudio();
    for (const body of [...simulation.bodies]) if (journey.outOfRange(body)) remove(body);
    // if (pendingLetters.length) { flushLetters(); sync(); return; }
    if (settings.auto && simulation.time >= nextDrop) {
      drop();
    }
    sync();
  }
  renderer.setAnimationLoop(now => {
    if (failed) return;
    try {
      const delta = Math.min((now - last) / 1000, 0.05); last = now;
      if (!settings.pause) advance(delta * settings.speed);
      controls.update(); pipeline.render(); status.hidden = true;
    } catch (error) { failed = true; status.hidden = false; status.textContent = `Rendering failed: ${error.message}`; console.error(error); }
  });
  // Deterministic stepping and state inspection for capture and validation.
  // Letter inspection hooks: throwLetter, get pendingLetters() { return [...pendingLetters]; }
  window.shatter = { renderer, camera, controls, journey, simulation, settings, uniforms, templates, rendering: { scenePass, reflections, floorRoughness, floorBump }, drop, reset, pause, selectShape, advance, render: () => { sync(); pipeline.render(); }, get drops() { return drops; } };
} catch (error) {
  status.textContent = `Unable to start: ${error.message}`; console.error(error);
}
