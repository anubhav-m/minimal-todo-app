import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClientIdSource,
  createDraft,
  createMutationTracker,
  createSingleFlight,
  createToggleQueue,
  loadFreshSnapshot,
  newClientId,
} from './taskSync.ts';

// A promise the test settles by hand, to choose the order things finish in.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

// --- add: double submit and retry -------------------------------------------

test('a double submit takes the draft once, so one request is sent', async () => {
  const draft = createDraft();
  const sent = [];
  const submit = async () => {
    const text = draft.take();
    if (!text) return;
    sent.push(text);
    await tick();
  };

  draft.set('Buy milk');
  await Promise.all([submit(), submit(), submit()]);

  assert.deepEqual(sent, ['Buy milk']);
});

test('the draft ignores blank text and is not restored over newer typing', () => {
  const draft = createDraft();
  draft.set('   ');
  assert.equal(draft.take(), null);

  draft.set('Buy milk');
  assert.equal(draft.take(), 'Buy milk');
  assert.equal(draft.restore('Buy milk'), true);
  assert.equal(draft.take(), 'Buy milk');

  draft.set('Something newer');
  assert.equal(draft.restore('Buy milk'), false);
  assert.equal(draft.take(), 'Something newer');
});

test('retrying a failed create reuses its clientId; a different task gets a new one', () => {
  let n = 0;
  const ids = createClientIdSource(() => `id-${++n}`);
  const milk = { text: 'Buy milk', date: '2026-10-06' };

  const first = ids.idFor(milk);
  ids.failed(milk, first);
  assert.equal(ids.idFor(milk), first);
  assert.notEqual(ids.idFor({ ...milk, text: 'Buy eggs' }), first);

  ids.succeeded(first);
  assert.notEqual(ids.idFor(milk), first);
});

test('client ids are unique when generated concurrently, with or without crypto.randomUUID', async () => {
  const batches = await Promise.all(Array.from({ length: 50 }, async () => Array.from({ length: 200 }, newClientId)));
  assert.equal(new Set(batches.flat()).size, 10000);

  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const fallback = Array.from({ length: 10000 }, newClientId);
    assert.equal(new Set(fallback).size, 10000);
    assert.match(fallback[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', original);
  }
});

// --- fetch vs. local mutations ----------------------------------------------

test('two overlapping mutations still count as in flight (the old parity counter said idle)', () => {
  const tracker = createMutationTracker();
  const endA = tracker.begin();
  const endB = tracker.begin();

  const mark = tracker.mark();
  assert.equal(mark.idle, false);
  assert.equal(tracker.isUnchangedSince(mark), false);

  endA();
  endB();
  endB(); // settling twice must not unbalance the count
  assert.equal(tracker.mark().idle, true);
});

test('a mutation that starts and finishes during a fetch makes its snapshot stale', () => {
  const tracker = createMutationTracker();
  const mark = tracker.mark();
  tracker.begin()();
  assert.equal(tracker.isUnchangedSince(mark), false);
  assert.equal(tracker.isUnchangedSince(tracker.mark()), true);
});

test('a snapshot overlapped by a mutation is not used; it is reloaded once things are quiet', async () => {
  const tracker = createMutationTracker();
  const responses = [deferred(), deferred()];
  let loads = 0;
  const result = loadFreshSnapshot(tracker, () => responses[loads++].promise);

  await tick();
  const endToggle = tracker.begin(); // user toggles while the first GET is in flight
  responses[0].resolve(['stale']);
  await tick();
  assert.equal(loads, 1, 'waits for the mutation instead of refetching under it');

  endToggle();
  await tick();
  responses[1].resolve(['fresh']);

  assert.deepEqual(await result, { data: ['fresh'], fresh: true });
});

test('a fetch requested with two mutations in flight waits for both', async () => {
  const tracker = createMutationTracker();
  const endA = tracker.begin();
  const endB = tracker.begin();
  let loads = 0;
  const result = loadFreshSnapshot(tracker, async () => { loads++; return ['data']; });

  await tick();
  endA();
  await tick();
  assert.equal(loads, 0);
  endB();

  assert.deepEqual(await result, { data: ['data'], fresh: true });
});

test('a snapshot that is overlapped every time is reported as not fresh', async () => {
  const tracker = createMutationTracker();
  let loads = 0;
  const result = await loadFreshSnapshot(tracker, async () => {
    loads++;
    tracker.begin()();
    return ['data'];
  });

  assert.equal(loads, 3);
  assert.equal(result.fresh, false);
});

test('launch + foreground + midnight timer at once make one request', async () => {
  const flight = createSingleFlight();
  const response = deferred();
  let requests = 0;
  const load = () => { requests++; return response.promise; };

  const callers = [flight('2026-10-06', load), flight('2026-10-06', load), flight('2026-10-06', load)];
  await tick();
  response.resolve(true);

  assert.deepEqual(await Promise.all(callers), [true, true, true]);
  assert.equal(requests, 1);

  await flight('2026-10-06', async () => { requests++; return true; });
  assert.equal(requests, 2, 'a later call starts a new request');
});

test('a fetch for a new day waits for the running one, so responses cannot land out of order', async () => {
  const flight = createSingleFlight();
  const applied = [];
  const beforeMidnight = deferred();

  const first = flight('2026-10-06', async () => { await beforeMidnight.promise; applied.push('2026-10-06'); });
  const second = flight('2026-10-07', async () => { applied.push('2026-10-07'); });
  await tick();
  assert.deepEqual(applied, []);

  beforeMidnight.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(applied, ['2026-10-06', '2026-10-07']);
});

test('a failed fetch rejects for every caller and does not block the next one', async () => {
  const flight = createSingleFlight();
  const failing = async () => { throw new Error('offline'); };

  const results = await Promise.allSettled([flight('d', failing), flight('d', failing)]);
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected']);
  assert.equal(await flight('d', async () => 'ok'), 'ok');
});

// --- toggles ----------------------------------------------------------------

// A server that holds one task and answers each PUT only when the test says so.
const fakeServer = (task) => {
  const stored = { version: 0, ...task };
  const requests = [];
  return {
    stored,
    requests,
    send(id, completed, baseVersion) {
      const request = { completed, baseVersion, ...deferred() };
      requests.push(request);
      return request.promise;
    },
    // Applies request `i` the way the real endpoint does and answers it.
    answer(i) {
      const { completed, baseVersion, resolve } = requests[i];
      if (baseVersion !== undefined && baseVersion !== stored.version) {
        return resolve({ status: 'conflict', task: { ...stored } });
      }
      stored.completed = completed;
      stored.version++;
      resolve({ status: 'ok', task: { ...stored } });
    },
    fail(i) { requests[i].reject(new Error('network')); },
    changeElsewhere(changes) { Object.assign(stored, changes); stored.version++; },
  };
};

// Wires a queue to a one-row "screen" the way the components do.
const screenWith = (server, tracker) => {
  const screen = { row: { ...server.stored }, failures: 0, gone: false };
  const queue = createToggleQueue({
    send: (...args) => server.send(...args),
    tracker,
    onConfirmed: (task, desired) => { screen.row = { ...task, completed: desired }; },
    onFailed: (id, confirmed) => { screen.row = { ...screen.row, completed: confirmed }; screen.failures++; },
    onGone: () => { screen.gone = true; },
  });
  const tap = () => { screen.row = { ...screen.row, completed: queue.toggle(screen.row) }; };
  return { screen, queue, tap };
};

test('rapid taps send one request at a time and end on the last tap', async () => {
  const server = fakeServer({ _id: 't1', completed: false });
  const { screen, queue, tap } = screenWith(server);

  tap(); // complete
  tap(); // un-complete
  tap(); // complete
  tap(); // un-complete
  assert.equal(screen.row.completed, false);
  assert.equal(server.requests.length, 1, 'only the first tap is on the wire');

  server.answer(0);
  await tick();
  assert.equal(server.requests.length, 2, 'one follow-up carries the final value');
  assert.equal(server.requests[1].completed, false);
  assert.equal(screen.row.completed, false, 'the response to the first tap does not flip the row back');

  server.answer(1);
  await queue.settled('t1');
  assert.equal(server.stored.completed, false);
  assert.equal(screen.row.completed, false);
  assert.equal(screen.row.version, 2);
});

test('taps that cancel out need no follow-up', async () => {
  const server = fakeServer({ _id: 't1', completed: false });
  const { screen, queue, tap } = screenWith(server);

  tap();
  tap();
  tap();
  server.answer(0);
  await queue.settled('t1');

  assert.equal(server.requests.length, 1);
  assert.equal(server.stored.completed, true);
  assert.equal(screen.row.completed, true);
});

test('a failed request rolls back to the last value the server confirmed', async () => {
  const server = fakeServer({ _id: 't1', completed: false });
  const { screen, queue, tap } = screenWith(server);

  tap();
  server.answer(0); // server: completed
  await queue.settled('t1');

  tap(); // un-complete...
  tap(); // ...and complete again while that is in flight
  tap(); // ...and un-complete
  server.fail(1);
  await queue.settled('t1');

  assert.equal(server.stored.completed, true);
  assert.equal(screen.row.completed, true, 'not the pre-tap value captured by any one handler');
  assert.equal(screen.failures, 1);
  assert.equal(server.requests.length, 2);
});

test('a stale tap is re-applied on top of the newer server copy instead of overwriting it', async () => {
  const server = fakeServer({ _id: 't1', completed: false, date: '2026-10-05' });
  const { screen, queue, tap } = screenWith(server);

  server.changeElsewhere({ date: '2026-10-06' }); // rolled over by another device
  tap();
  server.answer(0); // 409: our version is stale
  await tick();
  assert.equal(server.requests[1].baseVersion, 1);
  server.answer(1);
  await queue.settled('t1');

  assert.deepEqual(server.stored, { _id: 't1', completed: true, date: '2026-10-06', version: 2 });
  assert.deepEqual(screen.row, server.stored);
});

test('a stale tap that asks for what the server already has sends nothing more', async () => {
  const server = fakeServer({ _id: 't1', completed: false });
  const { screen, queue, tap } = screenWith(server);

  server.changeElsewhere({ completed: true }); // completed on another device
  tap(); // this device still showed it as incomplete
  server.answer(0);
  await queue.settled('t1');

  assert.equal(server.requests.length, 1);
  assert.equal(screen.row.completed, true);
  assert.equal(server.stored.completed, true);
});

test('a task that keeps changing elsewhere ends on the server copy, not in a loop', async () => {
  const server = fakeServer({ _id: 't1', completed: false });
  const { screen, queue, tap } = screenWith(server);

  tap();
  for (let i = 0; i < 3; i++) {
    server.changeElsewhere({ text: `edit ${i}` });
    server.answer(i);
    await tick();
  }
  await queue.settled('t1');

  assert.equal(server.requests.length, 3);
  assert.equal(screen.row.completed, server.stored.completed);
});

test('toggling a task deleted elsewhere reports it gone instead of rolling back', async () => {
  const { screen, queue, tap } = screenWith({
    stored: { _id: 't1', completed: false, version: 0 },
    send: async () => ({ status: 'gone' }),
  });

  tap();
  await queue.settled('t1');

  assert.equal(screen.gone, true);
  assert.equal(screen.failures, 0);
});

test('tasks toggle independently, and a fetch waits for all of them', async () => {
  const tracker = createMutationTracker();
  const a = fakeServer({ _id: 'a', completed: false });
  const b = fakeServer({ _id: 'b', completed: false });
  const servers = { a, b };
  const rows = { a: { ...a.stored }, b: { ...b.stored } };
  const queue = createToggleQueue({
    send: (id, ...rest) => servers[id].send(id, ...rest),
    tracker,
    onConfirmed: (task, desired) => { rows[task._id] = { ...task, completed: desired }; },
    onFailed: () => {},
    onGone: () => {},
  });
  rows.a.completed = queue.toggle(rows.a);
  rows.b.completed = queue.toggle(rows.b);

  let snapshot = null;
  const fetch = loadFreshSnapshot(tracker, async () => [{ ...a.stored }, { ...b.stored }]).then(r => { snapshot = r; });

  b.answer(0); // answered in the opposite order to the taps
  await tick();
  assert.equal(snapshot, null, 'one toggle is still in flight');
  a.answer(0);
  await fetch;

  assert.equal(snapshot.fresh, true);
  assert.deepEqual(snapshot.data.map(t => t.completed), [true, true]);
  assert.deepEqual([rows.a.completed, rows.b.completed], [true, true]);
});
