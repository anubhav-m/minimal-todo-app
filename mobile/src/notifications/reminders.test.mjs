import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelTaskReminder,
  createReminderQueue,
  getReminderDate,
  reconcileReminders,
  scheduleMissingReminders,
  syncTaskReminder,
} from './reminders.ts';

const NOW = new Date(2026, 9, 6, 9, 0, 0); // 6 Oct 2026, 09:00 local

const task = (overrides = {}) => ({
  _id: 't1',
  text: 'Call mom',
  date: '2026-10-06',
  time: '6:00 PM',
  notify: true,
  completed: false,
  notificationId: 'n1',
  ...overrides,
});

// In-memory stand-in for the OS notification scheduler.
const fakeApi = (initial = []) => {
  const scheduled = new Map(initial.map(r => [r.identifier, r]));
  return {
    scheduled,
    failCancel: false,
    async schedule({ identifier, body, data }) {
      scheduled.set(identifier, { identifier, body, data });
    },
    async cancel(identifier) {
      if (this.failCancel) throw new Error('native cancel failed');
      scheduled.delete(identifier);
    },
    async getAllScheduled() {
      return [...scheduled.values()];
    },
  };
};

const scheduledFor = (t) => ({
  identifier: t.notificationId,
  body: t.text,
  data: { taskId: t._id, fireAt: getReminderDate(t).getTime() },
});

beforeEach((t) => t.mock.method(console, 'error', () => {}));

test('getReminderDate reads date + time as local time', () => {
  assert.deepEqual(getReminderDate(task()), new Date(2026, 9, 6, 18, 0, 0));
  assert.deepEqual(getReminderDate(task({ time: '12:05 AM' })), new Date(2026, 9, 6, 0, 5, 0));
  assert.equal(getReminderDate(task({ time: null })), null);
  assert.equal(getReminderDate(task({ time: 'garbage' })), null);
});

test('sync schedules under the id stored on the task, tagged with the task id', async () => {
  const api = fakeApi();
  assert.equal(await syncTaskReminder(api, task(), NOW), true);
  assert.deepEqual([...api.scheduled.keys()], ['n1']);
  assert.equal(api.scheduled.get('n1').data.taskId, 't1');
});

test('sync does not schedule for completed, notify-off, past or id-less tasks', async () => {
  for (const t of [
    task({ completed: true }),
    task({ notify: false }),
    task({ time: null }),
    task({ time: '8:00 AM' }), // already passed at NOW
    task({ notificationId: null }),
  ]) {
    const api = fakeApi();
    assert.equal(await syncTaskReminder(api, t, NOW), false);
    assert.equal(api.scheduled.size, 0);
  }
});

test('sync after a time change replaces the old reminder instead of adding one', async () => {
  const api = fakeApi();
  await syncTaskReminder(api, task(), NOW);
  await syncTaskReminder(api, task({ time: '7:30 PM' }), NOW);
  assert.equal(api.scheduled.size, 1);
  assert.equal(api.scheduled.get('n1').data.fireAt, new Date(2026, 9, 6, 19, 30).getTime());
});

test('sync on a completed task removes its reminder', async () => {
  const api = fakeApi([scheduledFor(task())]);
  await syncTaskReminder(api, task({ completed: true }), NOW);
  assert.equal(api.scheduled.size, 0);
});

test('cancel removes the reminder', async () => {
  const api = fakeApi([scheduledFor(task())]);
  assert.equal(await cancelTaskReminder(api, task()), true);
  assert.equal(api.scheduled.size, 0);
});

test('cancel swallows native errors and tolerates tasks without an id', async () => {
  const api = fakeApi([scheduledFor(task())]);
  api.failCancel = true;
  assert.equal(await cancelTaskReminder(api, task()), false);
  assert.equal(await cancelTaskReminder(api, task({ notificationId: undefined })), false);
});

test('reconcile keeps reminders that still match a live task', async () => {
  const api = fakeApi([scheduledFor(task())]);
  assert.deepEqual(await reconcileReminders(api, [task()]), []);
  assert.equal(api.scheduled.size, 1);
});

test('reconcile cancels reminders for deleted, completed and notify-off tasks', async () => {
  const deleted = task({ _id: 'gone', notificationId: 'n-gone' });
  const done = task({ _id: 'done', notificationId: 'n-done' });
  const muted = task({ _id: 'muted', notificationId: 'n-muted' });
  const live = task();
  const api = fakeApi([deleted, done, muted, live].map(scheduledFor));

  const cancelled = await reconcileReminders(api, [
    { ...done, completed: true },
    { ...muted, notify: false },
    live,
  ]);

  assert.deepEqual(cancelled.sort(), ['n-done', 'n-gone', 'n-muted']);
  assert.deepEqual([...api.scheduled.keys()], ['n1']);
});

test('reconcile cancels a reminder whose task was rolled over or rescheduled', async () => {
  const api = fakeApi([scheduledFor(task())]);
  assert.deepEqual(await reconcileReminders(api, [task({ date: '2026-10-07' })]), ['n1']);
});

test('a rolled-over task gets its reminder moved to the new day, exactly once', async () => {
  const api = fakeApi([scheduledFor(task())]);
  const rolled = task({ date: '2026-10-07' });
  const midnight = new Date(2026, 9, 7, 0, 0, 1);

  await reconcileReminders(api, [rolled]);
  assert.deepEqual(await scheduleMissingReminders(api, [rolled], midnight), ['n1']);
  assert.equal(api.scheduled.get('n1').data.fireAt, new Date(2026, 9, 7, 18, 0).getTime());

  // Second catch-up run (foreground right after the midnight timer) adds nothing
  assert.deepEqual(await reconcileReminders(api, [rolled]), []);
  assert.deepEqual(await scheduleMissingReminders(api, [rolled], midnight), []);
  assert.equal(api.scheduled.size, 1);
});

test('scheduleMissingReminders skips tasks that should not or cannot remind', async () => {
  const api = fakeApi();
  const added = await scheduleMissingReminders(api, [
    task({ _id: 'done', notificationId: 'n-done', completed: true }),
    task({ _id: 'muted', notificationId: 'n-muted', notify: false }),
    task({ _id: 'past', notificationId: 'n-past', time: '8:00 AM' }),
    task({ _id: 'web', notificationId: null }),
  ], NOW);
  assert.deepEqual(added, []);
  assert.equal(api.scheduled.size, 0);

  api.getAllScheduled = async () => { throw new Error('native read failed'); };
  assert.deepEqual(await scheduleMissingReminders(api, [task()], NOW), []);
});

test('reconcile handles reminders scheduled before they carried a task id', async () => {
  const api = fakeApi([
    { identifier: 'old-live', body: 'Call mom', data: {} },
    { identifier: 'old-orphan', body: 'Deleted long ago', data: null },
  ]);
  assert.deepEqual(await reconcileReminders(api, [task({ notificationId: null })]), ['old-orphan']);
});

test('reconcile survives native failures', async () => {
  const api = fakeApi([scheduledFor(task({ _id: 'gone' }))]);
  api.failCancel = true;
  assert.deepEqual(await reconcileReminders(api, []), []);

  api.getAllScheduled = async () => { throw new Error('native read failed'); };
  assert.deepEqual(await reconcileReminders(api, []), []);
});

// --- ordering: reminder operations that overlap -------------------------------

// Like fakeApi, but every native call takes a turn of the event loop, so
// operations that are not serialized really do interleave.
const slowApi = (initial = []) => {
  const api = fakeApi(initial);
  const slow = (fn) => async (...args) => {
    await new Promise(resolve => setImmediate(resolve));
    return fn.apply(api, args);
  };
  api.calls = [];
  const { schedule, cancel, getAllScheduled } = api;
  api.schedule = slow((r) => { api.calls.push(`schedule ${r.identifier}`); return schedule.call(api, r); });
  api.cancel = slow((id) => { api.calls.push(`cancel ${id}`); return cancel.call(api, id); });
  api.getAllScheduled = slow(getAllScheduled);
  return api;
};

test('un-complete then complete in quick succession leaves no reminder', async () => {
  const api = slowApi();
  const queue = createReminderQueue(api, () => [], () => NOW);

  // Unqueued, the second call's cancel runs before the first call's schedule
  await Promise.all([queue.sync(task({ completed: false })), queue.sync(task({ completed: true }))]);

  assert.equal(api.scheduled.size, 0);
  assert.deepEqual(api.calls, ['cancel n1', 'schedule n1', 'cancel n1']);
});

test('completing a task during reconciliation does not get its reminder scheduled back', async () => {
  const api = slowApi();
  const screen = { tasks: [task(), task({ _id: 't2', notificationId: 'n2', text: 'Pay rent' })] };
  const queue = createReminderQueue(api, () => screen.tasks, () => NOW);

  const reconciling = queue.reconcile(); // list just refreshed: both tasks want a reminder
  // ...and the user ticks t1 before reconciliation has had its turn
  screen.tasks = [task({ completed: true }), screen.tasks[1]];
  const completing = queue.sync(screen.tasks[0]);
  await Promise.all([reconciling, completing]);

  assert.deepEqual([...api.scheduled.keys()], ['n2']);
});

test('deleting a task during reconciliation does not leave an orphan reminder', async () => {
  const api = slowApi([scheduledFor(task())]);
  const screen = { tasks: [task()] };
  const queue = createReminderQueue(api, () => screen.tasks, () => NOW);

  const reconciling = queue.reconcile();
  const deleted = screen.tasks[0];
  screen.tasks = [];
  await Promise.all([reconciling, queue.cancel(deleted)]);

  assert.equal(api.scheduled.size, 0);
});

test('overlapping reconciliations run as one and schedule each reminder once', async () => {
  const api = slowApi();
  const screen = { tasks: [task(), task({ _id: 't2', notificationId: 'n2', text: 'Pay rent' })] };
  const queue = createReminderQueue(api, () => screen.tasks, () => NOW);

  await Promise.all([queue.reconcile(), queue.reconcile(), queue.reconcile()]);

  assert.deepEqual(api.calls.filter(c => c.startsWith('schedule')), ['schedule n1', 'schedule n2']);
  assert.deepEqual([...api.scheduled.keys()], ['n1', 'n2']);

  await queue.reconcile(); // a later request runs again, and finds nothing to do
  assert.equal(api.calls.filter(c => c.startsWith('schedule')).length, 2);
});

test('reconciliation is skipped after sign-out, and a failed job does not block the queue', async () => {
  const api = slowApi([scheduledFor(task())]);
  const queue = createReminderQueue(api, () => null, () => NOW);
  await queue.reconcile();
  assert.equal(api.scheduled.size, 1, 'left alone: there is no task list to judge it against');

  api.cancel = async () => { throw new Error('native cancel failed'); };
  await queue.cancel(task());
  api.schedule = async () => { throw new Error('native schedule failed'); };
  assert.equal(await queue.sync(task()), false);
});

// --- offline: tasks are known by clientId ------------------------------------

test('a task made offline (no _id yet) gets a reminder linked by its clientId', async () => {
  const api = fakeApi();
  const offline = task({ _id: undefined, clientId: 'c1', notificationId: 'reminder-c1' });

  assert.equal(await syncTaskReminder(api, offline, NOW), true);
  assert.equal(api.scheduled.get('reminder-c1').data.taskId, 'c1');
  // Still there after the server has given the task an _id
  assert.deepEqual(await reconcileReminders(api, [{ ...offline, _id: 'mongo-1' }]), []);
  assert.equal(api.scheduled.size, 1);
});

test('a reminder scheduled by an earlier build (linked by _id) is kept after the upgrade', async () => {
  const legacy = task({ clientId: 'c1' });
  const api = fakeApi();
  await syncTaskReminder(api, task(), NOW); // linked by _id 't1'

  assert.deepEqual(await reconcileReminders(api, [legacy]), []);
  assert.deepEqual(await scheduleMissingReminders(api, [legacy], NOW), []);
  assert.equal(api.scheduled.size, 1);
});
