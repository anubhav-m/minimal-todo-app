// Catch-up rollover: moves every incomplete task dated before `today` onto `today`.
// Runs at most once per user per local day (user.lastRolloverDate), and never
// moves anything backwards if "today" goes back (e.g. the user travels west).
// `force` skips the once-a-day check: a sync that just applied operations made
// offline may have added overdue tasks after today's rollover already ran.
// Mutates `user`; the caller persists it with markRolledOver. Returns whether a rollover ran.
export const rollOverTasks = async ({ Task, user, today, force = false }) => {
  if (!today) return false;
  if (!force && user.lastRolloverDate && user.lastRolloverDate >= today) return false;

  await Task.updateMany(
    { userId: user._id, completed: false, deletedAt: null, date: { $lt: today } },
    { $set: { date: today }, $inc: { version: 1 } }
  );
  if (!user.lastRolloverDate || user.lastRolloverDate < today) user.lastRolloverDate = today;
  return true;
};

// Records the rollover day with $max, so overlapping requests (two devices, a
// timer and a foreground refresh) can only ever move lastRolloverDate forwards.
export const markRolledOver = ({ User, user, today, timezone }) =>
  User.updateOne(
    { _id: user._id },
    {
      ...(today ? { $max: { lastRolloverDate: today } } : {}),
      ...(timezone ? { $set: { timezone } } : {})
    }
  );
