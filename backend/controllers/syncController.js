import Task, { TOMBSTONE_TTL_DAYS } from '../models/Task.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { isValidTimeZone, resolveToday } from '../utils/localDate.js';
import { rollOverTasks, markRolledOver } from '../utils/rollover.js';
import { isValidId, pickTaskFields } from '../utils/taskValidation.js';

const DUPLICATE_KEY = 11000;
const DAY = 24 * 60 * 60 * 1000;

export const MAX_OPS = 100;
// How many operation ids a task remembers, to recognise a replay
const APPLIED_OPS_KEPT = 20;
// The cursor handed out is this far behind our clock. A write stamps updatedAt
// just before it commits, so one that lands right after the pull's read could
// otherwise carry a time the cursor has already passed. Rows seen twice are harmless.
const CURSOR_OVERLAP_MS = 5000;
// A device away for longer than this may have missed tombstones that were
// already purged, so it is sent everything instead of a delta.
const MAX_CURSOR_AGE_MS = (TOMBSTONE_TTL_DAYS - 30) * DAY;

const rejected = (error) => ({ status: 'rejected', error });

// Each of these is a single atomic write and gives the same result when the
// same operation arrives again, so a batch can be replayed in full after a
// lost response.
//   applied   - done now
//   duplicate - already done by an earlier delivery of this operation
//   gone      - the task is deleted (or was never here); nothing to do, ever
//   rejected  - will never be accepted; the client must stop sending it
const applyCreate = async (userId, op) => {
  const { fields, error } = pickTaskFields(op.payload, ['text', 'date']);
  if (error) return rejected(error);
  try {
    await Task.create({ ...fields, userId, clientId: op.taskId, appliedOps: [op.id] });
    return { status: 'applied' };
  } catch (err) {
    // Already created - by this operation earlier, or deleted since. Either way it is not created again.
    if (err?.code === DUPLICATE_KEY) return { status: 'duplicate' };
    throw err;
  }
};

// Sets only the fields the operation names, so changes to other fields made
// elsewhere survive. For the same field, the last operation to arrive wins.
const applyUpdate = async (userId, op) => {
  const { fields, error } = pickTaskFields(op.payload);
  if (error) return rejected(error);

  const task = { userId, clientId: op.taskId };
  if (Object.keys(fields).length > 0) {
    const updated = await Task.findOneAndUpdate(
      // Delete wins over edit; and an operation already applied is not applied twice,
      // which would overwrite whatever another device changed in between
      { ...task, deletedAt: null, appliedOps: { $ne: op.id } },
      {
        $set: fields,
        $inc: { version: 1 },
        $push: { appliedOps: { $each: [op.id], $slice: -APPLIED_OPS_KEPT } },
      },
      { runValidators: true }
    );
    if (updated) return { status: 'applied' };
  }

  const existing = await Task.findOne({ ...task, deletedAt: null }).select('_id');
  return { status: existing ? 'duplicate' : 'gone' };
};

const applyDelete = async (userId, op) => {
  const deleted = await Task.findOneAndUpdate(
    { userId, clientId: op.taskId, deletedAt: null },
    { $set: { deletedAt: new Date() }, $inc: { version: 1 } }
  );
  return { status: deleted ? 'applied' : 'duplicate' };
};

const APPLY = { create: applyCreate, update: applyUpdate, delete: applyDelete };

const applyOp = async (userId, op) => {
  if (!op || typeof op !== 'object' || !isValidId(op.id) || !isValidId(op.taskId) || !Object.hasOwn(APPLY, op.type)) {
    return rejected('Malformed operation');
  }
  try {
    return await APPLY[op.type](userId, op);
  } catch (err) {
    if (err?.name === 'ValidationError' || err?.name === 'CastError') return rejected(err.message);
    throw err;
  }
};

// Tasks made before clientId existed get one, so every task can be addressed by it
const backfillClientIds = (userId) =>
  Task.collection.updateMany(
    { userId, clientId: { $exists: false } },
    [{ $set: { clientId: { $toString: '$_id' } } }]
  );

const parseCursor = (cursor, now) => {
  if (typeof cursor !== 'string') return null;
  const since = new Date(cursor);
  if (isNaN(since.getTime()) || now.getTime() - since.getTime() > MAX_CURSOR_AGE_MS) return null;
  return since;
};

// One round trip for both directions: applies the client's queued operations in
// order, runs rollover, then returns everything that changed since `cursor`.
export const syncTasks = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const { ops = [], cursor, localDate, timezone } = req.body ?? {};
    if (!Array.isArray(ops)) throw new ApiError(400, 'ops must be an array');
    if (ops.length > MAX_OPS) throw new ApiError(413, `At most ${MAX_OPS} operations per request`);

    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    await backfillClientIds(user._id);

    const results = [];
    for (const op of ops) {
      results.push({ id: op?.id, ...(await applyOp(user._id, op)) });
    }

    // After the operations, so a task completed offline is not moved to today first
    const today = resolveToday({ localDate, timezone, storedTimezone: user.timezone });
    const newTimezone = isValidTimeZone(timezone) && timezone !== user.timezone ? timezone : null;
    const wroteTasks = results.some(r => r.status === 'applied');
    const rolledOver = await rollOverTasks({ Task, user, today, force: wroteTasks });
    if (rolledOver || newTimezone) {
      await markRolledOver({ User, user, today: rolledOver ? today : null, timezone: newTimezone });
    }

    const now = new Date();
    const since = parseCursor(cursor, now);
    const changes = await Task.find(
      since
        ? { userId: user._id, updatedAt: { $gt: since } } // tombstones included
        : { userId: user._id, deletedAt: null }
    ).sort({ createdAt: 1 });

    res.json({
      results,
      changes,
      cursor: new Date(now.getTime() - CURSOR_OVERLAP_MS).toISOString(),
      // The client replaces what it holds instead of merging into it
      fullResync: !since,
    });
  } catch (error) {
    next(error);
  }
};
