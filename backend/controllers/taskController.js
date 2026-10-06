import Task from '../models/Task.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { isValidTimeZone, resolveToday } from '../utils/localDate.js';
import { rollOverTasks, markRolledOver } from '../utils/rollover.js';

const DUPLICATE_KEY = 11000;
const UPDATABLE_FIELDS = ['text', 'date', 'time', 'notify', 'notificationId', 'completed', 'priority'];

export const getTasks = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    // Handle rollover: move uncompleted past tasks to the user's local today
    const { localDate, timezone } = req.query;
    const today = resolveToday({ localDate, timezone, storedTimezone: user.timezone });
    const newTimezone = isValidTimeZone(timezone) && timezone !== user.timezone ? timezone : null;

    const rolledOver = await rollOverTasks({ Task, user, today });
    if (rolledOver || newTimezone) {
      await markRolledOver({ User, user, today: rolledOver ? today : null, timezone: newTimezone });
    }

    const tasks = await Task.find({ userId: user._id, deletedAt: null }).sort({ date: 1 });
    res.json(tasks);
  } catch (error) {
    next(error);
  }
};

export const createTask = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const { text, date, priority, time, notify, notificationId, clientId } = req.body;
    
    if (!text || !date) {
      throw new ApiError(400, 'Text and date are required');
    }

    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    const idempotencyKey = typeof clientId === 'string' && clientId ? clientId : undefined;

    const task = new Task({ userId: user._id });
    task.set({
      // Every task has a clientId: it is the id the sync protocol knows it by
      clientId: idempotencyKey ?? String(task._id),
      text,
      date,
      time: time || null,
      notify: notify || false,
      notificationId: notificationId || null,
      priority: priority ?? 'none'
    });
    
    try {
      await task.save();
    } catch (error) {
      // Same clientId again (double submit or retry): hand back the task it already created
      if (error?.code !== DUPLICATE_KEY || !idempotencyKey) throw error;
      const existing = await Task.findOne({ userId: user._id, clientId: idempotencyKey });
      if (!existing) throw error;
      // Created and since deleted: a retry must not bring it back
      if (existing.deletedAt) throw new ApiError(404, 'Task not found');
      return res.status(200).json(existing);
    }
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
};

export const updateTask = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    const { baseVersion } = req.body;
    if (baseVersion !== undefined && !Number.isInteger(baseVersion)) {
      throw new ApiError(400, 'baseVersion must be an integer');
    }

    const changes = {};
    for (const field of UPDATABLE_FIELDS) {
      if (req.body[field] !== undefined) changes[field] = req.body[field];
    }

    const filter = { _id: req.params.id, userId: user._id, deletedAt: null };
    // Optimistic concurrency: only apply on top of the version the client last saw.
    // Tasks saved before `version` existed have no field, which reads as 0.
    if (baseVersion !== undefined) filter.version = baseVersion === 0 ? { $in: [0, null] } : baseVersion;

    const task = await Task.findOneAndUpdate(
      filter,
      { $set: changes, $inc: { version: 1 } },
      { new: true, runValidators: true }
    );

    if (!task) {
      const current = baseVersion === undefined ? null : await Task.findOne({ _id: req.params.id, userId: user._id, deletedAt: null });
      if (!current) throw new ApiError(404, 'Task not found');
      return res.status(409).json({ success: false, error: 'Task was changed elsewhere', task: current });
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
};

export const deleteTask = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    // Soft delete: the tombstone is what tells other devices, and stops a late edit reviving it
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: user._id, deletedAt: null },
      { $set: { deletedAt: new Date() }, $inc: { version: 1 } }
    );
    if (!task) throw new ApiError(404, 'Task not found');
    
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    next(error);
  }
};
