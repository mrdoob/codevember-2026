import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three/webgpu';
import { createRockReaction, ROCK_REACTION_DURATION } from '../rock-reaction.js';

const point = new Vector3(.4, .3, 1), direction = new Vector3(.1, -.2, -1).normalize(), center = new Vector3();

test('a poke springs back with diminishing rebounds, varied wobble, and frame-independent motion', () => {
  const direct = createRockReaction(.7), stepped = createRockReaction(.7), untouched = createRockReaction(.22);
  direct.kick(point, direction, center, 0); stepped.kick(point, direction, center, 0);
  direct.update(.001);
  assert.ok(direct.offset.length() < .00002, 'The short push eases in from rest');
  direct.update(.6);
  for (let i = 1; i <= 36; i++) stepped.update(i / 60);
  assert.ok(direct.offset.length() > .18 && direct.tilt.length() > .15);
  assert.ok(direct.offset.distanceTo(stepped.offset) < 1e-12);
  assert.ok(direct.tilt.distanceTo(stepped.tilt) < 1e-12);
  const pivot = new Group(); pivot.rotation.set(.3, .6, -.2);
  const initialRotation = pivot.quaternion.clone();
  direct.apply(pivot, .6);
  const addedRotation = pivot.quaternion.clone().multiply(initialRotation.invert());
  assert.ok(Math.abs(addedRotation.x) > 1e-5 && Math.abs(addedRotation.z) > 1e-5, 'Nudge adds a little pitch and roll');
  assert.ok(Math.hypot(addedRotation.x, addedRotation.z) < Math.abs(addedRotation.y) * .3, 'Y stays the dominant world-space spin even on an already tilted rock');
  assert.ok(Math.abs(addedRotation.y) > .05, 'Nudge visibly spins around Y');
  untouched.update(.6); assert.equal(untouched.offset.length() + untouched.tilt.length(), 0);
  const frozen = direct.offset.clone(), firstSpin = direct.tilt.clone(); direct.update(.6);
  assert.deepEqual(direct.offset.toArray(), frozen.toArray(), 'A paused clock freezes the response');
  direct.update(2);
  assert.ok(direct.offset.dot(frozen) < 0 && direct.tilt.dot(firstSpin) < 0, 'Both drift and Y spin recoil past the resting pose');
  const recoil = direct.offset.length();
  assert.ok(recoil > frozen.length() * .1 && recoil < frozen.length() * .3, 'First recoil is gentle but visible');
  direct.update(3.5);
  assert.ok(direct.offset.dot(frozen) > 0 && direct.offset.length() < recoil * .3, 'The next bounce is smaller');
  direct.update(ROCK_REACTION_DURATION - .001);
  assert.ok(direct.offset.length() < 1e-8 && direct.tilt.length() < 1e-8, 'The final tail settles continuously');
  direct.update(ROCK_REACTION_DURATION);
  assert.ok(direct.offset.length() < .00001 && direct.tilt.length() < .00001, 'Returns to the underlying floating pose');
  direct.kick(point, direction, center, ROCK_REACTION_DURATION);
  direct.update(ROCK_REACTION_DURATION + .6);
  assert.ok(Math.hypot(direct.tilt.x - firstSpin.x, direct.tilt.z - firstSpin.z) > .001, 'Each press gets a new wobble');
  direct.reset(); direct.kick(point, direction, center, 0); direct.update(.6);
  assert.deepEqual(direct.tilt.toArray(), firstSpin.toArray(), 'Resetting the animation reproduces the random sequence');
});

test('repeated pokes remain bounded and a reversed clock resets the reaction', () => {
  const reaction = createRockReaction(.18);
  for (let i = 0; i < 180; i++) {
    reaction.kick(point, direction, center, i / 60);
    reaction.update((i + 1) / 60);
    assert.ok(reaction.offset.length() <= .630001 && reaction.tilt.length() <= 1.170001);
    assert.ok([...reaction.offset.toArray(), ...reaction.tilt.toArray()].every(Number.isFinite));
  }
  reaction.update(10);
  assert.ok(reaction.offset.length() < .00001 && reaction.tilt.length() < .00001);
  reaction.kick(point, direction, center, 10); reaction.update(11); reaction.update(0);
  assert.equal(reaction.offset.length() + reaction.tilt.length(), 0);
});
