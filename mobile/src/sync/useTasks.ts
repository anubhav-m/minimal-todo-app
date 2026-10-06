import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { syncTasks } from '../api/api';
import { refreshAccessToken } from '../auth/session';
import { reminderApi } from '../notifications/reminderApi';
import { createReminderQueue } from '../notifications/reminders';
import { newClientId } from '../tasks/taskSync';
import { toLocalDateString, getDeviceTimeZone, msUntilNextLocalMidnight } from '../utils/localDate';
import { createSyncEngine } from './syncEngine';
import type { SyncEngine, SyncStatus } from './syncEngine';
import type { Task, TaskFields } from './outbox';
import { createTaskStorage } from './taskStorage';

// While the app is open and online, how often to look for changes made elsewhere
const PERIODIC_SYNC_MS = 2 * 60 * 1000;

const NOT_LOADED: SyncStatus = { online: true, syncing: false, pending: 0, failed: [], synced: false, problem: null };

export type EditableFields = Pick<TaskFields, 'text' | 'date' | 'time' | 'notify' | 'priority'>;

// Only "no network at all" counts as offline. Connected-without-internet is left to the
// retry backoff, because the OS's reachability guess can be wrong for long stretches.
const isOnline = (state: Network.NetworkState) => state.isConnected !== false;

const reminderIdFor = (clientId: string, notify: boolean, time: string | null) =>
  notify && time ? `reminder-${clientId}` : null;

// The task list for one signed-in account, backed by the device. Every action
// here returns at once and works with no connection; syncing with the server
// and keeping reminders in step happen in the background.
export const useTasks = (account: string) => {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [snapshot, setSnapshot] = useState<{ tasks: Task[]; pending: Set<string>; status: SyncStatus; today: string }>({
    tasks: [],
    pending: new Set(),
    status: NOT_LOADED,
    today: toLocalDateString(),
  });
  const reminders = useRef<ReturnType<typeof createReminderQueue> | null>(null);

  useEffect(() => {
    let stopped = false;
    const store = createSyncEngine({
      storage: createTaskStorage(account),
      send: syncTasks,
      refreshAuth: refreshAccessToken,
      today: () => toLocalDateString(),
      timezone: getDeviceTimeZone,
      newId: newClientId,
    });
    // Reminders are worked out from the list as it is on this device, so they
    // are right with or without a connection
    const queue = createReminderQueue(reminderApi, () => (stopped ? null : store.tasks()));
    reminders.current = queue;

    let wasSyncing = false;
    const unsubscribe = store.subscribe(() => {
      const tasks = store.tasks();
      const status = store.status();
      setSnapshot({
        tasks,
        pending: new Set(tasks.filter(t => store.isPending(t.clientId)).map(t => t.clientId)),
        status,
        today: toLocalDateString(),
      });
      // A sync may have brought in deletes, completions or new reminders from elsewhere
      if (wasSyncing && !status.syncing) queue.reconcile();
      wasSyncing = status.syncing;
    });

    // Timers do not fire while the app is suspended, so midnight is only one of
    // the moments rollover is re-evaluated; launch and foreground do the same.
    const newDay = () => {
      store.refreshDay();
      queue.reconcile();
    };
    let midnightTimer: ReturnType<typeof setTimeout>;
    const armMidnightTimer = () => {
      clearTimeout(midnightTimer);
      midnightTimer = setTimeout(() => {
        newDay();
        store.sync('periodic');
        armMidnightTimer();
      }, msUntilNextLocalMidnight() + 1000);
    };

    (async () => {
      await store.load().catch(e => console.error('Failed to read saved tasks', e));
      if (stopped) return;
      setEngine(store);
      queue.reconcile();
      armMidnightTimer();
      store.sync('launch');
      Network.getNetworkStateAsync().then(state => store.setOnline(isOnline(state))).catch(() => {});
    })();

    const network = Network.addNetworkStateListener(state => store.setOnline(isOnline(state)));
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      newDay();
      armMidnightTimer();
      store.sync('foreground');
    });
    const periodic = setInterval(() => {
      if (AppState.currentState === 'active') store.sync('periodic');
    }, PERIODIC_SYNC_MS);

    return () => {
      stopped = true;
      unsubscribe();
      store.stop();
      network.remove();
      appState.remove();
      clearInterval(periodic);
      clearTimeout(midnightTimer);
    };
  }, [account]);

  const addTask = (fields: Pick<TaskFields, 'text' | 'date' | 'time' | 'notify' | 'priority'>) => {
    if (!engine) return;
    const clientId = newClientId();
    const task = engine.create(
      // The reminder's id is derived from the task's, so it is known before the server is
      { ...fields, completed: false, notificationId: reminderIdFor(clientId, fields.notify, fields.time) },
      clientId
    );
    reminders.current?.sync(task);
  };

  const toggleTask = (clientId: string) => {
    const task = engine?.tasks().find(t => t.clientId === clientId);
    if (!engine || !task) return;
    const updated = engine.update(clientId, { completed: !task.completed });
    // Completing cancels the reminder; un-completing brings it back if it is still due
    if (updated) reminders.current?.sync(updated);
  };

  const editTask = (clientId: string, changes: EditableFields) => {
    const task = engine?.tasks().find(t => t.clientId === clientId);
    if (!engine || !task) return;
    const updated = engine.update(clientId, {
      ...changes,
      // Kept once given, so a reminder that is switched off can still be found and cancelled
      notificationId: task.notificationId ?? reminderIdFor(clientId, changes.notify, changes.time),
    });
    // Drops the old reminder and schedules one for the new text/time if still wanted
    if (updated) reminders.current?.sync(updated);
  };

  const deleteTask = (clientId: string) => {
    const task = engine?.tasks().find(t => t.clientId === clientId);
    if (!engine || !task) return;
    // Cancel while we still hold the task (and its notification id)
    reminders.current?.cancel(task);
    engine.remove(clientId);
  };

  // Resolves when the attempt is over, whether or not it reached the server
  const syncNow = () => engine?.sync('manual') ?? Promise.resolve();

  const retryFailed = () => engine?.retryFailed();

  const discardFailed = () => {
    engine?.discardFailed();
    // Tasks went back to the server's copy; reminders follow
    reminders.current?.reconcile();
  };

  // After notifications are allowed: schedule what could not be scheduled before
  const refreshReminders = () => reminders.current?.reconcile();

  // Sign-out: this account's reminders and tasks leave the device.
  const forgetAccount = async () => {
    if (!engine) return;
    const queue = reminders.current;
    await Promise.all(engine.tasks().map(task => queue?.cancel(task)));
    await engine.clear();
  };

  return {
    isLoading: !engine,
    ...snapshot,
    addTask,
    toggleTask,
    editTask,
    deleteTask,
    syncNow,
    retryFailed,
    discardFailed,
    refreshReminders,
    forgetAccount,
  };
};
