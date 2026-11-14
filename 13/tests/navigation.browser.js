export async function checkNavigation(app = window.labyrinth) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const capture = app.manual, settings = { ...app.settings }, samples = [];
  const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
  app.manual = true;
  try {
    assert(!document.querySelector('#hint'), 'Navigation instructions are still present');
    assert(document.querySelector('#navigation').children.length === 1 && document.querySelector('#navigation #sound-toggle'), 'The footer should contain only the audio control');
    app.settings.paused = false; app.reset();
    const d = app.journey.distance; app.advance(1);
    assert(Math.abs(app.journey.distance - d - app.settings.speed) < 1e-7, 'Automatic flight speed changed with frame rate');
    const p = app.camera.position.clone(), q = app.camera.quaternion.clone(); key('KeyF');
    assert(app.journey.mode === 'manual', 'A non-movement key did not take control');
    assert(app.camera.position.distanceTo(p) === 0 && app.camera.quaternion.angleTo(q) < 1e-6, 'Takeover changed the visible pose');
    app.advance(.3); assert(app.camera.position.distanceTo(p) < .08, 'The path kept advancing after takeover');
    for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      app.reset(); const before = app.camera.position.clone(), rotation = app.camera.quaternion.clone();
      key(code); app.advance(.4); key(code, 'keyup');
      const moved = app.camera.position.distanceTo(before), turned = app.camera.quaternion.angleTo(rotation);
      assert(app.journey.mode === 'manual', `${code} did not take control`);
      assert(code === 'ArrowLeft' || code === 'ArrowRight' ? turned > .2 : moved > .08, `${code} did not navigate`);
      assert(app.maze.clearance(app.camera.position.x, app.camera.position.z) >= .52 - 1e-6, `${code} entered a hedge`);
      app.advance(1); const stopped = app.camera.position.clone(); app.advance(.2);
      assert(app.camera.position.distanceTo(stopped) < .002, `${code} kept moving after release`);
      samples.push({ code, moved, turned });
    }
    app.reset(); key('KeyW'); app.advance(.2); window.dispatchEvent(new Event('blur'));
    const stopped = app.camera.position.clone(); app.advance(1);
    assert(Math.hypot(app.camera.position.x - stopped.x, app.camera.position.z - stopped.z) < 1e-9, 'Blur left a movement key held');
    key('KeyR'); assert(app.journey.mode === 'automatic' && !app.settings.paused, 'R did not restart flight');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', repeat: true }));
    assert(app.journey.mode === 'automatic', 'Holding R interrupted the restarted flight');
    key('KeyW'); key('Space');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: true }));
    assert(app.settings.paused, 'Repeating a held key undid pause');
    key('KeyW', 'keyup'); key('KeyR');
    const input = document.createElement('input'); document.body.append(input); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })); input.remove();
    assert(app.journey.mode === 'automatic', 'Typing in settings took over navigation');
    const sound = document.querySelector('#sound-toggle'); sound.focus();
    sound.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    assert(app.journey.mode === 'automatic' && !app.settings.paused, 'Activating audio took over the camera');
    sound.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    assert(app.journey.mode === 'manual', 'WASD stopped working after focusing the audio control');
    key('KeyW', 'keyup'); sound.blur();
    return { passed: true, samples, takeoverPreservesPose: true, blurStopsMovement: true };
  } finally {
    Object.assign(app.settings, settings); app.reset(); app.render(); app.manual = capture;
  }
}
