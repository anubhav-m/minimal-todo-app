// The sync worker and the store the screen talks to. Every user action changes
// the outbox and returns at once; pushing it to the server and pulling changes
// back happens here, in the background, one run at a time.
// Kept free of react/expo imports so it can run under `npm test`: storage, the
// network, the clock and timers are all passed in.

import { enqueue, mergePull, moveAside, applyOutbox, rollOver, rolloverDay, pendingTaskIds } from './outbox.ts';
import type { Base, FailedOp, Op, Task, TaskFields } from './outbox.ts';

export interface SyncMeta {
  // Where the next pull starts; issued by the server, never built from the device clock
  cursor: string | null;
  rolloverDay: string | null;
}

export interface Snapshot {
  base: Base;
  outbox: Op[];
  failed: FailedOp[];
  meta: SyncMeta;
}

// Each call must leave the stored value complete; calls are never overlapped.
export interface SyncStorage {
  load(): Promise<Partial<Snapshot>>;
  saveBase(base: Base): Promise<void>;
  saveOutbox(outbox: Op[], failed: FailedOp[]): Promise<void>;
  saveMeta(meta: SyncMeta): Promise<void>;
  clear(): Promise<void>;
}

export interface SyncRequest {
  ops: Array<Pick<Op, 'id' | 'type' | 'taskId' | 'payload'>>;
  cursor: string | null;
  localDate: string;
  timezone?: string;
}

export interface SyncResponse {
  results: Array<{ id: string; status: 'applied' | 'duplicate' | 'gone' | 'rejected'; error?: string }>;
  changes: Task[];
  cursor: string;
  fullResync: boolean;
}

export interface SyncDeps {
  storage: SyncStorage;
  // Rejects with an error carrying the HTTP status (`status` or `response.status`) when there was a response
  send(request: SyncRequest): Promise<SyncResponse>;
  // Gets a new access token after a 401; rejects if the session cannot be renewed
  refreshAuth(): Promise<unknown>;
  today(): string; // local yyyy-MM-dd
  timezone?(): string | undefined;
  newId(): string;
  now?(): number;
  random?(): number;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

// launch, foreground, reconnect, manual: something changed that makes success
//   likely, so try now and forget how often it failed before.
// retry: the backoff timer fired.
// change, periodic: routine; they wait their turn behind a pending retry.
export type SyncReason = 'launch' | 'foreground' | 'reconnect' | 'manual' | 'retry' | 'change' | 'periodic';

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  pending: number; // operations waiting to be confirmed
  failed: FailedOp[]; // operations the server will never accept
  synced: boolean; // has this device ever received the task list from the server
  // auth: the session could not be renewed. error: the last attempt failed and will be retried.
  problem: null | 'auth' | 'error';
}

export const MAX_BATCH = 100;
export const RETRY_BASE_MS = 2000;
export const RETRY_CAP_MS = 5 * 60 * 1000;
const RETRY_JITTER = 0.2;
const CHANGE_DEBOUNCE_MS = 1000;

// 2 s, 4 s, 8 s ... capped at 5 minutes, spread by +/-20% so devices that lost
// the server together do not all come back at the same instant.
export const retryDelay = (failures: number, random: number): number =>
  Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1)) * (1 - RETRY_JITTER + 2 * RETRY_JITTER * random);

const httpStatus = (error: any): number | undefined => error?.status ?? error?.response?.status;

export const createSyncEngine = (deps: SyncDeps) => {
  const { storage, send, refreshAuth, today, newId } = deps;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));

  let base: Base = {};
  let outbox: Op[] = [];
  let failed: FailedOp[] = [];
  let meta: SyncMeta = { cursor: null, rolloverDay: null };

  let view: Task[] = [];
  let pending = new Set<string>();
  let online = true;
  let syncing = false;
  let problem: SyncStatus['problem'] = null;
  let status: SyncStatus = { online, syncing, pending: 0, failed, synced: false, problem };

  // disposed: stop touching the screen and the network. cleared: also stop touching the disk.
  let disposed = false;
  let cleared = false;
  let running: Promise<void> | null = null;
  let runAgain = false;
  let failures = 0;
  let batchSize = MAX_BATCH;
  let retryTimer: unknown = null;
  let changeTimer: unknown = null;
  const listeners = new Set<() => void>();

  // Storage writes go out one at a time, in the order they were asked for
  let writes: Promise<unknown> = Promise.resolve();
  const write = (save: () => Promise<void>): Promise<void> => {
    const done = writes.then(() => (cleared ? undefined : save())).catch(e => console.error('Failed to save tasks locally', e));
    writes = done;
    return done;
  };
  const saveOutbox = () => write(() => storage.saveOutbox(outbox, failed));

  // Recomputes what the screen shows and tells it. Called after every change.
  const publish = () => {
    const day = rolloverDay(today(), meta.rolloverDay);
    if (day !== meta.rolloverDay) {
      meta = { ...meta, rolloverDay: day };
      write(() => storage.saveMeta(meta));
    }
    view = rollOver(applyOutbox(base, outbox), day);
    pending = pendingTaskIds(outbox);
    status = { online, syncing, pending: outbox.length, failed, synced: meta.cursor !== null, problem };
    listeners.forEach(listener => listener());
  };

  const cancelTimer = (timer: unknown) => {
    if (timer !== null) clearTimer(timer);
    return null;
  };

  const add = (op: Pick<Op, 'type' | 'taskId' | 'payload'>) => {
    outbox = enqueue(outbox, { ...op, id: newId(), createdAt: now(), attempts: 0 });
    saveOutbox();
    publish();
    // A burst of taps becomes one request
    changeTimer = cancelTimer(changeTimer);
    changeTimer = setTimer(() => {
      changeTimer = null;
      sync('change');
    }, CHANGE_DEBOUNCE_MS);
  };

  const fail = (kind: 'auth' | 'error') => {
    failures++;
    problem = kind;
    retryTimer = cancelTimer(retryTimer);
    retryTimer = setTimer(() => {
      retryTimer = null;
      sync('retry');
    }, retryDelay(failures, random()));
  };

  const applyResponse = (batch: Op[], response: SyncResponse) => {
    const results = new Map(response.results.map(result => [result.id, result]));
    // Without an answer for everything sent we cannot tell what was applied; send it all again
    if (batch.some(op => !results.has(op.id))) throw new Error('Sync response is missing results');

    const gone: string[] = [];
    for (const op of batch) {
      const result = results.get(op.id)!;
      if (result.status === 'rejected') {
        const moved = moveAside(outbox, op.id, result.error || 'The server did not accept this change');
        outbox = moved.outbox;
        failed = [...failed, ...moved.failed];
      } else {
        outbox = outbox.filter(o => o.id !== op.id);
        if (result.status === 'gone') gone.push(op.taskId);
      }
    }

    base = mergePull(base, response.changes, response.fullResync);
    for (const taskId of gone) delete base[taskId];
    meta = { ...meta, cursor: response.cursor };

    // The cursor is saved last: if the app dies part-way, the next sync asks
    // for the same changes again instead of skipping them
    write(() => storage.saveBase(base));
    saveOutbox();
    write(() => storage.saveMeta(meta));
  };

  // One push-and-pull. Resolves true when the server answered and was applied.
  const runOnce = async (): Promise<boolean> => {
    let refreshed = false;
    for (;;) {
      const batch = outbox.slice(0, batchSize);
      if (batch.length > 0) {
        // Recorded before sending: from here on these may have reached the server,
        // so they are never merged into or dropped, only replayed
        const sending = new Set(batch.map(op => op.id));
        outbox = outbox.map(op => (sending.has(op.id) ? { ...op, attempts: op.attempts + 1 } : op));
        await saveOutbox();
        if (disposed) return false;
      }

      let response: SyncResponse;
      try {
        response = await send({
          ops: batch.map(({ id, type, taskId, payload }) => ({ id, type, taskId, payload })),
          cursor: meta.cursor,
          localDate: today(),
          timezone: deps.timezone?.(),
        });
        if (disposed) return false;
        applyResponse(batch, response);
      } catch (error) {
        if (disposed) return false;
        const code = httpStatus(error);

        if (code === 401) {
          if (!refreshed) {
            refreshed = true;
            const renewed = await refreshAuth().then(() => true, () => false);
            if (disposed) return false;
            if (renewed) continue;
          }
          fail('auth');
          return false;
        }

        // The request itself was refused. Narrow it down to the operation at
        // fault and set that one aside, so it cannot block everything behind it.
        if ((code === 400 || code === 413 || code === 422) && batch.length > 0) {
          if (batch.length > 1) {
            batchSize = Math.ceil(batch.length / 2);
          } else {
            const moved = moveAside(outbox, batch[0].id, 'The server did not accept this change');
            outbox = moved.outbox;
            failed = [...failed, ...moved.failed];
            saveOutbox();
          }
          continue;
        }

        fail('error');
        return false;
      }

      failures = 0;
      problem = null;
      batchSize = MAX_BATCH;
      return true;
    }
  };

  const run = async () => {
    syncing = true;
    publish();
    try {
      let ok: boolean;
      do {
        runAgain = false;
        ok = await runOnce();
        // Keep going while there is more to send: a long outbox, or changes made meanwhile
      } while (ok && !disposed && (runAgain || outbox.length > 0));
    } finally {
      syncing = false;
      running = null;
      if (!disposed) publish();
    }
  };

  const sync = (reason: SyncReason = 'manual'): Promise<void> => {
    if (disposed) return Promise.resolve();
    const routine = reason === 'change' || reason === 'periodic';
    // Offline, or already backing off: the retry timer or a reconnect will pick it up
    if (routine && (!online || retryTimer !== null)) return running ?? Promise.resolve();

    if (reason !== 'retry') failures = 0;
    retryTimer = cancelTimer(retryTimer);
    if (reason !== 'change') changeTimer = cancelTimer(changeTimer);

    if (running) {
      runAgain = true;
      return running;
    }
    running = run();
    return running;
  };

  return {
    // Reads what was saved last time. Call once, before anything else.
    async load() {
      const saved = await storage.load();
      if (disposed) return;
      base = saved.base ?? {};
      // Anything still queued, sent or not, is simply sent (again): the server recognises a replay
      outbox = saved.outbox ?? [];
      failed = saved.failed ?? [];
      meta = { cursor: null, rolloverDay: null, ...saved.meta };
      publish();
    },

    tasks: (): Task[] => view,
    status: (): SyncStatus => status,
    isPending: (taskId: string): boolean => pending.has(taskId),

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // Re-evaluates "today" (launch, foreground, midnight) so rollover follows the calendar.
    refreshDay: publish,

    create(fields: Partial<TaskFields> & Pick<TaskFields, 'text' | 'date'>, clientId: string = newId()): Task {
      add({ type: 'create', taskId: clientId, payload: fields });
      return view.find(t => t.clientId === clientId)!;
    },

    // Queues only the fields that really differ. Returns the task as now shown, or null if it is gone.
    update(taskId: string, changes: Partial<TaskFields>): Task | null {
      const shown = view.find(t => t.clientId === taskId);
      if (!shown) return null;

      const payload: Partial<TaskFields> = {};
      for (const key of Object.keys(changes) as Array<keyof TaskFields>) {
        if (changes[key] !== undefined && changes[key] !== shown[key]) (payload as any)[key] = changes[key];
      }
      if (Object.keys(payload).length === 0) return shown;

      // A task shown on today only because it rolled over keeps that day once it
      // is touched; otherwise completing it would send it back to its old date
      const unrolled = applyOutbox(base, outbox).find(t => t.clientId === taskId);
      if (unrolled && unrolled.date !== shown.date && payload.date === undefined) payload.date = shown.date;

      add({ type: 'update', taskId, payload });
      return view.find(t => t.clientId === taskId) ?? null;
    },

    remove(taskId: string) {
      if (!view.some(t => t.clientId === taskId)) return;
      add({ type: 'delete', taskId, payload: {} });
    },

    sync,

    // The device's own view of connectivity. Coming back online syncs at once.
    setOnline(isOnline: boolean) {
      if (isOnline === online) return;
      online = isOnline;
      publish();
      if (online) sync('reconnect');
    },

    // Puts the rejected operations back in the queue, in their original order.
    retryFailed() {
      if (failed.length === 0) return;
      outbox = [...outbox, ...failed.map(({ error, ...op }) => ({ ...op, attempts: 0 }))];
      failed = [];
      saveOutbox();
      publish();
      sync('manual');
    },

    // Gives up on the rejected operations; the tasks go back to what the server holds.
    discardFailed() {
      if (failed.length === 0) return;
      failed = [];
      saveOutbox();
      publish();
    },

    // Resolves once everything asked for so far is on disk.
    flushed: (): Promise<void> => writes.then(() => undefined),

    // Sign-out: stops everything and forgets this account's tasks on the device.
    async clear() {
      disposed = true;
      cleared = true;
      retryTimer = cancelTimer(retryTimer);
      changeTimer = cancelTimer(changeTimer);
      listeners.clear();
      await writes;
      await storage.clear();
    },

    // The screen is going away; anything in flight must not touch it or the disk.
    stop() {
      disposed = true;
      retryTimer = cancelTimer(retryTimer);
      changeTimer = cancelTimer(changeTimer);
      listeners.clear();
    },
  };
};

export type SyncEngine = ReturnType<typeof createSyncEngine>;
