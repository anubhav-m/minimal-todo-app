import { test } from 'node:test';
import assert from 'node:assert/strict';
import Task from '../models/Task.js';
import { getTasks } from '../controllers/taskController.js';
import { syncTasks } from '../controllers/syncController.js';
import { createSyncEngine } from '../../mobile/src/sync/syncEngine.ts';
import { useDatabase, call, signUp } from './harness.js';

// The mobile sync engine talking to the real sync controller and a real mongod.
// Each side has its own tests against a stand-in for the other; this is the one
// place that proves they agree on the protocol.
useDatabase();

const todayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
const TODAY = todayIn('UTC');
const FAR = '2099-01-01';

const network = () => {
  const net = { down: false, loseNextResponse: false };
  net.send = async (request) => {
    if (net.down) throw new Error('Network Error');
    const { body } = await call(syncTasks, { body: JSON.parse(JSON.stringify(request)) });
    if (net.loseNextResponse) {
      net.loseNextResponse = false;
      throw new Error('Network Error');
    }
    return body;
  };
  return net;
};

const newDisk = () => {
  const disk = {};
  const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  disk.storage = {
    load: async () => copy({ base: disk.base, outbox: disk.outbox, failed: disk.failed, meta: disk.meta }),
    saveBase: async (base) => { disk.base = copy(base); },
    saveOutbox: async (outbox, failed) => { disk.outbox = copy(outbox); disk.failed = copy(failed); },
    saveMeta: async (meta) => { disk.meta = copy(meta); },
    clear: async () => { for (const key of ['base', 'outbox', 'failed', 'meta']) delete disk[key]; },
  };
  return disk;
};

let deviceCount = 0;
// Opens the app on a device: a fresh engine over whatever that device has on disk.
const open = async (disk, net) => {
  const prefix = `d${++deviceCount}`;
  let n = 0;
  const engine = createSyncEngine({
    storage: disk.storage,
    send: net.send,
    refreshAuth: async () => {},
    today: () => TODAY,
    timezone: () => 'UTC',
    newId: () => `${prefix}-${++n}`,
    setTimer: () => null, // the tests decide when to sync
    clearTimer: () => {},
  });
  await engine.load();
  return engine;
};
const kill = async (engine) => {
  await engine.flushed();
  engine.stop();
};

const summary = (tasks) => tasks.map(t => `${t.text}|${t.date}|${t.completed ? 'done' : 'open'}|${t.priority}`).sort();
const onServer = async () => summary((await call(getTasks)).body);

test('offline create/edit/complete/delete, kill, reopen, go online: server matches, no duplicates', async () => {
  await signUp();
  const disk = newDisk();
  const net = network();
  let phone = await open(disk, net);
  const seeded = phone.create({ text: 'Existing', date: FAR });
  const doomed = phone.create({ text: 'Delete me', date: FAR });
  await phone.sync('launch');

  net.down = true; // airplane mode
  const milk = phone.create({ text: 'Buy milk', date: FAR });
  const mom = phone.create({ text: 'Call mom', date: FAR, priority: 'low' });
  const oops = phone.create({ text: 'Never mind', date: FAR });
  phone.update(milk.clientId, { completed: true });
  phone.update(mom.clientId, { text: 'Call dad', priority: 'high' });
  phone.update(seeded.clientId, { completed: true });
  phone.remove(oops.clientId);
  phone.remove(doomed.clientId);
  await phone.sync('manual');
  const offlineView = summary(phone.tasks());
  await kill(phone);

  phone = await open(disk, net); // reopened, still offline
  assert.deepEqual(summary(phone.tasks()), offlineView);
  assert.deepEqual(await onServer(), [`Delete me|${FAR}|open|none`, `Existing|${FAR}|open|none`]);

  net.down = false;
  await phone.sync('reconnect');

  const expected = [`Buy milk|${FAR}|done|none`, `Call dad|${FAR}|open|high`, `Existing|${FAR}|done|none`];
  assert.deepEqual(await onServer(), expected);
  assert.deepEqual(summary(phone.tasks()), expected);
  assert.equal(phone.status().pending, 0);
  assert.deepEqual(phone.status().failed, []);
  // 'Never mind' never reached the server; 'Delete me' is a tombstone, not a second row
  assert.equal(await Task.countDocuments(), 4);
  assert.equal(await Task.countDocuments({ deletedAt: { $ne: null } }), 1);

  // Syncing again, and reopening again, changes nothing
  const before = await Task.find().sort({ clientId: 1 }).lean();
  await phone.sync('manual');
  await kill(phone);
  phone = await open(disk, net);
  await phone.sync('launch');
  assert.deepEqual(await Task.find().sort({ clientId: 1 }).lean(), before);
  assert.deepEqual(summary(phone.tasks()), expected);
});

test('the answer is lost and the app is killed: the replay does not duplicate or resurrect', async () => {
  await signUp();
  const disk = newDisk();
  const net = network();
  let phone = await open(disk, net);
  const a = phone.create({ text: 'A', date: FAR });
  const b = phone.create({ text: 'B', date: FAR });
  net.loseNextResponse = true;
  await phone.sync('manual'); // applied on the server; the phone never hears
  phone.remove(b.clientId);
  phone.update(a.clientId, { completed: true });
  net.loseNextResponse = true;
  await phone.sync('manual'); // same again for the delete and the edit
  await kill(phone);

  phone = await open(disk, net);
  await phone.sync('launch');

  assert.deepEqual(await onServer(), [`A|${FAR}|done|none`]);
  assert.deepEqual(summary(phone.tasks()), [`A|${FAR}|done|none`]);
  assert.equal(await Task.countDocuments(), 2);
  assert.equal((await Task.findOne({ clientId: a.clientId })).version, 1); // the edit was applied once
});

test('two devices offline: different fields merge, same field goes to the last to sync, delete wins', async () => {
  await signUp();
  const net = network();
  const phone = await open(newDisk(), net);
  const tablet = await open(newDisk(), net);
  const report = phone.create({ text: 'Report', date: FAR });
  const errand = phone.create({ text: 'Errand', date: FAR });
  const doomed = phone.create({ text: 'Doomed', date: FAR });
  await phone.sync('manual');
  await tablet.sync('manual');
  assert.equal(tablet.tasks().length, 3);

  // Both go offline and change things
  phone.update(report.clientId, { completed: true });
  tablet.update(report.clientId, { priority: 'high' });
  phone.update(errand.clientId, { text: 'Errand (phone)' });
  tablet.update(errand.clientId, { text: 'Errand (tablet)' });
  phone.update(doomed.clientId, { text: 'Edited on the phone' });
  tablet.remove(doomed.clientId);

  await tablet.sync('reconnect');
  await phone.sync('reconnect'); // the phone reaches the server last
  await tablet.sync('foreground');

  const expected = [`Errand (phone)|${FAR}|open|none`, `Report|${FAR}|done|high`];
  assert.deepEqual(await onServer(), expected);
  assert.deepEqual(summary(phone.tasks()), expected);
  assert.deepEqual(summary(tablet.tasks()), expected);
  assert.equal(phone.status().pending + tablet.status().pending, 0);
});

test('rollover on the device and on the server agree', async () => {
  await signUp();
  const net = network();
  net.down = true;
  const phone = await open(newDisk(), net);
  const open1 = phone.create({ text: 'Overdue', date: '2026-10-01' });
  // Overdue, so it shows on today; completing it there keeps it on today, as it does online
  const done = phone.create({ text: 'Finished', date: '2026-10-01' });
  phone.update(done.clientId, { completed: true });
  const local = summary(phone.tasks());
  assert.deepEqual(local, [`Finished|${TODAY}|done|none`, `Overdue|${TODAY}|open|none`]);
  assert.equal(phone.isPending(open1.clientId), true);

  net.down = false;
  await phone.sync('reconnect');

  assert.deepEqual(await onServer(), local);
  assert.deepEqual(summary(phone.tasks()), local);
  assert.equal((await Task.findOne({ clientId: open1.clientId })).date, TODAY);
});

test('a change the server rejects is set aside and the rest still syncs', async () => {
  await signUp();
  const net = network();
  const phone = await open(newDisk(), net);
  phone.create({ text: 'Fine', date: FAR });
  phone.create({ text: 'x'.repeat(2000), date: FAR });
  phone.create({ text: 'Also fine', date: FAR });

  await phone.sync('manual');

  assert.deepEqual(await onServer(), [`Also fine|${FAR}|open|none`, `Fine|${FAR}|open|none`]);
  assert.equal(phone.status().failed.length, 1);
  assert.match(phone.status().failed[0].error, /text/);
  assert.equal(phone.status().pending, 0);
  assert.equal(phone.tasks().length, 2);
});
