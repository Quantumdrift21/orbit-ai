// Jet engine physics (renderer/jetPhysics.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { spool, thrustDemand, createExhaust, stepExhaust, aliveCount, SPOOL_SECS } from '../renderer/jetPhysics.js';

const run = (engine, demand, secs, dt = 1 / 60) => {
  for (let t = 0; t < secs; t += dt) engine = spool(engine, demand, dt);
  return engine;
};

test('throttle spools up with a lag, settles on the demand, and pops when cut hard', () => {
  let e = { throttle: 0.3, pop: 0 };
  const early = run(e, 1, SPOOL_SECS * 0.5);
  assert.ok(early.throttle > 0.3 && early.throttle < 0.8); // not instant
  e = run(e, 1, SPOOL_SECS * 6);
  assert.ok(Math.abs(e.throttle - 1) < 0.01); // gets there
  const cut = spool(e, 0.2, 1 / 60);
  assert.strictEqual(cut.pop, 1); // sudden cut: flare
  assert.ok(run(cut, 0.2, 1).pop < 0.01); // fades
  assert.strictEqual(spool({ throttle: 0.5, pop: 0 }, 0.45, 1 / 60).pop, 0); // gentle change: no pop
});

test('demand: hover, more when fast or climbing, bursts on a jump; capped', () => {
  const hover = thrustDemand({});
  assert.ok(thrustDemand({ speed: 400 }) > hover);
  assert.ok(thrustDemand({ vy: -300 }) > thrustDemand({ vy: 300 })); // climbing burns harder
  assert.ok(thrustDemand({ lift: 1 }) > 1);
  assert.ok(thrustDemand({ speed: 9e9, vy: -9e9, lift: 5, recoil: 5 }) <= 1.4);
});

const step = (ex, secs, opts, dt = 1 / 60) => {
  for (let t = 0; t < secs; t += dt) stepExhaust(ex, dt, { random: () => 0.5, ...opts });
  return ex;
};

test('no throttle, no exhaust; spawn rate follows throttle', () => {
  assert.strictEqual(aliveCount(step(createExhaust(200), 0.5, { throttle: 0 })), 0);
  const low = aliveCount(step(createExhaust(200), 0.3, { throttle: 0.3 }));
  const high = aliveCount(step(createExhaust(200), 0.3, { throttle: 1 }));
  assert.ok(high > low * 2);
});

test('particles leave along the jet, slow down by drag, rise because they are hot, then die', () => {
  const ex = step(createExhaust(4), 1 / 60, { throttle: 1, rate: 60, buoyancy: 0 }); // one particle
  assert.strictEqual(aliveCount(ex), 1);
  const v0 = Math.hypot(ex.vel[0], ex.vel[1], ex.vel[2]);
  assert.ok(ex.vel[1] < 0); // going down the nozzle axis (0, -1, 0)
  step(ex, 0.3, { throttle: 0, buoyancy: 0 });
  assert.ok(Math.hypot(ex.vel[0], ex.vel[1], ex.vel[2]) < v0 * 0.7); // drag
  const still = createExhaust(4);
  step(still, 1 / 60, { throttle: 1, rate: 60, speed: 0, buoyancy: 2 });
  step(still, 0.3, { throttle: 0, buoyancy: 2 });
  assert.ok(still.vel[1] > 0 && still.pos[1] > 0); // hot gas rises
  step(still, 2, { throttle: 0 });
  assert.strictEqual(aliveCount(still), 0); // lifetime over
});

test('when the window flies, exhaust stays behind on the desktop', () => {
  const ex = step(createExhaust(4), 1 / 60, { throttle: 1, rate: 60, speed: 0, buoyancy: 0 });
  const x0 = ex.pos[0];
  step(ex, 0.2, { throttle: 0, buoyancy: 0, shift: [-0.05, 0, 0] }); // window moving right
  assert.ok(ex.pos[0] < x0 - 0.5);
});
