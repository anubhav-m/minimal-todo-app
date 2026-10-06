// Catch-up rollover: moves every incomplete task dated before `today` onto `today`.
// Runs at most once per user per local day (user.lastRolloverDate), and never
// moves anything backwards if "today" goes back (e.g. the user travels west).
// Mutates `user`; the caller persists it with markRolledOver. Returns whether a rollover ran.
export const rollOverTasks = async ({ Task, user, today }) => {
  if (!today) return false;
  if (user.lastRolloverDate && user.lastRolloverDate >= today) return false;

  await Task.updateMany(
    { userId: user._id, completed: false, date: { $lt: today } },
    { $set: { date: today }, $inc: { version: 1 } }
  );
  user.lastRolloverDate = today;
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
