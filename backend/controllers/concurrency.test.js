import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { markRolledOver } from '../utils/rollover.js';
import { googleLogin } from './authController.js';
import { getTasks, createTask, updateTask } from './taskController.js';

// These run the real controllers against a real mongod, because what is being
// proved (unique indexes, conditional updates) is MongoDB's behaviour, not ours.
let mongod;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([Task.deleteMany({}), User.deleteMany({})]);
  await Promise.all([Task.init(), User.init()]); // unique indexes in place before racing
});

const GOOGLE_USER = { sub: 'g-1', email: 'a@example.com', name: 'A' };
const plain = (value) => JSON.parse(JSON.stringify(value));

// Calls a controller the way Express would and resolves with what it answered.
const call = (handler, { body = {}, params = {}, query = {} } = {}) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: plain(payload) }); },
    };
    handler({ user: GOOGLE_USER, body, params, query }, res, reject);
  });

const signUp = async () => (await call(googleLogin)).body.user;
const newTask = (overrides = {}) => ({ text: 'Call mom', date: '2026-10-06', ...overrides });
const todayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

test('concurrent first logins create one user and all succeed', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => call(googleLogin)));

  assert.equal(await User.countDocuments(), 1);
  assert.deepEqual([...new Set(results.map(r => r.status))], [200]);
  assert.equal(new Set(results.map(r => r.body.user._id)).size, 1);
});

test('the same create sent concurrently makes exactly one task', async () => {
  await signUp();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => call(createTask, { body: newTask({ clientId: 'c-1' }) }))
  );

  assert.equal(await Task.countDocuments(), 1);
  assert.equal(new Set(results.map(r => r.body._id)).size, 1);
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 200).length, 9);
});

test('a retried create returns the original task; different clientIds stay separate', async () => {
  await signUp();
  const first = await call(createTask, { body: newTask({ clientId: 'c-1' }) });
  const retry = await call(createTask, { body: newTask({ clientId: 'c-1' }) });
  const other = await call(createTask, { body: newTask({ clientId: 'c-2' }) });

  assert.equal(retry.body._id, first.body._id);
  assert.notEqual(other.body._id, first.body._id);
  assert.equal(await Task.countDocuments(), 2);
});

test('creates without a clientId are never merged', async () => {
  await signUp();
  await Promise.all([call(createTask, { body: newTask() }), call(createTask, { body: newTask() })]);
  assert.equal(await Task.countDocuments(), 2);
});

test('two updates from the same version: one wins, the other gets 409 with the current task', async () => {
  await signUp();
  const { body: task } = await call(createTask, { body: newTask({ clientId: 'c-1' }) });
  const params = { id: task._id };

  const results = await Promise.all([
    call(updateTask, { params, body: { completed: true, baseVersion: task.version } }),
    call(updateTask, { params, body: { text: 'Call dad', baseVersion: task.version } }),
  ]);

  const winner = results.find(r => r.status === 200);
  const loser = results.find(r => r.status === 409);
  assert.ok(winner && loser, `expected one 200 and one 409, got ${results.map(r => r.status)}`);

  const stored = plain(await Task.findById(task._id));
  assert.equal(stored.version, task.version + 1);
  assert.deepEqual(loser.body.task, stored);
  assert.deepEqual(winner.body, stored);
});

test('ten concurrent updates from one version: exactly one applies', async () => {
  await signUp();
  const { body: task } = await call(createTask, { body: newTask({ clientId: 'c-1' }) });

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      call(updateTask, { params: { id: task._id }, body: { text: `edit ${i}`, baseVersion: 0 } }))
  );

  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 9);
  assert.equal((await Task.findById(task._id)).version, 1);
});

test('a task saved before version existed accepts baseVersion 0', async () => {
  const user = await signUp();
  const { insertedId } = await Task.collection.insertOne({
    userId: new mongoose.Types.ObjectId(user._id), text: 'Old', date: '2026-10-06', completed: false,
  });

  const result = await call(updateTask, { params: { id: String(insertedId) }, body: { completed: true, baseVersion: 0 } });
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
});

test('update ignores fields a client must not set and validates the rest', async () => {
  const user = await signUp();
  const { body: task } = await call(createTask, { body: newTask() });
  const params = { id: task._id };

  const result = await call(updateTask, { params, body: { completed: true, userId: new mongoose.Types.ObjectId(), version: 99 } });
  assert.equal(result.body.userId, user._id);
  assert.equal(result.body.version, 1);

  await assert.rejects(call(updateTask, { params, body: { priority: 'urgent' } }), { name: 'ValidationError' });
  await assert.rejects(call(updateTask, { params, body: { completed: true, baseVersion: '1' } }), { statusCode: 400 });
});

test('overlapping rollovers leave each task on today and record the day once', async () => {
  const user = await signUp();
  await Task.create([
    { userId: user._id, text: 'overdue', date: '2026-10-01' },
    { userId: user._id, text: 'done', date: '2026-10-01', completed: true },
    { userId: user._id, text: 'future', date: '2099-01-01' },
  ]);
  const today = todayIn('Asia/Kolkata');

  const results = await Promise.all(
    Array.from({ length: 6 }, () => call(getTasks, { query: { localDate: today, timezone: 'Asia/Kolkata' } }))
  );

  for (const { body } of results) {
    const byText = Object.fromEntries(body.map(t => [t.text, t.date]));
    assert.deepEqual(byText, { overdue: today, done: '2026-10-01', future: '2099-01-01' });
  }
  const stored = await User.findById(user._id);
  assert.equal(stored.lastRolloverDate, today);
  assert.equal(stored.timezone, 'Asia/Kolkata');
});

test('a rollover racing a completion keeps the completion', async () => {
  const user = await signUp();
  const [task] = await Task.create([{ userId: user._id, text: 'overdue', date: '2026-10-01' }]);
  const today = todayIn('UTC');

  await Promise.all([
    call(getTasks, { query: { localDate: today, timezone: 'UTC' } }),
    call(updateTask, { params: { id: String(task._id) }, body: { completed: true } }),
  ]);

  const stored = await Task.findById(task._id);
  assert.equal(stored.completed, true);
  assert.ok(stored.date === today || stored.date === '2026-10-01');
});

test('lastRolloverDate never moves backwards when an earlier "today" is written last', async () => {
  const user = await signUp();
  const doc = await User.findById(user._id);

  await Promise.all([
    markRolledOver({ User, user: doc, today: '2026-10-07' }),
    markRolledOver({ User, user: doc, today: '2026-10-06' }),
  ]);
  await markRolledOver({ User, user: doc, today: '2026-10-05' });

  assert.equal((await User.findById(user._id)).lastRolloverDate, '2026-10-07');
});
