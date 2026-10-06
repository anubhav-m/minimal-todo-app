// "Which day is it for this user" helpers. A task's day is the user's local
// calendar date, so nothing here may derive a date from the server's own clock
// zone (or UTC) unless the caller explicitly asks for that zone.

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// How far a client clock may disagree with ours around midnight and still be believed
const CLOCK_SKEW = 10 * MINUTE;

export const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
};

// Calendar date (YYYY-MM-DD) that `now` falls on in the given IANA timezone.
export const localDateInTimeZone = (timeZone, now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const shifted = (now, ms) => new Date(now.getTime() + ms);

// The user's local "today", or null when we have nothing trustworthy to go on
// (in which case the caller must not roll over - guessing UTC is the bug this replaces).
//   localDate      - YYYY-MM-DD from the client's own calendar
//   timezone       - IANA zone sent with this request
//   storedTimezone - IANA zone remembered from an earlier request
export const resolveToday = ({ localDate, timezone, storedTimezone, now = new Date() }) => {
  const requestZone = isValidTimeZone(timezone) ? timezone : null;

  if (typeof localDate === 'string' && LOCAL_DATE_RE.test(localDate)) {
    // Only believe a client date that can really be "today" somewhere right now
    const [earliest, latest] = requestZone
      ? [localDateInTimeZone(requestZone, shifted(now, -CLOCK_SKEW)), localDateInTimeZone(requestZone, shifted(now, CLOCK_SKEW))]
      : [localDateInTimeZone('UTC', shifted(now, -12 * HOUR)), localDateInTimeZone('UTC', shifted(now, 14 * HOUR))];
    if (localDate >= earliest && localDate <= latest) return localDate;
  }

  const zone = requestZone ?? (isValidTimeZone(storedTimezone) ? storedTimezone : null);
  return zone ? localDateInTimeZone(zone, now) : null;
};
