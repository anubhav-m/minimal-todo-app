import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimeZone, localDateInTimeZone, resolveToday } from './localDate.js';
import { rollOverTasks } from './rollover.js';

const IST = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';
const at = (iso) => new Date(iso);

// In-memory stand-in for the Task model; understands only the rollover query.
const fakeTaskModel = (tasks) => ({
  tasks,
  calls: 0,
  async updateMany(filter, update) {
    this.calls++;
    for (const t of tasks) {
      if (t.userId === filter.userId && t.completed === filter.completed && t.date < filter.date.$lt) {
        Object.assign(t, update.$set);
      }
    }
  },
});

const task = (id, date, completed = false) => ({ _id: id, userId: 'u1', date, completed });
const newUser = () => ({ _id: 'u1', lastRolloverDate: null });

test('the day changes at local midnight in IST: 23:59 vs 00:01', () => {
  assert.equal(localDateInTimeZone(IST, at('2026-10-06T18:29:00Z')), '2026-10-06'); // 23:59 IST
  assert.equal(localDateInTimeZone(IST, at('2026-10-06T18:31:00Z')), '2026-10-07'); // 00:01 IST
});

test('UTC midnight is not a day boundary in IST: 05:29 vs 05:31', () => {
  assert.equal(localDateInTimeZone(IST, at('2026-10-06T23:59:00Z')), '2026-10-07'); // 05:29 IST
  assert.equal(localDateInTimeZone(IST, at('2026-10-07T00:01:00Z')), '2026-10-07'); // 05:31 IST
});

test('zones behind UTC do not jump to "tomorrow" at UTC midnight', () => {
  assert.equal(localDateInTimeZone(NEW_YORK, at('2026-10-07T01:00:00Z')), '2026-10-06'); // 21:00 EDT
});

test('local midnight is honoured across DST changes', () => {
  // Spring forward, 8 Mar 2026 (EST, UTC-5 before the change)
  assert.equal(localDateInTimeZone(NEW_YORK, at('2026-03-08T04:59:00Z')), '2026-03-07');
  assert.equal(localDateInTimeZone(NEW_YORK, at('2026-03-08T05:01:00Z')), '2026-03-08');
  // Fall back, 1 Nov 2026 (EDT, UTC-4 before the change)
  assert.equal(localDateInTimeZone(NEW_YORK, at('2026-11-01T03:59:00Z')), '2026-10-31');
  assert.equal(localDateInTimeZone(NEW_YORK, at('2026-11-01T04:01:00Z')), '2026-11-01');
});

test('isValidTimeZone accepts IANA names and rejects junk', () => {
  assert.equal(isValidTimeZone(IST), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(undefined), false);
});

test('resolveToday uses the client local date, not the UTC date', () => {
  const now = at('2026-10-06T18:31:00Z'); // 00:01 IST on the 7th, still the 6th in UTC
  assert.equal(resolveToday({ localDate: '2026-10-07', timezone: IST, now }), '2026-10-07');
  assert.equal(resolveToday({ localDate: '2026-10-07', now }), '2026-10-07'); // older web client: date only
});

test('resolveToday falls back to the timezone when the client date is missing or implausible', () => {
  const now = at('2026-10-06T18:31:00Z');
  assert.equal(resolveToday({ timezone: IST, now }), '2026-10-07');
  assert.equal(resolveToday({ storedTimezone: IST, now }), '2026-10-07'); // client that sends nothing
  assert.equal(resolveToday({ localDate: '2030-01-01', timezone: IST, now }), '2026-10-07');
  assert.equal(resolveToday({ localDate: 'tomorrow', timezone: IST, now }), '2026-10-07');
  assert.equal(resolveToday({ localDate: '2026-10-07', timezone: 'Not/AZone', storedTimezone: IST, now }), '2026-10-07');
});

test('resolveToday tolerates a little clock skew around midnight but no more', () => {
  const justBefore = at('2026-10-06T18:29:30Z'); // server: 23:59:30 IST, client already past midnight
  assert.equal(resolveToday({ localDate: '2026-10-07', timezone: IST, now: justBefore }), '2026-10-07');
  const evening = at('2026-10-06T15:00:00Z'); // 20:30 IST
  assert.equal(resolveToday({ localDate: '2026-10-07', timezone: IST, now: evening }), '2026-10-06');
});

test('resolveToday returns null rather than guessing UTC', () => {
  const now = at('2026-10-06T18:31:00Z');
  assert.equal(resolveToday({ now }), null);
  assert.equal(resolveToday({ localDate: '2030-01-01', now }), null);
});

test('a device timezone change moves "today" with the device', () => {
  const now = at('2026-10-06T20:00:00Z');
  assert.equal(resolveToday({ localDate: '2026-10-07', timezone: IST, storedTimezone: NEW_YORK, now }), '2026-10-07');
  assert.equal(resolveToday({ localDate: '2026-10-06', timezone: NEW_YORK, storedTimezone: IST, now }), '2026-10-06');
});

test('rollover moves incomplete past tasks to today and leaves the rest', async () => {
  const Task = fakeTaskModel([
    task('past', '2026-10-06'),
    task('past-done', '2026-10-06', true),
    task('today', '2026-10-07'),
    task('future', '2026-10-09'),
    { ...task('someone-else', '2026-10-06'), userId: 'u2' },
  ]);
  const user = newUser();

  assert.equal(await rollOverTasks({ Task, user, today: '2026-10-07' }), true);
  assert.deepEqual(Task.tasks.map(t => t.date), ['2026-10-07', '2026-10-06', '2026-10-07', '2026-10-09', '2026-10-06']);
  assert.equal(user.lastRolloverDate, '2026-10-07');
});

test('rollover catches up after the app was closed for 3 days', async () => {
  const Task = fakeTaskModel([task('a', '2026-10-03'), task('b', '2026-10-04'), task('c', '2026-10-05')]);
  const user = { ...newUser(), lastRolloverDate: '2026-10-03' };

  await rollOverTasks({ Task, user, today: '2026-10-06' });
  assert.deepEqual(Task.tasks.map(t => t.date), ['2026-10-06', '2026-10-06', '2026-10-06']);
  assert.equal(Task.tasks.length, 3);
});

test('running rollover twice changes nothing the second time', async () => {
  const Task = fakeTaskModel([task('a', '2026-10-05'), task('b', '2026-10-06', true)]);
  const user = newUser();

  await rollOverTasks({ Task, user, today: '2026-10-07' });
  const afterFirst = structuredClone(Task.tasks);
  assert.equal(await rollOverTasks({ Task, user, today: '2026-10-07' }), false);

  assert.deepEqual(Task.tasks, afterFirst);
  assert.equal(Task.calls, 1);
});

test('rollover does nothing without a trusted today, or when today goes backwards', async () => {
  const Task = fakeTaskModel([task('a', '2026-10-05')]);
  const user = newUser();
  assert.equal(await rollOverTasks({ Task, user, today: null }), false);
  assert.equal(Task.tasks[0].date, '2026-10-05');

  await rollOverTasks({ Task, user, today: '2026-10-07' });
  // Flew west: local date is the 6th again
  assert.equal(await rollOverTasks({ Task, user, today: '2026-10-06' }), false);
  assert.equal(Task.tasks[0].date, '2026-10-07');
  assert.equal(user.lastRolloverDate, '2026-10-07');
});
