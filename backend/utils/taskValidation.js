// Checks on what a sync operation may write. A failure here is permanent: the
// same operation would fail the same way on every retry, so the client is told
// to stop sending it.

export const TASK_FIELDS = ['text', 'date', 'time', 'notify', 'notificationId', 'completed', 'priority'];

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PRIORITIES = ['none', 'low', 'medium', 'high'];
const MAX_TEXT = 1000;

export const isValidId = (value) => typeof value === 'string' && ID_RE.test(value);

const optionalString = (max) => (v) => v === null || (typeof v === 'string' && v.length <= max);
const isBoolean = (v) => typeof v === 'boolean';

const CHECKS = {
  text: [(v) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT, `text must be 1-${MAX_TEXT} characters`],
  date: [(v) => typeof v === 'string' && LOCAL_DATE_RE.test(v) && !isNaN(Date.parse(v)), 'date must be YYYY-MM-DD'],
  time: [optionalString(20), 'time must be a short string or null'],
  notify: [isBoolean, 'notify must be true or false'],
  notificationId: [optionalString(100), 'notificationId must be a short string or null'],
  completed: [isBoolean, 'completed must be true or false'],
  priority: [(v) => PRIORITIES.includes(v), `priority must be one of ${PRIORITIES.join(', ')}`],
};

// Returns { fields } holding only the writable task fields present in `payload`,
// or { error } naming the first one that is not acceptable.
// `required` lists the fields that must be there (for a create).
export const pickTaskFields = (payload, required = []) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'payload must be an object' };

  const fields = {};
  for (const name of TASK_FIELDS) {
    const value = payload[name];
    if (value === undefined) {
      if (required.includes(name)) return { error: `${name} is required` };
      continue;
    }
    const [isValid, message] = CHECKS[name];
    if (!isValid(value)) return { error: message };
    fields[name] = value;
  }
  return { fields };
};
