// "Which day is it" helpers. Everything here reads the device's local calendar;
// never derive a day from toISOString(), which is UTC. Kept free of
// expo/react-native imports so it can run under `npm test`.

const pad = (n: number) => String(n).padStart(2, '0');

// Local calendar date as yyyy-MM-dd.
export const toLocalDateString = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// IANA zone of the device, e.g. "Asia/Kolkata".
export const getDeviceTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

// Built from local calendar fields, so it stays right on 23h/25h DST days.
export const msUntilNextLocalMidnight = (now: Date = new Date()): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();

export const isRolloverDue = (today: string, lastRolloverDate: string | null): boolean =>
  !lastRolloverDate || today > lastRolloverDate;
