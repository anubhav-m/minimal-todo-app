import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Task from '../models/Task.js';
import { getTasks, createTask, updateTask, deleteTask } from './taskController.js';
import { useDatabase, call, signUp } from '../test/harness.js';

useDatabase();

const newTask = (overrides = {}) => ({ text: 'Call mom', date: '2099-01-01', ...overrides });

test('delete leaves a tombstone that the task list no longer shows', async () => {
  await signUp();
  const { body: task } = await call(createTask, { body: newTask({ clientId: 'c-1' }) });

  const result = await call(deleteTask, { params: { id: task._id } });
  assert.equal(result.status, 200);

  const stored = await Task.findById(task._id);
  assert.ok(stored.deletedAt instanceof Date);
  assert.equal(stored.version, task.version + 1);
  assert.deepEqual((await call(getTasks)).body, []);
});

test('a deleted task cannot be deleted again, edited, or re-created by a retry', async () => {
  await signUp();
  const { body: task } = await call(createTask, { body: newTask({ clientId: 'c-1' }) });
  const params = { id: task._id };
  await call(deleteTask, { params });

  await assert.rejects(call(deleteTask, { params }), { statusCode: 404 });
  await assert.rejects(call(updateTask, { params, body: { completed: true } }), { statusCode: 404 });
  await assert.rejects(call(updateTask, { params, body: { completed: true, baseVersion: 0 } }), { statusCode: 404 });
  await assert.rejects(call(createTask, { body: newTask({ clientId: 'c-1' }) }), { statusCode: 404 });

  const stored = await Task.findById(task._id);
  assert.equal(stored.completed, false);
  assert.equal(await Task.countDocuments(), 1);
});

test('a create without a clientId is given one', async () => {
  await signUp();
  const { body: task } = await call(createTask, { body: newTask() });
  assert.equal(task.clientId, task._id);
});

test('rollover leaves tombstones alone', async () => {
  const user = await signUp();
  const userId = new mongoose.Types.ObjectId(user._id);
  const deletedAt = new Date();
  const { insertedId } = await Task.collection.insertOne({
    userId, text: 'gone', date: '2026-10-01', completed: false, deletedAt, updatedAt: deletedAt, version: 1,
  });

  await call(getTasks, { query: { localDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date()), timezone: 'UTC' } });

  const stored = await Task.findById(insertedId);
  assert.equal(stored.date, '2026-10-01');
  assert.equal(stored.version, 1);
});
