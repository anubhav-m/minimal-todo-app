import { parse } from 'date-fns';

// Reminder scheduling/cancel logic. Kept free of expo/react-native imports so it
// can run under `npm test`; the native calls are injected (see reminderApi.ts).

export interface ReminderTask {
  // The id every device knows the task by. A task made offline has no _id yet.
  clientId?: string;
  _id?: string;
  text: string;
  date: string; // yyyy-MM-dd
  time?: string | null; // h:mm a
  notify?: boolean;
  completed: boolean;
  notificationId?: string | null;
}

export interface ScheduledReminder {
  identifier: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
}

export interface ReminderApi {
  schedule(reminder: {
    identifier: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    date: Date;
  }): Promise<unknown>;
  cancel(identifier: string): Promise<void>;
  getAllScheduled(): Promise<ScheduledReminder[]>;
}

// Local-time moment the task's reminder should fire, or null if it has no usable time.
export const getReminderDate = (task: ReminderTask): Date | null => {
  if (!task.time) return null;
  const parsed = parse(`${task.date} ${task.time}`, 'yyyy-MM-dd h:mm a', new Date());
  return isNaN(parsed.getTime()) ? null : parsed;
};

// Reminders scheduled by earlier builds carry the server's _id instead of the clientId
const taskKey = (task: ReminderTask) => task.clientId ?? task._id;

const wantsReminder = (task: ReminderTask) => !task.completed && !!task.notify && !!task.time;

// Never throws: a failed cancel must not block the delete/complete it belongs to.
export const cancelTaskReminder = async (api: ReminderApi, task: ReminderTask): Promise<boolean> => {
  if (!task.notificationId) return false;
  try {
    await api.cancel(task.notificationId);
    return true;
  } catch (e) {
    console.error('Failed to cancel notification', e);
    return false;
  }
};

// Makes the scheduled reminder match the task: always drops the old one, then
// schedules again only if the task still wants a reminder in the future.
// Use this for create, un-complete, rollback and any time/date change.
export const syncTaskReminder = async (
  api: ReminderApi,
  task: ReminderTask,
  now: Date = new Date()
): Promise<boolean> => {
  await cancelTaskReminder(api, task);

  const fireAt = getReminderDate(task);
  if (!task.notificationId || !wantsReminder(task) || !fireAt || fireAt.getTime() <= now.getTime()) {
    return false;
  }

  try {
    await api.schedule({
      identifier: task.notificationId,
      title: 'Todo Reminder',
      body: task.text,
      data: { taskId: taskKey(task), fireAt: fireAt.getTime() },
      date: fireAt,
    });
    return true;
  } catch (e) {
    console.error('Failed to schedule notification', e);
    return false;
  }
};

// Counterpart to reconcileReminders: schedules the reminders the task list calls
// for but this device does not have at the right moment - e.g. a task rolled over
// to today keeps its time, so its reminder moves to today.
export const scheduleMissingReminders = async (
  api: ReminderApi,
  tasks: ReminderTask[],
  now: Date = new Date()
): Promise<string[]> => {
  let scheduled: ScheduledReminder[];
  try {
    scheduled = await api.getAllScheduled();
  } catch (e) {
    console.error('Failed to read scheduled notifications', e);
    return [];
  }

  const fireAtByIdentifier = new Map(scheduled.map(r => [r.identifier, r.data?.fireAt]));
  const added: string[] = [];

  for (const task of tasks) {
    const fireAt = getReminderDate(task);
    if (!task.notificationId || !wantsReminder(task) || !fireAt) continue;
    if (fireAtByIdentifier.get(task.notificationId) === fireAt.getTime()) continue;
    if (await syncTaskReminder(api, task, now)) added.push(task.notificationId);
  }

  return added;
};

// Safety net: cancels every scheduled reminder that the given (freshly fetched)
// task list no longer justifies - task deleted, completed, notify turned off, or
// moved to another date/time. Only call with a list that was loaded successfully.
export const reconcileReminders = async (
  api: ReminderApi,
  tasks: ReminderTask[]
): Promise<string[]> => {
  let scheduled: ScheduledReminder[];
  try {
    scheduled = await api.getAllScheduled();
  } catch (e) {
    console.error('Failed to read scheduled notifications', e);
    return [];
  }

  const tasksById = new Map<string, ReminderTask>();
  for (const task of tasks) {
    if (task._id) tasksById.set(task._id, task);
    if (task.clientId) tasksById.set(task.clientId, task);
  }
  const cancelled: string[] = [];

  for (const reminder of scheduled) {
    const taskId = reminder.data?.taskId;
    let keep: boolean;

    if (typeof taskId === 'string') {
      const task = tasksById.get(taskId);
      keep = !!task && wantsReminder(task) && getReminderDate(task)?.getTime() === reminder.data?.fireAt;
    } else {
      // Scheduled before reminders were linked to tasks: the body is all we have.
      keep = tasks.some(t => wantsReminder(t) && t.text === reminder.body);
    }

    if (keep) continue;
    try {
      await api.cancel(reminder.identifier);
      cancelled.push(reminder.identifier);
    } catch (e) {
      console.error('Failed to cancel stale notification', e);
    }
  }

  return cancelled;
};

// Runs every reminder operation one at a time, in the order it was requested.
// Without this a reconciliation, or the cancel-then-schedule inside a sync, can
// interleave with the cancel from a tap and leave a reminder on a task that was
// just completed or deleted.
// getTasks returns the list as it is on screen now (null once signed out);
// reconciliation reads it when its turn comes, not when it was requested.
export const createReminderQueue = (
  api: ReminderApi,
  getTasks: () => ReminderTask[] | null,
  now: () => Date = () => new Date()
) => {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job);
    tail = result.catch(() => undefined);
    return result;
  };
  let queuedReconcile: Promise<void> | null = null;

  return {
    sync: (task: ReminderTask) => enqueue(() => syncTaskReminder(api, task, now())),
    cancel: (task: ReminderTask) => enqueue(() => cancelTaskReminder(api, task)),
    // Requests made while one is still waiting its turn are folded into it.
    reconcile: (): Promise<void> => {
      queuedReconcile ??= enqueue(async () => {
        queuedReconcile = null;
        const tasks = getTasks();
        if (!tasks) return;
        await reconcileReminders(api, tasks);
        const latest = getTasks();
        if (latest) await scheduleMissingReminders(api, latest, now());
      });
      return queuedReconcile;
    },
  };
};
