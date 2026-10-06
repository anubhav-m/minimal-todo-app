import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { getTasks, updateTask, deleteTask } from './taskController.js';
import { syncTasks, MAX_OPS } from './syncController.js';
import { useDatabase, call, signUp } from '../test/harness.js';

useDatabase();

const FAR = '2099-01-01'; // a date rollover never touches
const todayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

let opCount = 0;
const op = (type, taskId, payload = {}) => ({ id: `op-${++opCount}`, type, taskId, payload });
const create = (taskId, payload = {}) => op('create', taskId, { text: 'Call mom', date: FAR, ...payload });

// One device: remembers its cursor between syncs, like the app does.
const device = () => {
  let cursor;
  return {
    async sync(ops = [], extra = {}) {
      const { body } = await call(syncTasks, { body: { ops, cursor, ...extra } });
      cursor = body.cursor;
      return body;
    },
  };
};
const statuses = (body) => body.results.map(r => r.status);
const stored = (clientId) => Task.findOne({ clientId });

// --- idempotency ------------------------------------------------------------

test('a create replayed any number of times makes one task', async () => {
  await signUp();
  const phone = device();
  const make = create('t-1');

  const first = await phone.sync([make]);
  const again = await phone.sync([make]);
  const racing = await Promise.all([phone.sync([make]), phone.sync([make])]);

  assert.deepEqual(statuses(first), ['applied']);
  assert.deepEqual(statuses(again), ['duplicate']);
  assert.deepEqual(racing.flatMap(statuses), ['duplicate', 'duplicate']);
  assert.equal(await Task.countDocuments(), 1);
});

test('a replayed update does not overwrite a newer change from another device', async () => {
  await signUp();
  const phone = device();
  const web = device();
  await phone.sync([create('t-1')]);

  const rename = op('update', 't-1', { text: 'from the phone' });
  await phone.sync([rename]); // applied, but say the response never arrived
  await web.sync([op('update', 't-1', { text: 'from the web, later' })]);
  const replay = await phone.sync([rename]);

  assert.deepEqual(statuses(replay), ['duplicate']);
  const task = await stored('t-1');
  assert.equal(task.text, 'from the web, later');
  assert.equal(task.version, 2);
});

test('the same update sent concurrently is applied once', async () => {
  await signUp();
  const phone = device();
  await phone.sync([create('t-1')]);

  const complete = op('update', 't-1', { completed: true });
  const results = await Promise.all(Array.from({ length: 8 }, () => phone.sync([complete])));

  assert.equal(results.flatMap(statuses).filter(s => s === 'applied').length, 1);
  assert.equal((await stored('t-1')).version, 1);
});

test('a whole batch replayed after a lost response changes nothing', async () => {
  await signUp();
  const phone = device();
  const batch = [
    create('t-1'),
    create('t-2', { text: 'Buy milk' }),
    op('update', 't-1', { completed: true }),
    op('delete', 't-2'),
  ];

  assert.deepEqual(statuses(await phone.sync(batch)), ['applied', 'applied', 'applied', 'applied']);
  const before = await Task.find().sort({ clientId: 1 }).lean();

  assert.deepEqual(statuses(await phone.sync(batch)), ['duplicate', 'duplicate', 'duplicate', 'duplicate']);
  assert.deepEqual(await Task.find().sort({ clientId: 1 }).lean(), before);
});

// --- conflicts --------------------------------------------------------------

test('edit vs edit on different fields keeps both', async () => {
  await signUp();
  const phone = device();
  const web = device();
  await phone.sync([create('t-1')]);
  await web.sync();

  await phone.sync([op('update', 't-1', { text: 'Call dad' })]);
  await web.sync([op('update', 't-1', { completed: true })]);

  const task = await stored('t-1');
  assert.equal(task.text, 'Call dad');
  assert.equal(task.completed, true);
});

test('edit vs edit on the same field: the last one to arrive wins', async () => {
  await signUp();
  const phone = device();
  const web = device();
  await phone.sync([create('t-1')]);

  await web.sync([op('update', 't-1', { text: 'web', priority: 'high' })]);
  await phone.sync([op('update', 't-1', { text: 'phone' })]);

  const task = await stored('t-1');
  assert.equal(task.text, 'phone');
  assert.equal(task.priority, 'high'); // not named by the phone's edit, so untouched
});

test('edit vs delete: delete wins when the edit arrives second', async () => {
  await signUp();
  const phone = device();
  const web = device();
  await phone.sync([create('t-1')]);
  await phone.sync();

  await web.sync([op('delete', 't-1')]);
  const late = await phone.sync([op('update', 't-1', { text: 'edited offline', completed: true })]);

  assert.deepEqual(statuses(late), ['gone']);
  const task = await stored('t-1');
  assert.ok(task.deletedAt);
  assert.equal(task.text, 'Call mom');
  // and the phone is told, so it can drop the task
  assert.deepEqual(late.changes.map(t => [t.clientId, !!t.deletedAt]), [['t-1', true]]);
});

test('edit vs delete: delete wins when the edit arrives first', async () => {
  await signUp();
  const phone = device();
  const web = device();
  await phone.sync([create('t-1')]);

  await phone.sync([op('update', 't-1', { text: 'edited' })]);
  assert.deepEqual(statuses(await web.sync([op('delete', 't-1')])), ['applied']);

  assert.ok((await stored('t-1')).deletedAt);
  assert.deepEqual((await call(getTasks)).body, []);
});

test('create then delete in one batch leaves nothing visible', async () => {
  await signUp();
  const phone = device();
  const result = await phone.sync([create('t-1'), op('delete', 't-1')]);

  assert.deepEqual(statuses(result), ['applied', 'applied']);
  assert.deepEqual((await call(getTasks)).body, []);
});

test('a create for a deleted task does not bring it back', async () => {
  await signUp();
  const phone = device();
  const make = create('t-1');
  await phone.sync([make]);
  await phone.sync([op('delete', 't-1')]);

  const sameOp = await phone.sync([make]);
  const newOp = await phone.sync([create('t-1', { text: 'Reborn' })]);

  assert.deepEqual([...statuses(sameOp), ...statuses(newOp)], ['duplicate', 'duplicate']);
  assert.equal(await Task.countDocuments(), 1);
  assert.ok((await stored('t-1')).deletedAt);
});

test('delete is idempotent and an update of an unknown task is gone', async () => {
  await signUp();
  const phone = device();
  await phone.sync([create('t-1')]);

  assert.deepEqual(statuses(await phone.sync([op('delete', 't-1')])), ['applied']);
  const deletedAt = (await stored('t-1')).deletedAt;
  assert.deepEqual(statuses(await phone.sync([op('delete', 't-1'), op('delete', 'never-existed')])), ['duplicate', 'duplicate']);
  assert.deepEqual((await stored('t-1')).deletedAt, deletedAt);
  assert.deepEqual(statuses(await phone.sync([op('update', 'never-existed', { completed: true })])), ['gone']);
});

// --- permanent failures -----------------------------------------------------

test('an invalid operation is rejected on its own; the rest of the batch applies', async () => {
  await signUp();
  const phone = device();
  const result = await phone.sync([
    create('t-1'),
    create('t-2', { text: '   ' }),
    create('t-3', { date: 'tomorrow' }),
    op('update', 't-1', { priority: 'urgent' }),
    op('update', 't-1', { completed: 'yes' }),
    { id: 'x', type: 'archive', taskId: 't-1', payload: {} },
    { id: 'y', type: 'update', taskId: { $ne: null }, payload: { completed: true } },
    op('update', 't-1', { completed: true }),
  ]);

  assert.deepEqual(statuses(result), ['applied', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'applied']);
  assert.ok(result.results.slice(1, 7).every(r => typeof r.error === 'string' && r.error));
  assert.equal(await Task.countDocuments(), 1);
  const task = await stored('t-1');
  assert.equal(task.completed, true);
  assert.equal(task.priority, 'none');
});

test('an operation cannot set fields outside the task, or touch a task of another user', async () => {
  const user = await signUp();
  const otherUserId = new mongoose.Types.ObjectId();
  await Task.create({ userId: otherUserId, clientId: 'theirs', text: 'Private', date: FAR });
  const phone = device();
  await phone.sync([create('t-1', { userId: String(otherUserId), version: 50, deletedAt: new Date() })]);

  const result = await phone.sync([
    op('update', 't-1', { userId: String(otherUserId), version: 99, deletedAt: new Date(), completed: true }),
    op('update', 'theirs', { text: 'hacked' }),
    op('delete', 'theirs'),
  ]);

  assert.deepEqual(statuses(result), ['applied', 'gone', 'duplicate']);
  const mine = await stored('t-1');
  assert.equal(String(mine.userId), user._id);
  assert.equal(mine.version, 1);
  assert.equal(mine.deletedAt, null);
  const theirs = await stored('theirs');
  assert.equal(theirs.text, 'Private');
  assert.equal(theirs.deletedAt, null);
});

test('an oversized or malformed request is refused as a whole', async () => {
  await signUp();
  const tooMany = Array.from({ length: MAX_OPS + 1 }, (_, i) => create(`t-${i}`));
  await assert.rejects(call(syncTasks, { body: { ops: tooMany } }), { statusCode: 413 });
  await assert.rejects(call(syncTasks, { body: { ops: 'all of them' } }), { statusCode: 400 });
  assert.equal(await Task.countDocuments(), 0);
});

// --- pull -------------------------------------------------------------------

test('the first sync returns every live task; later ones only what changed', async () => {
  await signUp();
  const web = device();
  await web.sync([create('t-1'), create('t-2', { text: 'Buy milk' }), create('t-3', { text: 'Old' }), op('delete', 't-3')]);

  const phone = device();
  const first = await phone.sync();
  assert.equal(first.fullResync, true);
  assert.deepEqual(first.changes.map(t => t.clientId), ['t-1', 't-2']);

  // Nothing changed. Rows inside the cursor's overlap may come again, which is allowed.
  const quiet = await phone.sync();
  assert.equal(quiet.fullResync, false);
  assert.ok(quiet.changes.every(t => ['t-1', 't-2', 't-3'].includes(t.clientId)));
});

test('a delta holds exactly the rows changed after the cursor, tombstones included', async () => {
  const user = await signUp();
  const userId = new mongoose.Types.ObjectId(user._id);
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60 * 1000);
  const row = (clientId, updatedAt, extra = {}) =>
    ({ userId, clientId, text: clientId, date: FAR, completed: false, version: 1, deletedAt: null, createdAt: at(120), updatedAt, ...extra });
  await Task.collection.insertMany([
    row('untouched', at(60)),
    row('edited', at(10)),
    row('deleted', at(5), { deletedAt: at(5) }),
    row('deleted-long-ago', at(50), { deletedAt: at(50) }),
  ]);

  const { body } = await call(syncTasks, { body: { cursor: at(30).toISOString() } });

  assert.equal(body.fullResync, false);
  assert.deepEqual(body.changes.map(t => [t.clientId, !!t.deletedAt]).sort(), [['deleted', true], ['edited', false]]);
});

test('a write made through the REST endpoints is in the next delta', async () => {
  await signUp();
  const phone = device();
  await phone.sync([create('t-1'), create('t-2', { text: 'Buy milk' })]);

  const { body: tasks } = await call(getTasks);
  const id = (clientId) => tasks.find(t => t.clientId === clientId)._id;
  // The web app still uses these
  await call(updateTask, { params: { id: id('t-1') }, body: { completed: true } });
  await call(deleteTask, { params: { id: id('t-2') } });

  const delta = await phone.sync();
  const byId = Object.fromEntries(delta.changes.map(t => [t.clientId, t]));
  assert.equal(byId['t-1'].completed, true);
  assert.ok(byId['t-2'].deletedAt);
});

test('the response includes the server copy of what the batch just wrote', async () => {
  await signUp();
  const phone = device();
  await phone.sync([create('t-1')]);
  const result = await phone.sync([op('update', 't-1', { completed: true })]);

  const row = result.changes.find(t => t.clientId === 't-1');
  assert.equal(row.completed, true);
  assert.equal(row.version, 1);
  assert.equal(row.appliedOps, undefined); // bookkeeping stays on the server
});

test('a missing, unreadable or very old cursor forces a full resync', async () => {
  await signUp();
  await device().sync([create('t-1'), create('t-2'), op('delete', 't-2')]);
  const veryOld = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();

  for (const cursor of [undefined, 'not a date', 12345, veryOld]) {
    const { body } = await call(syncTasks, { body: { cursor } });
    assert.equal(body.fullResync, true, `cursor ${cursor}`);
    assert.deepEqual(body.changes.map(t => t.clientId), ['t-1']);
  }
});

test('tasks from before clientId existed get one, once, and keep it', async () => {
  const user = await signUp();
  const { insertedId } = await Task.collection.insertOne({
    userId: new mongoose.Types.ObjectId(user._id), text: 'Old', date: FAR, completed: false,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const phone = device();

  const first = await phone.sync();
  assert.deepEqual(first.changes.map(t => t.clientId), [String(insertedId)]);

  const result = await phone.sync([op('update', String(insertedId), { completed: true })]);
  assert.deepEqual(statuses(result), ['applied']);
  const task = await Task.findById(insertedId);
  assert.equal(task.clientId, String(insertedId));
  assert.equal(task.completed, true);
});

// --- rollover ---------------------------------------------------------------

test('operations are applied before rollover: a task completed offline stays on its day', async () => {
  await signUp();
  const today = todayIn('UTC');
  const phone = device();

  const result = await phone.sync(
    [create('done', { date: '2026-10-01' }), op('update', 'done', { completed: true }), create('open', { date: '2026-10-01' })],
    { localDate: today, timezone: 'UTC' }
  );

  const byId = Object.fromEntries(result.changes.map(t => [t.clientId, t.date]));
  assert.deepEqual(byId, { done: '2026-10-01', open: today });
});

test('rollover still runs for tasks synced after the rollover for today already happened', async () => {
  const user = await signUp();
  const today = todayIn('UTC');
  await call(getTasks, { query: { localDate: today, timezone: 'UTC' } }); // the web opened first today
  assert.equal((await User.findById(user._id)).lastRolloverDate, today);

  const phone = device();
  const result = await phone.sync([create('late', { date: '2026-10-01' })], { localDate: today, timezone: 'UTC' });

  assert.equal(result.changes.find(t => t.clientId === 'late').date, today);
  assert.equal((await User.findById(user._id)).lastRolloverDate, today);
});

test('a sync with nothing to send still rolls over, once a day, and shows it in the delta', async () => {
  await signUp();
  const today = todayIn('UTC');
  const phone = device();
  await phone.sync([create('t-1', { date: '2026-10-01' })]); // no localDate: no rollover
  assert.equal((await stored('t-1')).date, '2026-10-01');
  await Task.collection.updateOne({ clientId: 't-1' }, { $set: { updatedAt: new Date(Date.now() - 60 * 1000) } });
  await phone.sync();

  const result = await phone.sync([], { localDate: today, timezone: 'UTC' });
  assert.deepEqual(result.changes.map(t => [t.clientId, t.date]), [['t-1', today]]);
  const version = (await stored('t-1')).version;

  await phone.sync([], { localDate: today, timezone: 'UTC' });
  assert.equal((await stored('t-1')).version, version);
});
