// Concurrency helpers for the task list: what may overlap, and what wins when it
// does. Kept free of react/expo imports so it can run under `npm test`.
// frontend/src/lib/taskSync.ts is a copy of this file; change both together.

// Identifies one create, so the server can tell a retry or double submit from a new task.
export const newClientId = (): string => {
  const cryptoApi = (globalThis as any).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  // Hermes and non-HTTPS pages have no randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

// Hands the typed text out once. A second submit that fires before the form has
// re-rendered (double tap, Enter + button) finds it already taken.
export const createDraft = () => {
  let value = '';
  return {
    set(text: string) {
      value = text;
    },
    take(): string | null {
      if (!value.trim()) return null;
      const taken = value;
      value = '';
      return taken;
    },
    // After a failed save; false if the user has already typed something else.
    restore(text: string): boolean {
      if (value) return false;
      value = text;
      return true;
    },
  };
};

// A retry of a failed create must reuse its clientId: the first attempt may have
// reached the server even though the response never came back.
export const createClientIdSource = (newId: () => string = newClientId) => {
  let lastFailed: { key: string; id: string } | null = null;
  return {
    idFor(payload: unknown): string {
      return lastFailed?.key === JSON.stringify(payload) ? lastFailed.id : newId();
    },
    failed(payload: unknown, id: string) {
      lastFailed = { key: JSON.stringify(payload), id };
    },
    succeeded(id: string) {
      if (lastFailed?.id === id) lastFailed = null;
    },
  };
};

export interface MutationMark {
  idle: boolean;
  generation: number;
}

// Knows whether a create/toggle/delete is in flight, and whether one started or
// finished since a given moment. Any number of mutations may overlap.
export const createMutationTracker = () => {
  let inFlight = 0;
  let generation = 0;
  let idleWaiters: Array<() => void> = [];

  return {
    // Call when a mutation starts; call the returned function when it settles.
    begin(): () => void {
      inFlight++;
      generation++;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        inFlight--;
        generation++;
        if (inFlight === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          waiters.forEach(resolve => resolve());
        }
      };
    },
    mark(): MutationMark {
      return { idle: inFlight === 0, generation };
    },
    // True only if nothing was in flight at the mark and nothing has started since.
    isUnchangedSince(mark: MutationMark): boolean {
      return mark.idle && mark.generation === generation;
    },
    whenIdle(): Promise<void> {
      if (inFlight === 0) return Promise.resolve();
      return new Promise(resolve => idleWaiters.push(resolve));
    },
  };
};

export type MutationTracker = ReturnType<typeof createMutationTracker>;

// Loads a server snapshot that no local mutation overlapped. A snapshot taken
// while a mutation was in flight may or may not include it, so it is retried
// once things are quiet; `fresh: false` means every attempt was overlapped.
export const loadFreshSnapshot = async <T>(
  tracker: MutationTracker,
  load: () => Promise<T>,
  maxAttempts = 3
): Promise<{ data: T; fresh: boolean }> => {
  for (let attempt = 1; ; attempt++) {
    await tracker.whenIdle();
    const mark = tracker.mark();
    const data = await load();
    if (tracker.isUnchangedSince(mark)) return { data, fresh: true };
    if (attempt >= maxAttempts) return { data, fresh: false };
  }
};

// Callers that ask for the same thing while it is already running share that run.
// A different key waits for the current run, so two runs never overlap and
// responses cannot arrive out of order.
export const createSingleFlight = <T>() => {
  let current: { key: string; promise: Promise<T> } | null = null;

  return (key: string, run: () => Promise<T>): Promise<T> => {
    if (current?.key === key) return current.promise;

    const previous: Promise<unknown> = current ? current.promise.catch(() => undefined) : Promise.resolve();
    const entry = { key, promise: previous.then(run) };
    current = entry;
    const clear = () => {
      if (current === entry) current = null;
    };
    entry.promise.then(clear, clear);
    return entry.promise;
  };
};

export interface ToggleTask {
  _id: string;
  completed: boolean;
  version?: number;
}

// conflict: the server refused a stale baseVersion and sent its current copy.
// gone: the task no longer exists.
export type ToggleResult<T> = { status: 'ok' | 'conflict'; task: T } | { status: 'gone' };

const MAX_CONFLICTS = 3;

// Sends completion changes for one task strictly one at a time. Taps made while
// a request is in flight only change the value we want; when the request settles
// a follow-up is sent if the server does not hold that value yet. The server
// therefore always ends on the last tap, whatever order the network delivers in.
export const createToggleQueue = <T extends ToggleTask>(options: {
  send: (id: string, completed: boolean, baseVersion: number | undefined) => Promise<ToggleResult<T>>;
  tracker?: MutationTracker;
  // The server's copy of the task; `desired` is what the row should show meanwhile
  onConfirmed: (task: T, desired: boolean) => void;
  // The request failed; `confirmed` is the last value the server is known to hold
  onFailed: (id: string, confirmed: boolean, error: unknown) => void;
  onGone: (id: string) => void;
}) => {
  const { send, tracker, onConfirmed, onFailed, onGone } = options;
  const pending = new Map<string, { desired: boolean; confirmed: boolean; version: number | undefined; done: Promise<void> }>();

  const run = async (id: string) => {
    const state = pending.get(id)!;
    const end = tracker?.begin();
    let conflicts = 0;
    try {
      while (state.desired !== state.confirmed) {
        const result = await send(id, state.desired, state.version);
        if (result.status === 'gone') {
          onGone(id);
          return;
        }
        state.confirmed = result.task.completed;
        state.version = result.task.version;
        // Changed elsewhere: our tap is re-applied on top of the server's copy,
        // but not forever if something keeps changing it
        if (result.status === 'conflict' && ++conflicts >= MAX_CONFLICTS) state.desired = state.confirmed;
        onConfirmed(result.task, state.desired);
      }
    } catch (error) {
      state.desired = state.confirmed;
      onFailed(id, state.confirmed, error);
    } finally {
      pending.delete(id);
      end?.();
    }
  };

  return {
    // Flips the task and returns the value its row should now show.
    // `task` must be the row as displayed (it is only read on the first tap).
    toggle(task: ToggleTask): boolean {
      const state = pending.get(task._id);
      if (state) {
        state.desired = !state.desired;
        return state.desired;
      }
      const created = { desired: !task.completed, confirmed: task.completed, version: task.version, done: Promise.resolve() };
      pending.set(task._id, created);
      created.done = run(task._id);
      return created.desired;
    },
    // Resolves when nothing is in flight for the task.
    settled(id: string): Promise<void> {
      return pending.get(id)?.done ?? Promise.resolve();
    },
  };
};
