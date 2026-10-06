import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine, retryDelay, MAX_BATCH, RETRY_BASE_MS, RETRY_CAP_MS } from './syncEngine.ts';

const TODAY = '2026-10-06';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
const offline = () => new Error('Network Error');

// The device's disk. It outlives any one engine, the way AsyncStorage outlives the app.
const fakeDisk = () => {
  const disk = { saves: 0 };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  disk.storage = {
    async load() { return copy({ base: disk.base, outbox: disk.outbox, failed: disk.failed, meta: disk.meta }); },
    async saveBase(base) { disk.base = copy(base); },
    async saveOutbox(outbox, failed) { disk.saves++; disk.outbox = copy(outbox); disk.failed = copy(failed); },
    async saveMeta(meta) { disk.meta = copy(meta); },
    async clear() { delete disk.base; delete disk.outbox; delete disk.failed; delete disk.meta; },
  };
  return disk;
};

// A stand-in for POST /api/tasks/sync that follows the same rules as the backend.
const fakeServer = () => {
  const server = {
    tasks: new Map(),
    appliedOps: new Set(),
    requests: [],
    clock: 0,
    reject: new Map(), // op id -> error
    // Set to make requests fail: 'offline', a status code, or a function of the request
    failWith: null,
    // Set to make the next response get lost after the server has applied it
    dropNextResponse: false,
    hold: null, // a deferred; while set, requests wait on it before being processed

    async send(request) {
      server.requests.push(JSON.parse(JSON.stringify(request)));
      if (server.hold) await server.hold.promise;
      const failure = typeof server.failWith === 'function' ? server.failWith(request) : server.failWith;
      if (failure === 'offline') throw offline();
      if (failure) throw httpError(failure);

      const results = request.ops.map(op => ({ id: op.id, ...server.apply(op) }));
      const since = request.cursor === null ? null : Number(request.cursor);
      const changes = [...server.tasks.values()]
        .filter(t => (since === null ? !t.deletedAt : t.updatedAt > since))
        .map(t => ({ ...t }));
      const response = { results, changes, cursor: String(server.clock), fullResync: since === null };

      if (server.dropNextResponse) {
        server.dropNextResponse = false;
        throw offline();
      }
      return JSON.parse(JSON.stringify(response));
    },

    apply(op) {
      if (server.reject.has(op.id)) return { status: 'rejected', error: server.reject.get(op.id) };
      const task = server.tasks.get(op.taskId);
      const stamp = () => ++server.clock;
      if (op.type === 'create') {
        if (task) return { status: 'duplicate' };
        server.tasks.set(op.taskId, {
          completed: false, priority: 'none', time: null, notify: false, notificationId: null,
          ...op.payload, clientId: op.taskId, _id: `mongo-${op.taskId}`, version: 0, deletedAt: null,
          createdAt: String(stamp()).padStart(6, '0'), updatedAt: server.clock,
        });
        server.appliedOps.add(op.id);
        return { status: 'applied' };
      }
      if (op.type === 'update') {
        if (!task || task.deletedAt) return { status: 'gone' };
        if (server.appliedOps.has(op.id)) return { status: 'duplicate' };
        Object.assign(task, op.payload, { version: task.version + 1, updatedAt: stamp() });
        server.appliedOps.add(op.id);
        return { status: 'applied' };
      }
      if (!task || task.deletedAt) return { status: 'duplicate' };
      Object.assign(task, { deletedAt: 'deleted', version: task.version + 1, updatedAt: stamp() });
      return { status: 'applied' };
    },

    // What another device (or the web) did
    remote(clientId, changes) {
      const task = server.tasks.get(clientId);
      Object.assign(task, changes, { version: task.version + 1, updatedAt: ++server.clock });
    },
    live() {
      return [...server.tasks.values()].filter(t => !t.deletedAt);
    },
  };
  return server;
};

// Timers that fire only when the test says so.
const fakeTimers = () => {
  const timers = [];
  return {
    pending: () => timers.filter(t => !t.done),
    setTimer(run, ms) {
      const timer = { run, ms, done: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.done = true; },
    // Fires what is waiting now (not what those callbacks schedule), then lets it settle
    async fire() {
      for (const timer of timers.filter(t => !t.done)) {
        timer.done = true;
        timer.run();
      }
      await tick();
    },
  };
};

const setup = async ({ disk = fakeDisk(), server = fakeServer(), today = () => TODAY, refreshAuth } = {}) => {
  const timers = fakeTimers();
  let ids = disk.ids ?? 0;
  const auth = { refreshes: 0 };
  const engine = createSyncEngine({
    storage: disk.storage,
    send: server.send,
    refreshAuth: refreshAuth ?? (async () => { auth.refreshes++; }),
    today,
    timezone: () => 'Asia/Kolkata',
    newId: () => { disk.ids = ++ids; return `id-${ids}`; },
    now: () => 1000,
    random: () => 0.5, // no jitter
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  await engine.load();
  return { engine, disk, server, timers, auth };
};

const newTask = (text, extra = {}) => ({ text, date: TODAY, ...extra });
const texts = (tasks) => tasks.map(t => t.text);
const retryTimers = (timers) => timers.pending().filter(t => t.ms >= RETRY_BASE_MS * 0.8);

// --- offline use ------------------------------------------------------------

test('create, edit, complete and delete all work with no connection', async () => {
  const { engine, server } = await setup();
  server.failWith = 'offline';

  const milk = engine.create(newTask('Buy milk'));
  const mom = engine.create(newTask('Call mom'));
  const gym = engine.create(newTask('Gym'));
  engine.update(milk.clientId, { completed: true });
  engine.update(mom.clientId, { text: 'Call dad', priority: 'high' });
  engine.remove(gym.clientId);

  assert.deepEqual(engine.tasks().map(t => [t.text, t.completed, t.priority]), [
    ['Buy milk', true, 'none'],
    ['Call dad', false, 'high'],
  ]);
  assert.equal(engine.isPending(milk.clientId), true);
  assert.equal(engine.status().pending, 2); // each task folded into its create; the deleted one is gone entirely
  assert.equal(server.tasks.size, 0);
});

test('going online sends everything and the server ends up matching the device', async () => {
  const { engine, server } = await setup();
  server.failWith = 'offline';
  const milk = engine.create(newTask('Buy milk'));
  engine.create(newTask('Call mom'));
  engine.update(milk.clientId, { completed: true });
  await engine.sync('launch');
  assert.equal(engine.status().problem, 'error');

  server.failWith = null;
  await engine.sync('reconnect');

  assert.deepEqual(server.live().map(t => [t.text, t.completed]), [['Buy milk', true], ['Call mom', false]]);
  assert.deepEqual(engine.status(), { online: true, syncing: false, pending: 0, failed: [], synced: true, problem: null });
  assert.equal(engine.isPending(milk.clientId), false);
  // The list now shows the server's copies
  assert.deepEqual(engine.tasks().map(t => t._id), ['mongo-id-1', 'mongo-id-3']);
});

// --- persistence across restart ---------------------------------------------

test('the queue and the task list survive the app being killed', async () => {
  const first = await setup();
  first.server.failWith = 'offline';
  const a = first.engine.create(newTask('A'));
  first.engine.create(newTask('B'));
  first.engine.update(a.clientId, { completed: true });
  const before = first.engine.tasks();
  await first.engine.flushed();
  first.engine.stop(); // killed

  const second = await setup({ disk: first.disk, server: first.server });
  assert.deepEqual(second.engine.tasks(), before);
  assert.equal(second.engine.status().pending, 2);

  first.server.failWith = null;
  await second.engine.sync('launch');
  assert.deepEqual(texts(first.server.live()), ['A', 'B']);
  assert.equal(second.engine.status().pending, 0);
});

test('operations are replayed in the order they were made, across a restart', async () => {
  const first = await setup();
  first.server.failWith = 'offline';
  const a = first.engine.create(newTask('A'));
  await first.engine.sync('manual'); // A's create has now been attempted, so later ops stay separate
  const b = first.engine.create(newTask('B'));
  first.engine.update(a.clientId, { text: 'A2' });
  first.engine.update(b.clientId, { completed: true });
  first.engine.remove(a.clientId);
  const c = first.engine.create(newTask('C'));
  await first.engine.flushed();
  first.engine.stop();

  const second = await setup({ disk: first.disk, server: first.server });
  first.server.failWith = null;
  first.server.requests.length = 0;
  await second.engine.sync('launch');

  assert.deepEqual(first.server.requests[0].ops.map(o => [o.type, o.taskId]), [
    ['create', a.clientId],
    ['create', b.clientId],
    ['delete', a.clientId],
    ['create', c.clientId],
  ]);
  assert.deepEqual(texts(first.server.live()), ['B', 'C']);
});

test('killed after the server applied a batch but before the answer arrived: no duplicates', async () => {
  const first = await setup();
  const a = first.engine.create(newTask('A'));
  first.engine.create(newTask('B'));
  first.server.dropNextResponse = true;
  await first.engine.sync('manual');
  assert.equal(first.server.live().length, 2); // the server has them
  assert.equal(first.engine.status().pending, 2); // the device does not know that
  first.engine.update(a.clientId, { completed: true });
  await first.engine.flushed();
  first.engine.stop();

  const second = await setup({ disk: first.disk, server: first.server });
  await second.engine.sync('launch');

  assert.deepEqual(first.server.live().map(t => [t.text, t.completed]), [['A', true], ['B', false]]);
  assert.equal(second.engine.tasks().length, 2);
  assert.equal(second.engine.status().pending, 0);
});

test('offline create then delete before sync never reaches the server', async () => {
  const { engine, server } = await setup();
  server.failWith = 'offline';
  const task = engine.create(newTask('Never mind'));
  engine.update(task.clientId, { completed: true });
  engine.remove(task.clientId);
  assert.equal(engine.status().pending, 0);

  server.failWith = null;
  await engine.sync('reconnect');
  assert.deepEqual(server.requests.at(-1).ops, []);
  assert.equal(server.tasks.size, 0);
  assert.deepEqual(engine.tasks(), []);
});

test('a create that may have been sent is followed by its delete, leaving nothing', async () => {
  const { engine, server } = await setup();
  const task = engine.create(newTask('Sent then deleted'));
  server.dropNextResponse = true;
  await engine.sync('manual');
  engine.remove(task.clientId);
  assert.deepEqual(engine.tasks(), []);

  await engine.sync('manual');
  assert.deepEqual(server.requests.at(-1).ops.map(o => o.type), ['create', 'delete']);
  assert.deepEqual(server.live(), []);
  assert.deepEqual(engine.tasks(), []);
});

// --- pull and conflicts -----------------------------------------------------

test('changes from another device arrive as a delta, not a full list', async () => {
  const { engine, server } = await setup();
  engine.create(newTask('A'));
  const b = engine.create(newTask('B'));
  await engine.sync('manual');
  assert.equal(server.requests[0].cursor, null);

  server.remote(b.clientId, { text: 'B edited on the web' });
  await engine.sync('foreground');

  const request = server.requests.at(-1);
  assert.notEqual(request.cursor, null);
  assert.equal(request.localDate, TODAY);
  assert.equal(request.timezone, 'Asia/Kolkata');
  assert.deepEqual(texts(engine.tasks()), ['A', 'B edited on the web']);
});

test('edit vs edit: a pull keeps the local unsynced field and takes the rest', async () => {
  const { engine, server } = await setup();
  const task = engine.create(newTask('Report'));
  await engine.sync('manual');

  server.failWith = 'offline';
  engine.update(task.clientId, { completed: true });
  await engine.sync('manual');
  server.remote(task.clientId, { text: 'Report v2', priority: 'high' });
  server.failWith = null;
  await engine.sync('reconnect');

  const expected = { text: 'Report v2', priority: 'high', completed: true };
  const pick = (t) => ({ text: t.text, priority: t.priority, completed: t.completed });
  assert.deepEqual(pick(engine.tasks()[0]), expected);
  assert.deepEqual(pick(server.live()[0]), expected);
});

test('edit vs delete: a task deleted elsewhere disappears and the offline edit is dropped', async () => {
  const { engine, server } = await setup();
  const task = engine.create(newTask('Doomed'));
  await engine.sync('manual');

  server.failWith = 'offline';
  engine.update(task.clientId, { text: 'Edited offline' });
  await engine.sync('manual');
  server.remote(task.clientId, { deletedAt: 'deleted' });
  server.failWith = null;
  await engine.sync('reconnect');

  assert.deepEqual(engine.tasks(), []);
  assert.deepEqual(engine.status(), { online: true, syncing: false, pending: 0, failed: [], synced: true, problem: null });
  assert.equal(server.tasks.get(task.clientId).text, 'Doomed');
});

test('a delete made offline wins over an edit made elsewhere', async () => {
  const { engine, server } = await setup();
  const task = engine.create(newTask('Doomed'));
  await engine.sync('manual');

  server.failWith = 'offline';
  engine.remove(task.clientId);
  server.remote(task.clientId, { text: 'Edited on the web' });
  server.failWith = null;
  await engine.sync('reconnect');

  assert.deepEqual(engine.tasks(), []);
  assert.deepEqual(server.live(), []);
});

test('a change made while a sync is in flight is kept and sent right after', async () => {
  const { engine, server } = await setup();
  const task = engine.create(newTask('A'));
  await engine.sync('manual');

  server.hold = deferred();
  const running = engine.sync('manual');
  await tick();
  engine.update(task.clientId, { completed: true }); // the pull in flight does not know this
  assert.equal(engine.status().syncing, true);
  server.hold.resolve();
  server.hold = null;
  await running;

  assert.equal(engine.tasks()[0].completed, true);
  assert.equal(server.live()[0].completed, true);
  assert.equal(engine.status().pending, 0);
});

// --- triggers ---------------------------------------------------------------

test('only one sync runs at a time, however many triggers fire', async () => {
  const { engine, server } = await setup();
  engine.create(newTask('A'));
  server.hold = deferred();

  const runs = ['launch', 'foreground', 'reconnect', 'periodic', 'manual'].map(reason => engine.sync(reason));
  await tick();
  assert.equal(server.requests.length, 1);

  server.hold.resolve();
  server.hold = null;
  await Promise.all(runs);
  // One follow-up for the triggers that arrived meanwhile, not one each
  assert.equal(server.requests.length, 2);
  assert.equal(server.live().length, 1);
});

test('a local change syncs by itself after a short pause; a burst is one request', async () => {
  const { engine, server, timers } = await setup();
  const a = engine.create(newTask('A'));
  engine.update(a.clientId, { completed: true });
  engine.create(newTask('B'));
  assert.equal(server.requests.length, 0);
  assert.equal(timers.pending().length, 1);

  await timers.fire();
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].ops.length, 2);
  assert.equal(engine.status().pending, 0);
});

test('reconnecting syncs at once; routine triggers do nothing while offline', async () => {
  const { engine, server, timers } = await setup();
  engine.setOnline(false);
  engine.create(newTask('A'));
  await timers.fire(); // the change trigger
  await engine.sync('periodic');
  assert.equal(server.requests.length, 0);
  assert.equal(engine.status().online, false);

  engine.setOnline(true);
  await tick();
  assert.equal(server.requests.length, 1);
  assert.equal(engine.status().pending, 0);
});

// --- retry and backoff ------------------------------------------------------

test('retry delays double from 2 s up to a 5 minute cap, with jitter', () => {
  const noJitter = [1, 2, 3, 4, 5, 8, 9, 20].map(n => retryDelay(n, 0.5));
  assert.deepEqual(noJitter, [2000, 4000, 8000, 16000, 32000, 256000, 300000, 300000]);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);
  near(retryDelay(1, 0), RETRY_BASE_MS * 0.8);
  near(retryDelay(1, 1), RETRY_BASE_MS * 1.2);
  near(retryDelay(50, 1), RETRY_CAP_MS * 1.2);
});

test('a failed sync is retried with growing delays and the queue is left intact', async () => {
  const { engine, server, timers } = await setup();
  server.failWith = 503;
  engine.create(newTask('A'));
  await engine.sync('manual');

  const delays = [];
  for (let i = 0; i < 4; i++) {
    const [timer] = retryTimers(timers);
    assert.equal(retryTimers(timers).length, 1);
    delays.push(timer.ms);
    await timers.fire();
  }
  assert.deepEqual(delays, [2000, 4000, 8000, 16000]);
  assert.equal(engine.status().pending, 1);
  assert.equal(engine.status().problem, 'error');
  assert.equal(server.requests.length, 5);

  // While backing off, a local change does not cause extra attempts
  engine.create(newTask('B'));
  await engine.sync('change');
  await engine.sync('periodic');
  assert.equal(server.requests.length, 5);

  server.failWith = null;
  await timers.fire();
  assert.deepEqual(texts(server.live()), ['A', 'B']);
  assert.equal(engine.status().problem, null);
  assert.equal(retryTimers(timers).length, 0);
});

test('reconnect and foreground try immediately and start the backoff over', async () => {
  const { engine, server, timers } = await setup();
  server.failWith = 'offline';
  engine.create(newTask('A'));
  await engine.sync('manual');
  await timers.fire();
  await timers.fire();
  assert.equal(retryTimers(timers)[0].ms, 8000);

  await engine.sync('foreground');
  assert.equal(server.requests.length, 4);
  assert.deepEqual(retryTimers(timers).map(t => t.ms), [2000]);

  server.failWith = null;
  await engine.sync('reconnect');
  assert.equal(retryTimers(timers).length, 0);
  assert.equal(server.live().length, 1);
});

test('attempts are counted on the operations that were sent', async () => {
  const { engine, server, disk } = await setup();
  server.failWith = 500;
  engine.create(newTask('A'));
  await engine.sync('manual');
  await engine.sync('manual');
  engine.create(newTask('B'));
  await engine.flushed();
  assert.deepEqual(disk.outbox.map(o => o.attempts), [2, 0]);
});

// --- permanent failures -----------------------------------------------------

test('a rejected operation is set aside, surfaced and not retried', async () => {
  const { engine, server, timers } = await setup();
  server.failWith = 'offline';
  const bad = engine.create(newTask('Bad'));
  await engine.sync('manual'); // so the operations below stay separate
  engine.update(bad.clientId, { completed: true });
  engine.create(newTask('Good'));
  server.reject.set('id-2', 'text is not allowed');

  server.failWith = null;
  await engine.sync('reconnect');

  const status = engine.status();
  assert.equal(status.pending, 0);
  assert.equal(status.problem, null);
  assert.deepEqual(status.failed.map(o => [o.type, o.error]), [['create', 'text is not allowed'], ['update', 'text is not allowed']]);
  assert.deepEqual(texts(engine.tasks()), ['Good']);
  assert.deepEqual(texts(server.live()), ['Good']);

  const sent = server.requests.length;
  await engine.sync('manual');
  await timers.fire();
  assert.equal(server.requests.at(-1).ops.length, 0);
  assert.equal(server.requests.length, sent + 1);
});

test('failed operations survive a restart and can be retried or discarded', async () => {
  const first = await setup();
  first.server.reject.set('id-2', 'nope');
  first.engine.create(newTask('Bad'));
  await first.engine.sync('manual');
  await first.engine.flushed();
  first.engine.stop();

  const second = await setup({ disk: first.disk, server: first.server });
  assert.equal(second.engine.status().failed.length, 1);

  first.server.reject.clear();
  second.engine.retryFailed();
  await second.engine.sync('manual');
  assert.deepEqual(texts(first.server.live()), ['Bad']);
  assert.deepEqual(second.engine.status().failed, []);

  first.server.reject.set('id-3', 'nope again');
  const task = second.engine.tasks()[0];
  second.engine.update(task.clientId, { text: 'Worse' });
  await second.engine.sync('manual');
  assert.equal(second.engine.status().failed.length, 1);
  second.engine.discardFailed();
  await second.engine.flushed();
  assert.deepEqual(first.disk.failed, []);
  assert.deepEqual(texts(second.engine.tasks()), ['Bad']); // back to what the server holds
});

test('a request refused as a whole is narrowed down to the one bad operation', async () => {
  const { engine, server } = await setup();
  server.failWith = 'offline';
  const tasks = ['A', 'B', 'C', 'D', 'E'].map(text => engine.create(newTask(text)));
  const poison = tasks[2].clientId;
  server.failWith = (request) => (request.ops.some(o => o.taskId === poison) ? 400 : null);

  await engine.sync('reconnect');

  assert.deepEqual(texts(server.live()), ['A', 'B', 'D', 'E']);
  assert.deepEqual(engine.status().failed.map(o => o.taskId), [poison]);
  assert.equal(engine.status().pending, 0);
  assert.equal(engine.status().problem, null);
});

test('a long queue is sent in batches, in order', async () => {
  const { engine, server } = await setup();
  server.failWith = 'offline';
  for (let i = 0; i < MAX_BATCH * 2 + 5; i++) engine.create(newTask(`Task ${i}`));
  server.failWith = null;
  await engine.sync('reconnect');

  assert.deepEqual(server.requests.map(r => r.ops.length), [MAX_BATCH, MAX_BATCH, 5]);
  assert.deepEqual(texts(server.live()), Array.from({ length: MAX_BATCH * 2 + 5 }, (_, i) => `Task ${i}`));
  assert.equal(engine.tasks().length, MAX_BATCH * 2 + 5);
});

// --- auth -------------------------------------------------------------------

test('an expired token is refreshed once and the sync continues', async () => {
  const server = fakeServer();
  let expired = true;
  let refreshes = 0;
  server.failWith = () => (expired ? 401 : null);
  const { engine } = await setup({ server, refreshAuth: async () => { refreshes++; expired = false; } });
  engine.create(newTask('A'));

  await engine.sync('manual');
  assert.equal(refreshes, 1);
  assert.deepEqual(texts(server.live()), ['A']);
  assert.equal(engine.status().problem, null);
});

test('when the session cannot be renewed, sync pauses and nothing is lost', async () => {
  const server = fakeServer();
  server.failWith = 401;
  let refreshes = 0;
  const { engine, disk, timers } = await setup({ server, refreshAuth: async () => { refreshes++; throw new Error('signed out'); } });
  engine.create(newTask('A'));

  await engine.sync('manual');
  await engine.flushed();
  assert.equal(refreshes, 1);
  assert.equal(engine.status().problem, 'auth');
  assert.equal(disk.outbox.length, 1);
  assert.deepEqual(texts(engine.tasks()), ['A']);
  assert.equal(retryTimers(timers).length, 1); // still tried again later

  // A token that keeps being refused after a refresh is treated the same way
  const stubborn = await setup({ server });
  stubborn.engine.create(newTask('B'));
  await stubborn.engine.sync('manual');
  assert.equal(stubborn.auth.refreshes, 1);
  assert.equal(stubborn.engine.status().problem, 'auth');
});

// --- rollover ---------------------------------------------------------------

test('rollover happens on the device with no connection and queues nothing', async () => {
  let today = '2026-10-06';
  const { engine, server, disk } = await setup({ today: () => today });
  const open = engine.create(newTask('Open'));
  const done = engine.create(newTask('Done'));
  engine.update(done.clientId, { completed: true });
  await engine.sync('manual');

  server.failWith = 'offline';
  today = '2026-10-08';
  engine.refreshDay();

  assert.deepEqual(engine.tasks().map(t => [t.text, t.date]), [['Open', '2026-10-08'], ['Done', '2026-10-06']]);
  assert.equal(engine.status().pending, 0);
  assert.equal(engine.isPending(open.clientId), false);
  await engine.flushed();
  assert.equal(disk.meta.rolloverDay, '2026-10-08');

  // The clock going back (travelling west) does not move tasks back
  today = '2026-10-07';
  engine.refreshDay();
  assert.equal(engine.tasks()[0].date, '2026-10-08');
});

test('completing a rolled-over task keeps it on the day it was rolled to', async () => {
  let today = '2026-10-06';
  const { engine, server } = await setup({ today: () => today });
  const task = engine.create(newTask('Late'));
  await engine.sync('manual');

  today = '2026-10-07';
  engine.refreshDay();
  engine.update(task.clientId, { completed: true });

  assert.equal(engine.tasks()[0].date, '2026-10-07');
  await engine.sync('manual');
  assert.deepEqual(server.requests.at(-1).ops[0].payload, { completed: true, date: '2026-10-07' });
  assert.equal(engine.tasks()[0].date, '2026-10-07');
});

// --- housekeeping -----------------------------------------------------------

test('an update that changes nothing queues nothing; unknown tasks are ignored', async () => {
  const { engine } = await setup();
  const task = engine.create(newTask('A', { priority: 'low' }));
  await engine.sync('manual');

  assert.equal(engine.update(task.clientId, { priority: 'low', completed: false }).text, 'A');
  assert.equal(engine.update('nope', { completed: true }), null);
  engine.remove('nope');
  assert.equal(engine.status().pending, 0);
});

test('subscribers hear about local changes and sync results', async () => {
  const { engine } = await setup();
  let calls = 0;
  const unsubscribe = engine.subscribe(() => calls++);

  engine.create(newTask('A'));
  assert.equal(calls, 1);
  await engine.sync('manual');
  assert.ok(calls >= 3); // started, finished
  const before = calls;
  unsubscribe();
  engine.create(newTask('B'));
  assert.equal(calls, before);
});

test('signing out wipes the device copy, and a sync still in flight cannot write it back', async () => {
  const { engine, server, disk } = await setup();
  engine.create(newTask('A'));
  await engine.sync('manual');
  engine.create(newTask('B'));
  server.hold = deferred();
  const running = engine.sync('manual');
  await tick();

  await engine.clear();
  server.hold.resolve();
  await running;
  await tick();

  assert.equal(disk.base, undefined);
  assert.equal(disk.outbox, undefined);
  assert.equal(disk.meta, undefined);
});
