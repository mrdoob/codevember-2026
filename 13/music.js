import { createScore } from './score.js';
import { createOrchestra } from './orchestra.js';

export function createMusic(settings) {
  const button = document.querySelector('#sound-toggle'), abort = new AbortController();
  const listeners = { signal: abort.signal };
  let context, orchestra, score, origin = 0, timer = null, suspension = null;
  let unlocked = false, disposed = false, resuming = false, revision = 0, lastGain = -1, unavailable = false;
  const volume = () => Math.max(0, Math.min(1, Number(settings.volume) || 0));
  const wanted = () => settings.music && volume() > 0 && !settings.paused && !document.hidden;
  const state = () => disposed ? 'closed' : unavailable ? 'unavailable' : !settings.music || volume() === 0 ? 'muted'
    : !unlocked ? 'locked' : settings.paused || document.hidden ? 'paused' : timer !== null ? 'playing' : 'locked';
  function display() {
    const status = state(); if (!button || button.dataset.state === status) return;
    button.dataset.state = status;
    button.textContent = { locked: 'AUDIO OFF', muted: 'AUDIO OFF', paused: 'AUDIO PAUSED', playing: 'AUDIO ON', unavailable: 'AUDIO UNAVAILABLE', closed: 'AUDIO OFF' }[status];
    button.setAttribute('aria-pressed', String(status === 'playing' || status === 'paused'));
    button.setAttribute('aria-label', status === 'playing' || status === 'paused' ? 'Mute music' : 'Enable music');
    button.disabled = status === 'unavailable' || status === 'closed';
  }
  function initialize() {
    if (context || disposed || unavailable) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) { unavailable = true; display(); return; }
    try {
      context = new Audio({ latencyHint: 'playback' });
      orchestra = createOrchestra(context); score = createScore(); origin = context.currentTime + .08;
      context.addEventListener('statechange', () => { if (!disposed) sync(); }, listeners);
    } catch {
      unavailable = true; orchestra?.dispose(); context?.close().catch(() => {}); display();
    }
  }
  function schedule() {
    if (!context || context.state !== 'running' || !wanted() || disposed) return;
    const now = context.currentTime;
    for (const event of score.takeUntil(now - origin + .75)) {
      // Recover from a stalled main thread without replaying a backlog of hits.
      if (event.time + origin < now - .25) continue;
      orchestra.schedule(event, Math.max(now + .015, event.time + origin));
    }
  }
  function resume() {
    if (!context || disposed || unavailable) return Promise.resolve(false);
    clearTimeout(suspension); suspension = null; resuming = true;
    const current = ++revision;
    return context.resume().then(() => {
      if (disposed || current !== revision) return false;
      resuming = false; sync(); return context.state === 'running';
    }).catch(() => {
      if (disposed || current !== revision) return false;
      resuming = false; unlocked = false; display(); return false;
    });
  }
  function sync() {
    if (disposed || unavailable) return;
    if (context && orchestra) {
      const playing = unlocked && wanted(), level = playing && context.state === 'running' ? volume() : 0;
      if (level !== lastGain) {
        orchestra.output.gain.setTargetAtTime(level, context.currentTime, level > 0 ? .45 : .025);
        lastGain = level;
      }
      if (playing) {
        clearTimeout(suspension); suspension = null;
        if (context.state === 'running' && timer === null) { schedule(); timer = setInterval(schedule, 100); }
        else if (context.state !== 'running' && !resuming) void resume();
      } else {
        if (timer !== null) { clearInterval(timer); timer = null; }
        if (context.state === 'running' && suspension === null) suspension = setTimeout(() => {
          suspension = null;
          if (!disposed && !(unlocked && wanted())) void context.suspend().catch(() => {});
        }, 180);
      }
    }
    display();
  }
  function unlock() {
    if (disposed || unavailable || !settings.music || volume() === 0) return Promise.resolve(false);
    unlocked = true; initialize();
    // Called directly by a trusted click, touch, or key event, so resume happens
    // within the browser's user activation rather than after asset loading.
    if (wanted()) return resume();
    sync(); return Promise.resolve(false);
  }
  function toggle() {
    if (state() === 'locked' || state() === 'muted') {
      settings.music = true; if (volume() === 0) settings.volume = .55;
      void unlock();
    } else { settings.music = false; sync(); }
  }
  button?.addEventListener('click', toggle, listeners);
  window.addEventListener('pointerdown', event => {
    if (event.isTrusted && event.target.closest?.('main canvas, #joystick')) void unlock();
  }, listeners);
  window.addEventListener('keydown', event => {
    if (!event.isTrusted || event.repeat || event.metaKey || event.ctrlKey || event.altKey
      || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)
      || event.target.closest?.('input, textarea, select, [contenteditable="true"]')
      || (event.target.closest?.('[data-no-navigation]') && ['Space', 'Enter'].includes(event.code))) return;
    void unlock();
  }, listeners);
  document.addEventListener('visibilitychange', sync, listeners);
  display();
  return {
    unlock, sync,
    get state() { return state(); },
    get contextState() { return context?.state ?? 'uninitialized'; },
    get activeGestures() { return orchestra?.activeGestures ?? 0; },
    get activeSources() { return orchestra?.activeSources ?? 0; },
    get scheduling() { return timer !== null; },
    async dispose() {
      disposed = true; revision++; abort.abort(); clearInterval(timer); timer = null;
      clearTimeout(suspension); suspension = null; orchestra?.dispose(); display();
      if (context && context.state !== 'closed') await context.close();
    },
  };
}
