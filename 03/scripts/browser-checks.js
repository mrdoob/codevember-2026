// Run in the existing preview through DevTools/MCP. No browser launch and no
// unbounded simulation loops. Full-buffer reads happen only in these checks.
import { PRIMITIVES, sculptureDistance } from '../sculpture.js';
import { WAX_LIGHT_DIRECTIONS } from '../lighting-config.js';
import { HEAT_RADIUS, HEAT_DURATION, HEAT_FALLOFF } from '../heat-source.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
export async function snapshot(app) {
  const g = app.gpu;
  await app.inspect();
  const p = new Float32Array(await app.renderer.getArrayBufferAsync(g.positions[g.frame % 2].value));
  check(p.every(Number.isFinite), 'Non-finite GPU particle state');
  check(app.stats.particles === g.n && app.stats.triangles > 0 && !app.stats.overflow, 'Invalid GPU output count');
  let height = 0, minY = Infinity, maxY = -Infinity, maxDrift = 0;
  for (let i = 0; i < g.n; i++) {
    const x = p[i * 4], y = p[i * 4 + 1], z = p[i * 4 + 2];
    check(Math.abs(x) < 3.121 && Math.abs(z) < 2.121 && y >= app.seed.spacing*.42-.000001 && y <= 4.501, 'Particle outside simulation bounds');
    height += y; minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    maxDrift = Math.max(maxDrift, Math.hypot(x-app.seed.positions[i*3], y-app.seed.positions[i*3+1], z-app.seed.positions[i*3+2]));
  }
  return { stats: app.stats, performance: app.performance, meanY: height / g.n, minY, maxY, maxDrift, p };
}
export async function runSteps(app, count) {
  check(Number.isInteger(count) && count >= 0 && count <= 450, 'Test batch too large');
  const cpu = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await app.advance(1 / 30); cpu.push(app.performance.cpuMs);
    await wait(Math.max(0, 1000 / 30 - (performance.now() - start)));
  }
  const state = await snapshot(app); delete state.p;
  cpu.sort((a, b) => a - b);
  return { ...state, cpuMedianMs: cpu[Math.floor(cpu.length * .5)], cpu95Ms: cpu[Math.floor(cpu.length * .95)] };
}
export async function fieldCulling(app) {
  app.pause(true); await app.advance(0);
  const { wgslFn, instanceIndex } = await import('three/tsl');
  const g = app.gpu, bins = g.heads.value.count / 2;
  // Compare the actual field with a reference that visits every neighborhood.
  const visitAll = wgslFn(`fn visitAllBins(id:u32, heads:ptr<storage,array<atomic<u32>>,read_write>) -> void {
    if(id<${bins}u) { atomicStore(&(*heads)[${bins}u+id],1u); }
  }`)({ id:instanceIndex, heads:g.heads }).compute(bins, [64]);
  const read = async node => new Float32Array(await app.renderer.getArrayBufferAsync(node.value));
  const field = await read(g.field), normals = await read(g.fieldNormals);
  try {
    app.renderer.compute([visitAll, g.fieldNodes[g.frame % 2]]);
    const referenceField = await read(g.field), referenceNormals = await read(g.fieldNormals);
    let fieldError = 0, normalError = 0;
    for (let i=0; i<field.length; i++) {
      fieldError = Math.max(fieldError, Math.abs(field[i]-referenceField[i]));
      normalError = Math.max(normalError, Math.abs(normals[i]-referenceNormals[i]));
    }
    check(fieldError < 1e-7 && normalError < 1e-7, 'Empty-cell culling changed the reconstructed field');
    return { fieldError, normalError };
  } finally {
    app.renderer.compute([g.fieldOccupancyNode, g.fieldNodes[g.frame % 2]]);
    visitAll.dispose();
  }
}
export async function coldAndReset(app) {
  app.pause(true); app.selectShape('Torus'); await app.advance(0); app.settings.heat = 0;
  await runSteps(app, 60);
  const cold = await snapshot(app);
  check(cold.maxDrift < .03 && cold.stats.liquid === 0, 'Cold sculpture moved');
  app.reset(); await app.advance(0); app.settings.heat = 1;
  const reset = await snapshot(app);
  check(reset.maxDrift < .000001 && reset.stats.time === 0, 'Reset failed');
  const frames = app.performance.frames;
  await wait(350);
  check(app.performance.frames === frames, 'Paused preview kept rendering');
  return { coldDrift: cold.maxDrift, reset: true, pausedIdle: true };
}

export async function topDownHeating(app) {
  const saved = { heat: app.settings.heat, heatRadius: app.settings.heatRadius, heatDuration: app.settings.heatDuration };
  try {
    app.pause(true); Object.assign(app.settings, { heat: 1, heatRadius: HEAT_RADIUS, heatDuration: HEAT_DURATION });
    app.selectShape('Cube', [0, 0, 0, 1]); await app.advance(0);
    const initial = await snapshot(app);
    await runSteps(app, 30);
    const warm = await snapshot(app);
    const bands = Array.from({ length: 3 }, () => ({ count: 0, enthalpy: 0, liquid: 0, drop: 0, maxDrift: 0 }));
    for (let i = 0; i < app.gpu.n; i++) {
      const j = i * 4, y = initial.p[j + 1];
      const b = bands[Math.min(2, Math.floor(3 * (y - initial.minY) / (initial.maxY - initial.minY)))];
      b.count++; b.enthalpy += warm.p[j + 3];
      b.liquid += Math.max(0, Math.min(1, (warm.p[j + 3] - 42) / 28));
      b.drop += y - warm.p[j + 1];
      b.maxDrift = Math.max(b.maxDrift, Math.hypot(warm.p[j] - initial.p[j], warm.p[j + 1] - y, warm.p[j + 2] - initial.p[j + 2]));
    }
    for (const b of bands) for (const key of ['enthalpy', 'liquid', 'drop']) b[key] /= b.count;
    const [bottom, middle, top] = bands;
    check(top.liquid > .1 && bottom.liquid < .05, 'Descending source did not melt the top before the base');
    check(middle.enthalpy > bottom.enthalpy + .1 && middle.enthalpy < top.enthalpy, 'Interior did not warm behind the melting surface');
    check(bottom.maxDrift < .05 && top.drop > .001, 'Cold base did not support the softening top');
    await runSteps(app, 120);
    const melted = await snapshot(app);
    check(melted.stats.liquid > .85 && melted.meanY < .35, 'Melt did not reach the base and form a puddle');
    return { atOneSecond: { bottom, middle, top }, atFiveSeconds: { liquid: melted.stats.liquid, meanHeight: melted.meanY } };
  } finally { Object.assign(app.settings, saved); }
}

export async function proximityHeating(app) {
  const saved = { heat: app.settings.heat, heatRadius: app.settings.heatRadius, heatDuration: app.settings.heatDuration };
  try {
    app.pause(true); Object.assign(app.settings, { heat: 1, heatRadius: .35, heatDuration: HEAT_DURATION });
    app.selectShape('Cube', [0, 0, 0, 1]); await app.advance(0);
    const seed = app.seed;
    await app.advance(1 / 60);
    const state = await snapshot(app), sphere = app.gpu.heatSphere.value, samples = [];
    check(app.seed === seed, 'Shape changed during proximity check');
    let error = 0, heated = 0, unheated = 0, centerRise = 0, cornerRise = 0, centerCount = 0, cornerCount = 0;
    const top = Math.max(...seed.positions.filter((_, i) => i % 3 === 1));
    for (let i = 0; i < app.gpu.n; i++) {
      const x = seed.positions[i*3], y = seed.positions[i*3+1], z = seed.positions[i*3+2];
      const distance = Math.hypot(x-sphere.x, y-sphere.y, z-sphere.z) - sphere.w;
      const t = Math.max(0, Math.min(1, distance / HEAT_FALLOFF));
      const incident = 1 - t*t*(3-2*t), rise = state.p[i*4+3] - 22;
      // Initially every neighbor is at ambient temperature: conduction and
      // cooling are zero. This isolates spherical input and local capacity.
      const expected = 170 * incident * .18 * (10 / 60) / seed.heatCapacity[i];
      error = Math.max(error, Math.abs(rise - expected));
      if (incident > .03) { heated++; samples.push([seed.heatCapacity[i], rise / incident]); }
      if (incident === 0) { unheated++; check(Math.abs(rise) < .0001, 'Fire heated a particle outside its influence'); }
      // Surface projection slightly offsets the rounded cube's top samples.
      // Compare the same sampling layer at either particle resolution.
      if (Math.abs(y-top) < seed.spacing*.1) {
        if (Math.abs(x) < .2 && Math.abs(z) < .2) { centerRise = Math.max(centerRise, rise); centerCount++; }
        if (Math.abs(x) > .6 && Math.abs(z) > .6) { cornerRise = Math.max(cornerRise, rise); cornerCount++; }
      }
    }
    check(error < .001 && heated > 10 && unheated > 100, 'GPU heat does not match spherical proximity');
    check(centerCount > 0 && cornerCount > 0 && centerRise > .5 && cornerRise < .0001, 'Top-layer particles did not respond to radial distance');
    const mean = samples.reduce((a, pair) => a.map((v, i) => v + pair[i] / samples.length), [0, 0]);
    let covariance = 0, capacityVariance = 0, heatVariance = 0;
    for (const [capacity, enthalpy] of samples) {
      covariance += (capacity-mean[0]) * (enthalpy-mean[1]);
      capacityVariance += (capacity-mean[0])**2; heatVariance += (enthalpy-mean[1])**2;
    }
    const correlation = covariance / Math.sqrt(capacityVariance * heatVariance);
    check(correlation < -.95, 'Material patches did not retain their different heat capacities');
    return { heated, unheated, maximumHeatError: error, centerRise, cornerRise, capacityHeatCorrelation: correlation };
  } finally { Object.assign(app.settings, saved); }
}

export const unevenHeating = proximityHeating;

export async function primitiveShapes(app) {
  const buffers = app.gpu.attributes.slice();
  const results = [];
  for (const shape of PRIMITIVES) {
    app.selectShape(shape); await app.advance(0); await wait(50);
    const state = await snapshot(app);
    const g=app.gpu;
    const vertices=new Float32Array(await app.renderer.getArrayBufferAsync(g.vertices.value));
    const thickness=new Float32Array(await app.renderer.getArrayBufferAsync(g.thickness.value));
    const count=state.stats.triangles*3;
    let error=0;
    for(let i=0;i<count;i++) {
      for (let light = 0; light < 3; light++) {
        const path = thickness[i*4+light];
        check(Number.isFinite(path) && path >= 0 && path <= 2.001, 'Invalid directional optical path');
      }
      const distance=sculptureDistance(app.seed,vertices[i*4],vertices[i*4+1],vertices[i*4+2]);
      check(Number.isFinite(distance), 'Invalid primitive surface');
      error=Math.max(error,Math.abs(distance));
    }
    check(error<.12, 'Solid surface does not match its primitive: '+shape);
    check(g.attributes.every((a,i)=>a===buffers[i]), 'Shape selection allocated new buffers');
    results.push({shape,particles:g.n,triangles:state.stats.triangles,maxSurfaceError:error});
  }
  app.selectShape('Torus'); await app.advance(0);
  return results;
}

export async function directionalThickness(app) {
  app.selectShape('Sphere'); await app.advance(0);
  const state = await snapshot(app), g = app.gpu;
  const vertices = new Float32Array(await app.renderer.getArrayBufferAsync(g.vertices.value));
  const paths = new Float32Array(await app.renderer.getArrayBufferAsync(g.thickness.value));
  let error = 0, maximum = 0, count = 0, fireError = 0, fireMaximum = 0;
  // Compare GPU integration against the sphere's analytic ray intersection.
  for (let i = 0; i < state.stats.triangles * 3; i++) {
    const p = [vertices[i*4], vertices[i*4+1] - app.seed.centerY, vertices[i*4+2]];
    const c = p.reduce((sum, x) => sum + x*x, 0) - 1.09**2;
    for (let light = 0; light < 2; light++) {
      const b = p.reduce((sum, x, axis) => sum + x * WAX_LIGHT_DIRECTIONS[light][axis], 0);
      const expected = Math.max(0, Math.min(2, -b + Math.sqrt(Math.max(0, b*b - c))));
      const difference = Math.abs(paths[i*4+light] - expected);
      check(Number.isFinite(difference), 'Non-finite optical thickness');
      error += difference; maximum = Math.max(maximum, difference); count++;
    }
    const fire = g.fireSphere.value;
    const ray = [fire.x-vertices[i*4], fire.y-vertices[i*4+1], fire.z-vertices[i*4+2]];
    const distance = Math.hypot(...ray), limit = Math.max(0, distance-fire.w);
    const b = p.reduce((sum, x, axis) => sum+x*ray[axis]/distance, 0);
    const root = Math.sqrt(Math.max(0, b*b-c));
    const expected = Math.min(2, Math.max(0, Math.min(limit, -b+root)-Math.max(0, -b-root)));
    const difference = Math.abs(paths[i*4+2]-expected);
    check(Number.isFinite(difference), 'Non-finite fire optical thickness');
    fireError += difference; fireMaximum = Math.max(fireMaximum, difference);
  }
  check(error / count < .08 && maximum < .2, 'Optical thickness does not follow the light direction');
  const fireMean = fireError / (state.stats.triangles*3);
  check(fireMean < .08 && fireMaximum < .2, 'Fire optical thickness does not stop at the emitter');
  return { meanPathError: error / count, maxPathError: maximum, fireMeanPathError: fireMean, fireMaxPathError: fireMaximum };
}

export async function shadowComparison(app) {
  app.selectShape('Torus', [0, 0, 0, 1]); await app.advance(0);
  const original = app.studio.key.shadow.intensity;
  const target = new OffscreenCanvas(128, 128), context = target.getContext('2d', { willReadFrequently: true });
  const capture = async intensity => {
    app.studio.key.shadow.intensity = intensity;
    await new Promise(requestAnimationFrame);
    app.drawScene(); context.drawImage(document.querySelector('canvas'), 0, 0, 128, 128);
    return context.getImageData(0, 0, 128, 128).data;
  };
  try {
    const off = await capture(0), on = await capture(1);
    let selfShadow = 0, floorShadow = 0;
    // Default camera: the central region contains the torus, above its floor shadow.
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const i = (x + y*128)*4;
      const difference = (off[i] + off[i+1] + off[i+2] - on[i] - on[i+1] - on[i+2]) / 3;
      if (difference > 2) {
        if (x > 43 && x < 86 && y > 28 && y < 90) selfShadow++;
        else floorShadow++;
      }
    }
    check(selfShadow > 50 && floorShadow > 50, 'Shadow map did not shade both the wax and its surroundings');
    return { selfShadowPixels: selfShadow, floorShadowPixels: floorShadow };
  } finally { app.studio.key.shadow.intensity = original; await app.render(); }
}

export async function scatteringComparison(app) {
  const strength=app.scattering.value;
  const canvas=document.querySelector('canvas'), target=new OffscreenCanvas(128,128);
  const context=target.getContext('2d',{willReadFrequently:true});
  const capture=async value => {
    app.scattering.value=value;
    // PassNode/RTT update once per browser frame. Give each comparison its own
    // frame so it cannot reuse the preceding scene texture.
    await new Promise(requestAnimationFrame);
    // Copy before yielding: the browser may clear a presented WebGPU canvas.
    app.drawScene();
    context.clearRect(0,0,128,128);
    context.drawImage(canvas,0,0,128,128);
    const pixels=context.getImageData(0,0,128,128).data;
    check(pixels[3]===255,'Capture did not contain the rendered frame');
    return pixels;
  };
  try {
    const off=await capture(0), on=await capture(strength);
    let changed=0, total=0, maximum=0;
    for(let i=0;i<off.length;i+=4) {
      const difference=Math.max(Math.abs(off[i]-on[i]),Math.abs(off[i+1]-on[i+1]),Math.abs(off[i+2]-on[i+2]));
      if(difference>2) changed++;
      total+=difference; maximum=Math.max(maximum,difference);
    }
    check(changed>100 && changed<128*128*.6 && maximum>5,'Scattering comparison failed or background changed');
    return {changedPixels:changed,maxChannelDifference:maximum,meanChannelDifference:total/(128*128)};
  } finally { app.scattering.value=strength; await app.render(); }
}

export async function colorGradingComparison(app) {
  const grading = app.postProcessing.grading;
  const original = Object.fromEntries(Object.entries(grading).map(([name, node]) => [name, node.value]));
  const target = new OffscreenCanvas(128, 128), context = target.getContext('2d', { willReadFrequently: true });
  const capture = async values => {
    for (const [name, value] of Object.entries({ temperature: 0, tint: 0, saturation: 1, contrast: 1, ...values })) grading[name].value = value;
    await new Promise(requestAnimationFrame);
    app.drawScene(); context.drawImage(document.querySelector('canvas'), 0, 0, 128, 128);
    return context.getImageData(0, 0, 128, 128).data;
  };
  try {
    const neutral = await capture({}), gray = await capture({ saturation: 0 });
    const warm = await capture({ temperature: 1 }), cool = await capture({ temperature: -1 });
    const restored = await capture({});
    let grayError = 0, temperatureShift = 0, resetError = 0;
    for (let i = 0; i < neutral.length; i += 4) {
      grayError = Math.max(grayError, Math.abs(gray[i] - gray[i+1]), Math.abs(gray[i] - gray[i+2]));
      temperatureShift += (warm[i] - warm[i+2]) - (cool[i] - cool[i+2]);
      for (let channel = 0; channel < 3; channel++) resetError = Math.max(resetError, Math.abs(neutral[i+channel] - restored[i+channel]));
    }
    temperatureShift /= 128*128;
    check(grayError <= 2 && temperatureShift > 5 && resetError <= 1, 'Color grading failed or neutral grade did not restore the image');
    return { grayChannelError: grayError, temperatureShift, resetError };
  } finally {
    for (const [name, value] of Object.entries(original)) grading[name].value = value;
    await app.render();
  }
}

export async function pcssSoftness(app) {
  app.pause(true); await app.advance(0);
  const THREE = await import('three/webgpu');
  const { createStudioLighting } = await import('../studio-lighting.js');
  const renderer = app.renderer, previousTarget = renderer.getRenderTarget(), toneMapping = renderer.toneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(1, 1, 1);
  const studio = createStudioLighting(scene);
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, .1, 20);
  camera.position.set(0, 8, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
  const floorMaterial = new THREE.MeshBasicNodeMaterial(); floorMaterial.colorNode = studio.keyShadow;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), floorMaterial);
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(.9, .2, .9), new THREE.MeshBasicNodeMaterial({ color: 0 }));
  blocker.castShadow = true; scene.add(blocker);
  const target = new THREE.RenderTarget(256, 256, { type: THREE.UnsignedByteType });
  const measure = async (height, softness) => {
    blocker.position.y = height; studio.shadowSoftness.value = softness;
    await new Promise(requestAnimationFrame);
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256);
    let penumbra = 0, dark = 0, darkening = 0, maximum = 0;
    for (let i=0; i<pixels.length; i+=4) {
      if (pixels[i] > 16 && pixels[i] < 239) penumbra++;
      if (pixels[i] < 16) dark++;
      if (pixels[i] > 16) { darkening += 255-pixels[i]; maximum = Math.max(maximum, 255-pixels[i]); }
    }
    return { penumbraPixels: penumbra, darkPixels: dark, darkening, maximum };
  };
  try {
    renderer.toneMapping = THREE.NoToneMapping;
    const near = await measure(.11, .12), far = await measure(1.3, .12), hard = await measure(1.3, 0);
    check(far.penumbraPixels > near.penumbraPixels*1.5+20, 'PCSS did not widen the penumbra with blocker separation');
    check(far.penumbraPixels > hard.penumbraPixels*1.5+20, 'PCSS light size did not change shadow softness');
    // Isolate the ambient term: it must fade with separation and leave lit
    // regions white. The black caster is excluded from the darkening totals.
    floorMaterial.colorNode = studio.shadowAO; floorMaterial.needsUpdate = true;
    const contact = await measure(.11, .12), distant = await measure(1.3, .12);
    studio.shadowAOStrength.value = 0;
    const disabled = await measure(.11, .12);
    check(contact.maximum > distant.maximum+15 && contact.darkening > distant.darkening*1.5, 'Shadow AO did not fade with blocker distance');
    check(disabled.darkening === 0, 'Zero shadow AO left ambient darkening');
    return { near, far, hard, contactAO: { contact, distant, disabled } };
  } finally {
    renderer.setRenderTarget(previousTarget); renderer.toneMapping = toneMapping;
    target.dispose(); studio.key.shadow.dispose(); studio.keyShadow.dispose();
    scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    await app.render();
  }
}

export async function materialState(app) {
  const state=await snapshot(app);
  const vertices=new Float32Array(await app.renderer.getArrayBufferAsync(app.gpu.vertices.value));
  let volume=0;
  for(let i=0;i<state.stats.triangles*12;i+=12) {
    const ax=vertices[i], ay=vertices[i+1], az=vertices[i+2];
    const bx=vertices[i+4], by=vertices[i+5], bz=vertices[i+6];
    const cx=vertices[i+8], cy=vertices[i+9], cz=vertices[i+10];
    volume+=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx);
  }
  const nearest=[];
  for(let i=0;i<app.gpu.n;i++) {
    let distance=Infinity;
    for(let j=0;j<app.gpu.n;j++) if(i!==j) distance=Math.min(distance,Math.hypot(state.p[i*4]-state.p[j*4],state.p[i*4+1]-state.p[j*4+1],state.p[i*4+2]-state.p[j*4+2]));
    nearest.push(distance);
  }
  nearest.sort((a,b)=>a-b);
  check(nearest[0]>.01,'Particles collapsed onto the same position');
  return {volume:Math.abs(volume/6),nearestMinimum:nearest[0],nearestMedian:nearest[Math.floor(nearest.length/2)]};
}

// Call after a full melt has had at least 15 simulated seconds to settle.
export async function settledMotion(app) {
  app.pause(true); await app.advance(0);
  const initial = await snapshot(app), seed = app.seed;
  check(initial.stats.liquid > .99 && initial.meanY < .3, 'Settling check needs a liquid puddle');
  const g = app.gpu;
  const read = async () => new Float32Array(await app.renderer.getArrayBufferAsync(g.positions[g.frame % 2].value));
  const measure = async jittered => {
    let previous = await read(), squared = 0, maximum = 0;
    for (let frame = 0; frame < 60; frame++) {
      await app.advance(1/60 + (jittered && frame % 2 ? .000001 : 0));
      const current = await read();
      check(app.seed === seed, 'Shape changed during settling check');
      for (let i = 0; i < g.n; i++) {
        const j = i*4, motion = Math.hypot(current[j]-previous[j], current[j+1]-previous[j+1], current[j+2]-previous[j+2]);
        squared += motion*motion; maximum = Math.max(maximum, motion);
      }
      previous = current; await wait(17);
    }
    const velocities = new Float32Array(await app.renderer.getArrayBufferAsync(g.velocities[g.frame % 2].value));
    let speed = 0;
    for (let i = 0; i < g.n; i++) speed += Math.hypot(velocities[i*4], velocities[i*4+1], velocities[i*4+2]);
    return { rmsMotion: Math.sqrt(squared / (g.n*60)), maxMotion: maximum, meanStoredSpeed: speed/g.n };
  };
  const fixed = await measure(false), jittered = await measure(true);
  check(jittered.rmsMotion < fixed.rmsMotion*1.6 + .00001, 'Tiny timing changes amplified resting motion');
  check(jittered.rmsMotion < .001 && jittered.meanStoredSpeed < .1, 'Resting contacts retained excessive motion');
  return { fixed, jittered };
}
