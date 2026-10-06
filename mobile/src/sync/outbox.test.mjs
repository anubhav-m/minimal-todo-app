import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOutbox, enqueue, mergePull, moveAside, pendingTaskIds, rollOver, rolloverDay, visibleTasks } from './outbox.ts';

let n = 0;
const op = (type, taskId, payload = {}, attempts = 0) => ({ id: `op-${++n}`, type, taskId, payload, createdAt: n, attempts });
const queue = (...ops) => ops.reduce(enqueue, []);
const shape = (outbox) => outbox.map(o => [o.type, o.taskId, o.payload]);

const serverTask = (clientId, extra = {}) => ({
  clientId, _id: `mongo-${clientId}`, text: clientId, date: '2026-10-06', time: null, notify: false,
  notificationId: null, completed: false, priority: 'none', version: 0, createdAt: '2026-10-01T00:00:00.000Z', ...extra,
});
const baseOf = (...tasks) => Object.fromEntries(tasks.map(t => [t.clientId, t]));

// --- compaction -------------------------------------------------------------

test('operations are kept in the order they were made', () => {
  const outbox = queue(
    op('create', 'a', { text: 'A' }),
    op('update', 'b', { completed: true }),
    op('create', 'c', { text: 'C' }),
    op('delete', 'd'),
  );
  assert.deepEqual(outbox.map(o => [o.type, o.taskId]), [['create', 'a'], ['update', 'b'], ['create', 'c'], ['delete', 'd']]);
});

test('repeated updates of one task collapse into one operation', () => {
  const outbox = queue(
    op('update', 'a', { completed: true }),
    op('update', 'b', { completed: true }),
    op('update', 'a', { completed: false }),
    op('update', 'a', { text: 'renamed' }),
  );
  assert.deepEqual(shape(outbox), [
    ['update', 'a', { completed: false, text: 'renamed' }],
    ['update', 'b', { completed: true }],
  ]);
});

test('an update of a task not yet sent is folded into its create', () => {
  const outbox = queue(op('create', 'a', { text: 'A', completed: false }), op('update', 'a', { completed: true }));
  assert.deepEqual(shape(outbox), [['create', 'a', { text: 'A', completed: true }]]);
});

test('create then delete before any sync sends nothing', () => {
  const outbox = queue(
    op('create', 'a', { text: 'A' }),
    op('update', 'b', { completed: true }),
    op('update', 'a', { completed: true }),
    op('delete', 'a'),
  );
  assert.deepEqual(shape(outbox), [['update', 'b', { completed: true }]]);
});

test('an operation that was sent is never merged into or dropped', () => {
  const sentCreate = op('create', 'a', { text: 'A' }, 1);
  const sentUpdate = op('update', 'b', { completed: true }, 2);

  let outbox = queue(sentCreate, sentUpdate, op('update', 'a', { completed: true }), op('update', 'b', { completed: false }));
  assert.deepEqual(shape(outbox), [
    ['create', 'a', { text: 'A' }],
    ['update', 'b', { completed: true }],
    ['update', 'a', { completed: true }],
    ['update', 'b', { completed: false }],
  ]);

  // The create may have reached the server, so the delete has to follow it there
  outbox = enqueue(outbox, op('delete', 'a'));
  assert.deepEqual(shape(outbox), [
    ['create', 'a', { text: 'A' }],
    ['update', 'b', { completed: true }],
    ['update', 'b', { completed: false }],
    ['delete', 'a', {}],
  ]);
});

test('deleting a server task drops its unsent edits; nothing is queued after a delete', () => {
  let outbox = queue(op('update', 'a', { text: 'x' }), op('delete', 'a'));
  assert.deepEqual(shape(outbox), [['delete', 'a', {}]]);

  outbox = queue(...outbox, op('update', 'a', { completed: true }), op('delete', 'a'));
  assert.deepEqual(shape(outbox), [['delete', 'a', {}]]);
});

// --- the visible list -------------------------------------------------------

test('the list is the server copy with pending operations on top', () => {
  const base = baseOf(serverTask('a'), serverTask('b'), serverTask('c'));
  const outbox = queue(
    op('update', 'a', { completed: true }),
    op('delete', 'b'),
    op('create', 'new', { text: 'Made offline', date: '2026-10-06' }),
  );

  const tasks = applyOutbox(base, outbox);
  assert.deepEqual(tasks.map(t => [t.clientId, t.completed]), [['a', true], ['c', false], ['new', false]]);
  assert.deepEqual(tasks[2], {
    clientId: 'new', text: 'Made offline', date: '2026-10-06', time: null, notify: false,
    notificationId: null, completed: false, priority: 'none',
  });
  assert.deepEqual([...pendingTaskIds(outbox)].sort(), ['a', 'b', 'new']);
  assert.equal(base.a.completed, false); // the server copy itself is left alone
});

test('a pull never overrides a field the user changed and has not synced', () => {
  const outbox = queue(op('update', 'a', { completed: true }));
  // Another device renamed the task and the pull brings that in
  const base = mergePull(baseOf(serverTask('a')), [serverTask('a', { text: 'renamed elsewhere', version: 1 })], false);

  const [task] = applyOutbox(base, outbox);
  assert.equal(task.completed, true);
  assert.equal(task.text, 'renamed elsewhere');
});

test('a delete made offline is not undone by a pull that still has the task', () => {
  const outbox = queue(op('delete', 'a'));
  const base = mergePull({}, [serverTask('a'), serverTask('b')], true);
  assert.deepEqual(applyOutbox(base, outbox).map(t => t.clientId), ['b']);
});

test('an edit made offline does not bring back a task deleted elsewhere', () => {
  const outbox = queue(op('update', 'a', { text: 'edited offline' }));
  const base = mergePull(baseOf(serverTask('a')), [serverTask('a', { deletedAt: '2026-10-06T10:00:00.000Z', version: 1 })], false);
  assert.deepEqual(applyOutbox(base, outbox), []);
});

test('once the server has an offline-created task, its copy is used with later edits on top', () => {
  const created = op('create', 'a', { text: 'A', date: '2026-10-06' }, 1);
  const outbox = queue(created, op('update', 'a', { completed: true }));
  const base = baseOf(serverTask('a', { text: 'A', version: 0 }));

  const tasks = applyOutbox(base, outbox);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]._id, 'mongo-a');
  assert.equal(tasks[0].completed, true);
});

// --- merging a pull ---------------------------------------------------------

test('a pull adds, replaces and removes rows', () => {
  const base = baseOf(serverTask('keep'), serverTask('edit'), serverTask('drop'));
  const merged = mergePull(base, [
    serverTask('edit', { text: 'edited', version: 3 }),
    serverTask('drop', { deletedAt: '2026-10-06T10:00:00.000Z', version: 1 }),
    serverTask('added'),
  ], false);

  assert.deepEqual(Object.keys(merged).sort(), ['added', 'edit', 'keep']);
  assert.equal(merged.edit.text, 'edited');
  assert.deepEqual(Object.keys(base).sort(), ['drop', 'edit', 'keep']); // input untouched
});

test('a row older than the one already held is ignored', () => {
  const base = baseOf(serverTask('a', { text: 'newer', version: 5 }));
  const merged = mergePull(base, [serverTask('a', { text: 'older', version: 4 })], false);
  assert.equal(merged.a.text, 'newer');
});

test('a full resync replaces everything held', () => {
  const merged = mergePull(baseOf(serverTask('stale'), serverTask('a', { version: 9 })), [serverTask('a', { version: 2 })], true);
  assert.deepEqual(Object.keys(merged), ['a']);
  assert.equal(merged.a.version, 2);
});

// --- rollover ---------------------------------------------------------------

test('local rollover moves unfinished past tasks to today and nothing else', () => {
  const tasks = [
    serverTask('overdue', { date: '2026-10-01' }),
    serverTask('done', { date: '2026-10-01', completed: true }),
    serverTask('today', { date: '2026-10-06' }),
    serverTask('future', { date: '2026-10-09' }),
  ];
  const rolled = rollOver(tasks, '2026-10-06');
  assert.deepEqual(rolled.map(t => t.date), ['2026-10-06', '2026-10-01', '2026-10-06', '2026-10-09']);
  assert.equal(tasks[0].date, '2026-10-01');
  // Running it again, or for the same day, changes nothing
  assert.deepEqual(rollOver(rolled, '2026-10-06'), rolled);
});

test('rollover catches up over several days and applies to tasks made offline', () => {
  const base = baseOf(serverTask('old', { date: '2026-10-02' }));
  const outbox = queue(op('create', 'offline', { text: 'Made on the 4th', date: '2026-10-04' }));
  assert.deepEqual(visibleTasks(base, outbox, '2026-10-06').map(t => t.date), ['2026-10-06', '2026-10-06']);
});

test('a task completed offline stays on the day it was completed for', () => {
  const base = baseOf(serverTask('a', { date: '2026-10-05' }));
  const outbox = queue(op('update', 'a', { completed: true }));
  assert.equal(visibleTasks(base, outbox, '2026-10-06')[0].date, '2026-10-05');
});

test('the rollover day never goes backwards', () => {
  assert.equal(rolloverDay('2026-10-06', null), '2026-10-06');
  assert.equal(rolloverDay('2026-10-07', '2026-10-06'), '2026-10-07');
  assert.equal(rolloverDay('2026-10-05', '2026-10-06'), '2026-10-06');
});

// --- permanent failures -----------------------------------------------------

test('a rejected operation is moved aside with everything later for that task', () => {
  const outbox = queue(
    op('update', 'a', { text: 'fine' }, 1),
    op('create', 'bad', { text: '' }, 1),
    op('update', 'b', { completed: true }),
    op('update', 'bad', { completed: true }, 1),
    op('delete', 'bad'),
  );
  const rejectedId = outbox[1].id;

  const moved = moveAside(outbox, rejectedId, 'text is required');
  assert.deepEqual(moved.outbox.map(o => [o.type, o.taskId]), [['update', 'a'], ['update', 'b']]);
  assert.deepEqual(moved.failed.map(o => [o.type, o.taskId, o.error]), [
    ['create', 'bad', 'text is required'],
    ['update', 'bad', 'text is required'],
    ['delete', 'bad', 'text is required'],
  ]);
  assert.deepEqual(moveAside(moved.outbox, rejectedId, 'again'), { outbox: moved.outbox, failed: [] });
});
