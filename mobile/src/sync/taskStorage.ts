import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SyncStorage } from './syncEngine';

// Where the sync engine keeps one account's tasks on the device. Keys carry the
// account, so signing in as someone else never shows or syncs another person's tasks.
// Each value is written whole; the engine never overlaps two writes.
export const createTaskStorage = (account: string): SyncStorage => {
  const key = (name: string) => `todo_${name}:${account.toLowerCase()}`;
  const BASE = key('base');
  const OUTBOX = key('outbox');
  const FAILED = key('failed');
  const META = key('sync_meta');

  const parse = (raw: string | null) => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      // Unreadable (e.g. a write cut short): start from the server's copy again
      return undefined;
    }
  };

  return {
    async load() {
      const stored = new Map(await AsyncStorage.multiGet([BASE, OUTBOX, FAILED, META]));
      return {
        base: parse(stored.get(BASE) ?? null),
        outbox: parse(stored.get(OUTBOX) ?? null),
        failed: parse(stored.get(FAILED) ?? null),
        meta: parse(stored.get(META) ?? null),
      };
    },
    saveBase: (base) => AsyncStorage.setItem(BASE, JSON.stringify(base)),
    saveOutbox: (outbox, failed) =>
      AsyncStorage.multiSet([[OUTBOX, JSON.stringify(outbox)], [FAILED, JSON.stringify(failed)]]),
    saveMeta: (meta) => AsyncStorage.setItem(META, JSON.stringify(meta)),
    clear: () => AsyncStorage.multiRemove([BASE, OUTBOX, FAILED, META]),
  };
};
