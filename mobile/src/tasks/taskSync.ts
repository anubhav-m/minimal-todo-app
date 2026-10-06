// Helpers for adding a task. Kept free of react/expo imports so it can run under
// `npm test`. Everything about what happens after the tap is in src/sync.

// A task's id on every device, chosen here so a task made offline needs nothing from the server.
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
