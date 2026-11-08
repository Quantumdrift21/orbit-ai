// AeroStrike's defence moves (renderer/defend.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { defencePose, recoilSpring, DEFENCES } from '../renderer/defend.js';

const NUMS = [
  'flinch',
  'guard',
  'guardOff',
  'hip',
  'knee',
  'stance',
  'crouch',
  'open',
  'lean',
  'recoil',
  'charge',
  'beam',
];
const peak = (kind, key) => Math.max(...Array.from({ length: 201 }, (_, i) => defencePose(kind, i / 200)[key]));
const firstAbove = (kind, key, v) => {
  for (let i = 0; i <= 200; i++) if (defencePose(kind, i / 200)[key] > v) return i / 200;
  return Infinity;
};

test('every move starts and ends at rest', () => {
  for (const kind of DEFENCES) {
    for (const p of [0, 1]) {
      const pose = defencePose(kind, p);
      for (const k of NUMS) assert.ok(Math.abs(pose[k]) < 1e-6, `${kind} ${k} at p=${p} is ${pose[k]}`);
    }
  }
});

test('a startle flinch comes first, before the move itself', () => {
  for (const kind of DEFENCES) {
    assert.ok(peak(kind, 'flinch') > 0.9);
    assert.ok(firstAbove(kind, 'flinch', 0.5) < 0.08);
  }
  assert.ok(firstAbove('block', 'guard', 0.9) > firstAbove('block', 'flinch', 0.5));
});

test('block: the arm is up before the hit lands, and the hit rocks the body back then settles', () => {
  assert.ok(defencePose('block', 0.21).guard > 0.95); // guard is up by the impact (p = 0.22)
  assert.ok(defencePose('block', 0.2).recoil === 0); // nothing pushes before the impact
  assert.ok(peak('block', 'recoil') > 0.5);
  assert.ok(Math.min(...Array.from({ length: 81 }, (_, i) => defencePose('block', 0.22 + i / 200).recoil)) < 0); // swings forward past rest
});

test('kick: knee chambers bent, snaps straight at full extension, torso counter-leans', () => {
  const chambered = defencePose('kick', 0.29);
  assert.ok(chambered.hip > 0.9 && chambered.knee > 0.9);
  const out = defencePose('kick', 0.45);
  assert.ok(out.hip > 0.95 && out.knee < 0.05); // leg straight out
  // balance: lean grows with the leg's swing and never points the same way as the leg
  for (let i = 0; i <= 100; i++) {
    const pose = defencePose('kick', i / 100);
    assert.ok(pose.lean >= 0 && pose.lean <= 0.35 * 1.6 + 1e-9);
    if (pose.hip > 0.5) assert.ok(pose.lean > 0.15);
  }
});

test('laser: the core charges before the beam fires, and only then is the body pushed', () => {
  assert.ok(defencePose('laser', 0.42).beam < 0.05 && defencePose('laser', 0.42).charge > 0.9);
  assert.ok(defencePose('laser', 0.6).beam === 1);
  assert.ok(defencePose('laser', 0.44).recoil === 0);
  assert.ok(peak('laser', 'recoil') > 0.4);
  assert.ok(defencePose('laser', 0.9).beam === 0);
});

test('recoil spring: peak 1, then decays', () => {
  assert.strictEqual(recoilSpring(0), 0);
  const samples = Array.from({ length: 300 }, (_, i) => recoilSpring(i / 300));
  assert.ok(Math.abs(Math.max(...samples) - 1) < 0.01);
  assert.ok(Math.abs(recoilSpring(1)) < 0.01);
});
