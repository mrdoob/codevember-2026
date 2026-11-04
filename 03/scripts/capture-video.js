import { PRIMITIVES } from '../sculpture.js';

const FPS = 30, SIZE = 1024, RENDER_SIZE = 1536;
const CLIP_FRAMES = 150;
const TOTAL_FRAMES = PRIMITIVES.length * CLIP_FRAMES;
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

export function capturePlan(seed = 20261103) {
  const random = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let x = Math.imul(seed ^ seed >>> 15, 1 | seed);
    x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
  return PRIMITIVES.map(shape => {
    const u = random(), a = random()*Math.PI*2, b = random()*Math.PI*2;
    return { shape, rotation: [Math.sqrt(1-u)*Math.sin(a), Math.sqrt(1-u)*Math.cos(a), Math.sqrt(u)*Math.sin(b), Math.sqrt(u)*Math.cos(b)], thermalSeed: Math.floor(random()*4294967296) };
  });
}

// Same ordered PNG/FFmpeg workflow as days 01 and 02. Record each shape once,
// in chronological order, preserving the experiment's immediate shape switches.
export async function captureVideo({
  receiver = 'http://localhost:8004', seed = 20261103, rotationSeed = seed,
  cameraPolarAngle
} = {}) {
  const app = window.melt;
  if (!app) throw new Error('Wait for the scene to load');
  cameraPolarAngle ??= app.controls.maxPolarAngle;
  if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1) throw new Error('Set viewport to 1024 × 1024 at device scale 1');
  if (['preparing', 'capturing', 'encoding'].includes(window.captureProgress?.status)) throw new Error('Capture already running');
  if (!Number.isFinite(cameraPolarAngle) || cameraPolarAngle < app.controls.minPolarAngle || cameraPolarAngle > app.controls.maxPolarAngle) throw new Error('Recording angle is outside the orbit controls limits');
  // Keep the framing distance when lowering the camera around its target.
  const orbitDistance = Math.hypot(9.4, 2.8);
  const orbitRadius = orbitDistance * Math.sin(cameraPolarAngle);
  const orbitHeight = 1.4 + orbitDistance * Math.cos(cameraPolarAngle);
  const plan = capturePlan(seed);
  if (rotationSeed !== seed) {
    const rotations = capturePlan(rotationSeed);
    plan.forEach((item, index) => { item.rotation = rotations[index].rotation; });
  }
  const capturedClips = [];
  const state = window.captureProgress = { status: 'preparing', frame: 0, totalFrames: TOTAL_FRAMES, shape: null, started: performance.now(), cancelled: false };
  const renderer = app.renderer, source = renderer.domElement, camera = app.camera, controls = app.controls;
  const header = document.querySelector('header'), panel = document.querySelector('.lil-gui.root'), uiScale = Math.SQRT2;
  const previous = { settings: { ...app.settings }, camera:camera.position.clone(), target:controls.target.clone(),
    seed:{shape:app.seed.shape,rotation:[...app.seed.rotation],thermalSeed:app.seed.thermalSeed},
    enabled:controls.enabled, autoRotate:controls.autoRotate, aspect:camera.aspect, fov:camera.fov,
    pixelRatio:renderer.getPixelRatio(), width:source.width, height:source.height,
    headerStyle:header.style.cssText, panelStyle:panel.style.cssText, panelInert:panel.inert, panelClosed:panel.classList.contains('closed') };
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { alpha:false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const post = async (path, body) => {
    const response = await fetch(receiver+path, { method:'POST', body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Capture receiver: ${response.status}`);
    return result;
  };
  const png = target => new Promise((resolve, reject) => target.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG capture failed')), 'image/png'));
  const check = () => {
    if (state.cancelled) throw new Error('Capture cancelled');
    if (source.width !== RENDER_SIZE || source.height !== RENDER_SIZE) throw new Error('Canvas resized during capture');
  };
  function overlayText(element, text = element.textContent, center = false) {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize)*uiScale}px ${style.fontFamily}`;
    ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : `${parseFloat(style.letterSpacing)*uiScale}px`;
    ctx.fillStyle = style.color; ctx.textAlign = center ? 'center' : 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, center ? rect.x+rect.width/2 : rect.x, rect.y+rect.height/2);
  }
  function snapshot() {
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    ctx.save(); overlayText(header.querySelector('span')); overlayText(header.querySelector('p'));
    const title = panel.querySelector(':scope > .title'), rect = title.getBoundingClientRect();
    ctx.fillStyle = getComputedStyle(title).backgroundColor; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    overlayText(title, '▸ SETTINGS', true); ctx.restore();
  }
  function orbit(rawFrame) {
    const angle = Math.atan2(1.476, 8.2) - (rawFrame % TOTAL_FRAMES)*Math.PI*2/TOTAL_FRAMES;
    camera.position.set(Math.sin(angle)*orbitRadius, orbitHeight, Math.cos(angle)*orbitRadius);
    controls.target.set(0, 1.4, 0); controls.update(0);
  }
  async function select(index) {
    const item = plan[index]; state.shape = item.shape;
    app.selectShape(item.shape, item.rotation, item.thermalSeed); await app.advance(0);
  }
  async function renderFrame(index, frame) {
    check(); await nextFrame(); orbit(index*CLIP_FRAMES+frame);
    await app.advance(frame === 0 ? 0 : 1/FPS, snapshot);
  }
  let started = false;
  async function send(blob) {
    const receipt = await post(`/frame/${state.frame}`, blob);
    if (receipt.frame !== state.frame) throw new Error('Frame receipt out of order');
    state.frame++;
  }
  try {
    app.pause(true); await app.advance(0); controls.enabled = false; controls.autoRotate = false;
    Object.assign(app.settings, { heatDuration:5, speed:1, pause:true });
    renderer.setPixelRatio(1); renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
    camera.aspect = 1; camera.fov = 38; camera.updateProjectionMatrix();
    panel.inert = true; panel.classList.add('closed'); header.style.zoom = panel.style.zoom = uiScale;
    header.style.left = panel.style.right = `${28/uiScale}px`; header.style.top = `${24/uiScale}px`;
    const heading = header.querySelector('span').getBoundingClientRect(), titleHeight = panel.querySelector(':scope > .title').getBoundingClientRect().height;
    panel.style.top = `${(heading.y+(heading.height-titleHeight)/2)/uiScale}px`;
    await post('/start', JSON.stringify({ fps:FPS, totalFrames:TOTAL_FRAMES, width:SIZE, height:SIZE,
      renderSize:RENDER_SIZE, renderPixelRatio:1.5, overlays:true, uiScale, settings:{...app.settings,pause:false},
      plan, seed, rotationSeed, fadeFrames:0, startPhaseFrame:0, orbitDegrees:360,
      camera:{polarAngle:cameraPolarAngle,elevationDegrees:90-cameraPolarAngle*180/Math.PI,distance:orbitDistance,height:orbitHeight,target:[0,1.4,0]},
      frameOrder:'chronological',
      clips:plan.map((item,index)=>({shape:item.shape,startFrame:index*CLIP_FRAMES,frames:CLIP_FRAMES})),
      method:'Fixed steps, sequential PNG frames, encoder backpressure, each shape recorded once in order with immediate switches' }));
    started = true; state.status = 'capturing';
    for (let index=0; index<plan.length; index++) {
      await select(index);
      const selectedSeed = app.seed;
      for (let frame=0; frame<CLIP_FRAMES; frame++) {
        check();
        if (state.frame !== index*CLIP_FRAMES+frame) throw new Error('Capture frames left chronological order');
        await renderFrame(index, frame);
        if (app.seed !== selectedSeed || Math.abs(app.gpu.time-frame/FPS)>1e-6) throw new Error('Scene changed during capture');
        const blob = await png(canvas);
        await send(blob);
      }
      const stats = await app.gpu.inspect(renderer);
      if (stats.overflow || stats.triangles <= 0) throw new Error('Invalid mesh during capture');
      capturedClips.push({shape:app.seed.shape,startFrame:index*CLIP_FRAMES,frames:CLIP_FRAMES,...stats});
    }
    state.status='encoding';
    state.result=await post('/finish',JSON.stringify({ elapsedSeconds:(performance.now()-state.started)/1000,
      loopSeam:{lastSourceFrame:TOTAL_FRAMES-1,firstSourceFrame:0,lastShape:plan.at(-1).shape,firstShape:plan[0].shape,cameraStepDegrees:360/TOTAL_FRAMES,shapeSwitch:'instant'},
      allShapes:plan.map(item=>item.shape),capturedClips }));
    state.status='complete'; return state.result;
  } catch(error) {
    state.status=state.cancelled?'cancelled':'failed'; state.error=error.message;
    if(started) await post('/abort','').catch(()=>{});
    throw error;
  } finally {
    renderer.setPixelRatio(previous.pixelRatio); renderer.setSize(previous.width/previous.pixelRatio, previous.height/previous.pixelRatio, false);
    Object.assign(app.settings,previous.settings); controls.enabled=previous.enabled; controls.autoRotate=previous.autoRotate;
    camera.position.copy(previous.camera); controls.target.copy(previous.target); controls.update(0);
    camera.aspect=previous.aspect;camera.fov=previous.fov;camera.updateProjectionMatrix();
    header.style.cssText=previous.headerStyle;panel.style.cssText=previous.panelStyle;panel.inert=previous.panelInert;panel.classList.toggle('closed',previous.panelClosed);
    app.selectShape(previous.seed.shape,previous.seed.rotation,previous.seed.thermalSeed);
    await app.advance(0);if(!previous.settings.pause)app.resume();
  }
}
