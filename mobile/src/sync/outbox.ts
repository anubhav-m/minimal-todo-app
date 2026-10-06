// The offline data model: what is kept on the device and how the task list on
// screen is worked out from it. Kept free of react/expo imports so it can run
// under `npm test`.
//
//   base   - the last copy of each task the server sent, keyed by clientId
//   outbox - the user's changes the server has not confirmed yet, in order
//
// The screen never stores a list of its own. It shows `base` with the outbox
// applied on top, so a pull can replace `base` freely without undoing anything
// the user just did, and dropping an operation undoes exactly that operation.

export interface TaskFields {
  text: string;
  date: string; // yyyy-MM-dd
  time: string | null; // h:mm a
  notify: boolean;
  notificationId: string | null;
  completed: boolean;
  priority: string;
}

export interface Task extends TaskFields {
  // The task's identity on every device; chosen by whichever one created it
  clientId: string;
  _id?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export type OpType = 'create' | 'update' | 'delete';

export interface Op {
  // Identifies this operation to the server, so a replay is recognised
  id: string;
  type: OpType;
  taskId: string; // the task's clientId
  // create: the whole task. update: only the fields that changed. delete: empty.
  payload: Partial<TaskFields>;
  createdAt: number; // device clock; for display only, never used to settle a conflict
  attempts: number; // times it has been sent
}

export interface FailedOp extends Op {
  error: string;
}

export type Base = Record<string, Task>;

const isUnsent = (op: Op) => op.attempts === 0;

// Adds an operation, folding it into earlier ones for the same task where that
// cannot change the outcome. Only operations that were never sent are touched:
// one that was sent may already have reached the server.
export const enqueue = (outbox: Op[], op: Op): Op[] => {
  const forTask = outbox.filter(o => o.taskId === op.taskId);
  const last = forTask[forTask.length - 1];
  // Already deleted here; nothing after that can matter
  if (last?.type === 'delete') return outbox;

  if (op.type === 'update') {
    // Ten taps on one checkbox are one operation
    if (last && isUnsent(last)) {
      return outbox.map(o => (o === last ? { ...o, payload: { ...o.payload, ...op.payload } } : o));
    }
    return [...outbox, op];
  }

  if (op.type === 'delete') {
    // Created and deleted without the server ever hearing of it: send nothing
    if (forTask[0]?.type === 'create' && isUnsent(forTask[0])) {
      return outbox.filter(o => o.taskId !== op.taskId);
    }
    return [...outbox.filter(o => o.taskId !== op.taskId || !isUnsent(o)), op];
  }

  return [...outbox, op];
};

const DEFAULTS: TaskFields = {
  text: '',
  date: '',
  time: null,
  notify: false,
  notificationId: null,
  completed: false,
  priority: 'none',
};

// `base` with the outbox applied: the task list as the user has left it.
// Server-known tasks come first in the order they were created, then tasks
// that so far exist only on this device, in the order they were added.
export const applyOutbox = (base: Base, outbox: Op[]): Task[] => {
  const tasks = new Map<string, Task>();
  const known = Object.values(base).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  for (const task of known) tasks.set(task.clientId, task);

  for (const op of outbox) {
    const current = tasks.get(op.taskId);
    if (op.type === 'delete') {
      tasks.delete(op.taskId);
    } else if (op.type === 'create') {
      // Once the server has it, its copy is the starting point
      if (!current) tasks.set(op.taskId, { ...DEFAULTS, ...op.payload, clientId: op.taskId });
    } else if (current) {
      // An update for a task that is gone (deleted elsewhere) has nothing to change
      tasks.set(op.taskId, { ...current, ...op.payload });
    }
  }
  return [...tasks.values()];
};

// The same rule the server applies in backend/utils/rollover.js: every
// unfinished task dated before today is shown on today. It is recomputed from
// the date rather than queued as an edit, because the server makes the same
// move at the next sync and both sides arrive at the same answer.
export const rollOver = (tasks: Task[], today: string): Task[] =>
  tasks.map(task => (!task.completed && task.date < today ? { ...task, date: today } : task));

// "Today" for rollover never goes backwards (e.g. travelling west), as on the server.
export const rolloverDay = (today: string, lastRolloverDay: string | null | undefined): string =>
  lastRolloverDay && lastRolloverDay > today ? lastRolloverDay : today;

export const visibleTasks = (base: Base, outbox: Op[], today: string): Task[] =>
  rollOver(applyOutbox(base, outbox), today);

// Tasks with changes the server has not confirmed.
export const pendingTaskIds = (outbox: Op[]): Set<string> => new Set(outbox.map(op => op.taskId));

// Folds what a sync returned into `base`. A row is taken unless we already hold
// a newer copy (the pull's cursor overlaps, so rows can arrive twice).
export const mergePull = (base: Base, changes: Task[], fullResync: boolean): Base => {
  const merged: Base = fullResync ? {} : { ...base };
  for (const task of changes) {
    const key = task.clientId ?? task._id;
    if (!key) continue;
    if (task.deletedAt) {
      delete merged[key];
      continue;
    }
    const held = merged[key];
    if (!held || (task.version ?? 0) >= (held.version ?? 0)) merged[key] = { ...task, clientId: key };
  }
  return merged;
};

// Takes a permanently rejected operation out of the queue, along with every
// later operation for the same task: they were made on top of it.
export const moveAside = (outbox: Op[], opId: string, error: string): { outbox: Op[]; failed: FailedOp[] } => {
  const index = outbox.findIndex(o => o.id === opId);
  if (index === -1) return { outbox, failed: [] };
  const taskId = outbox[index].taskId;
  const isDependent = (o: Op, i: number) => i >= index && o.taskId === taskId;
  return {
    outbox: outbox.filter((o, i) => !isDependent(o, i)),
    failed: outbox.filter(isDependent).map(o => ({ ...o, error })),
  };
};
