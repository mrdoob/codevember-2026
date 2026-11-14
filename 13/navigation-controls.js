import { joystickAxes } from './movement.js';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const editing = target => target?.closest?.('input, textarea, select, [contenteditable="true"]');

export function createNavigationControls(canvas, actions) {
  const abort = new AbortController(), events = { signal: abort.signal };
  const keys = new Set(), stick = document.querySelector('#joystick'), thumb = document.querySelector('#joystick-thumb');
  let touchPointer = null, mousePointer = null, captureTarget = null;
  let originX = 0, originY = 0, previousX = 0, previousY = 0, stickX = 0, stickY = 0;
  function clear(all = true) {
    const wasTouch = touchPointer !== null;
    if (all) keys.clear(); stickX = stickY = 0;
    const id = touchPointer ?? mousePointer, target = captureTarget;
    touchPointer = mousePointer = null; captureTarget = null;
    if (id !== null && target?.hasPointerCapture(id)) target.releasePointerCapture(id);
    if (stick) { stick.classList.remove('active'); stick.style.removeProperty('left'); stick.style.removeProperty('top'); stick.style.removeProperty('bottom'); }
    if (thumb) thumb.style.transform = '';
    document.body.classList.remove('looking');
    if (all || (wasTouch && keys.size === 0)) actions.stop();
    actions.changed();
  }
  window.addEventListener('keydown', event => {
    if (event.target.closest?.('[data-no-navigation]') && ['Space', 'Enter'].includes(event.code)) return;
    if (editing(event.target) || event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta'].some(key => event.key === key)) return;
    if (!event.repeat) actions.takeControl(MOVEMENT_KEYS.has(event.code));
    if (MOVEMENT_KEYS.has(event.code)) { event.preventDefault(); keys.add(event.code); }
  }, events);
  window.addEventListener('keyup', event => { keys.delete(event.code); }, events);
  // Touching even the settings panel takes over the flight, while its native
  // controls keep their behavior. Only the scene or joystick handles steering.
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' && !event.target.closest?.('[data-no-navigation]')) actions.takeControl(false);
  }, { ...events, capture: true });

  function down(event) {
    if (touchPointer !== null || mousePointer !== null || event.button > 0) return;
    if (event.pointerType === 'touch') {
      actions.takeControl(true); touchPointer = event.pointerId; originX = event.clientX; originY = event.clientY;
      stickX = stickY = 0;
      if (stick) {
        stick.style.left = `${originX - 62}px`; stick.style.top = `${originY - 62}px`; stick.style.bottom = 'auto'; stick.classList.add('active');
      }
      event.preventDefault();
    } else {
      if (event.currentTarget === stick) return;
      mousePointer = event.pointerId; previousX = event.clientX; previousY = event.clientY;
      document.body.classList.add('looking'); canvas.focus({ preventScroll: true });
    }
    captureTarget = event.currentTarget; captureTarget.setPointerCapture(event.pointerId); actions.changed();
  }
  canvas.addEventListener('pointerdown', down, events);
  stick?.addEventListener('pointerdown', down, events);
  window.addEventListener('pointermove', event => {
    if (event.pointerId === touchPointer) {
      const dx = event.clientX - originX, dy = event.clientY - originY;
      const axes = joystickAxes(dx, dy); stickX = axes.x; stickY = axes.y;
      const limit = Math.min(1, 46 / Math.max(1, Math.hypot(dx, dy)));
      if (thumb) thumb.style.transform = `translate(${dx * limit}px, ${dy * limit}px)`;
      event.preventDefault(); actions.changed();
    } else if (event.pointerId === mousePointer) {
      actions.look(event.clientX - previousX, event.clientY - previousY);
      previousX = event.clientX; previousY = event.clientY; actions.changed();
    }
  }, { ...events, passive: false });
  const end = event => { if (event.pointerId === touchPointer || event.pointerId === mousePointer) clear(false); };
  window.addEventListener('pointerup', end, events); window.addEventListener('pointercancel', end, events);
  canvas.addEventListener('lostpointercapture', end, events); stick?.addEventListener('lostpointercapture', end, events);
  window.addEventListener('blur', () => clear(), events);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); }, events);
  return {
    sample() {
      let forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) - stickY;
      let strafe = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const scale = Math.max(1, Math.hypot(forward, strafe)); forward /= scale; strafe /= scale;
      return { forward, strafe, turn: Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight')) - stickX };
    },
    get looking() { return mousePointer !== null; },
    clear,
    dispose() { clear(); abort.abort(); },
  };
}
