import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDeviceTimeZone,
  isRolloverDue,
  msUntilNextLocalMidnight,
  toLocalDateString,
} from './localDate.ts';

const HOUR = 60 * 60 * 1000;
const useZone = (zone) => { process.env.TZ = zone; };

beforeEach(() => useZone('Asia/Kolkata'));

test('the local day changes at local midnight in IST: 23:59 vs 00:01', () => {
  assert.equal(toLocalDateString(new Date('2026-10-06T18:29:00Z')), '2026-10-06'); // 23:59 IST
  assert.equal(toLocalDateString(new Date('2026-10-06T18:31:00Z')), '2026-10-07'); // 00:01 IST
});

test('UTC midnight is not a day boundary in IST: 05:29 vs 05:31', () => {
  const before = new Date('2026-10-06T23:59:00Z'); // 05:29 IST on the 7th
  const after = new Date('2026-10-07T00:01:00Z'); // 05:31 IST on the 7th
  assert.equal(toLocalDateString(before), '2026-10-07');
  assert.equal(toLocalDateString(after), '2026-10-07');
  // The old UTC-based date disagreed with the local one until 05:30
  assert.notEqual(before.toISOString().slice(0, 10), toLocalDateString(before));
});

test('reports the device IANA timezone', () => {
  // Some ICU builds report the older alias for the same zone
  assert.ok(['Asia/Kolkata', 'Asia/Calcutta'].includes(getDeviceTimeZone()));
});

test('msUntilNextLocalMidnight counts down to local, not UTC, midnight', () => {
  assert.equal(msUntilNextLocalMidnight(new Date('2026-10-06T18:29:00Z')), 60 * 1000);
  assert.equal(msUntilNextLocalMidnight(new Date('2026-10-06T18:30:00Z')), 24 * HOUR);
  assert.equal(msUntilNextLocalMidnight(new Date('2026-10-06T23:59:00Z')), 18.5 * HOUR + 60 * 1000);
});

test('msUntilNextLocalMidnight handles 23h and 25h DST days', () => {
  useZone('America/New_York');
  assert.equal(msUntilNextLocalMidnight(new Date(2026, 2, 8, 0, 0, 0)), 23 * HOUR); // spring forward
  assert.equal(msUntilNextLocalMidnight(new Date(2026, 10, 1, 0, 0, 0)), 25 * HOUR); // fall back
});

test('a device timezone change is picked up for the local date', () => {
  const instant = new Date('2026-10-06T20:00:00Z');
  assert.equal(toLocalDateString(instant), '2026-10-07'); // 01:30 IST
  useZone('America/New_York');
  assert.equal(toLocalDateString(instant), '2026-10-06'); // 16:00 EDT
  assert.equal(getDeviceTimeZone(), 'America/New_York');
});

test('isRolloverDue: first run, next day, several missed days, same day, clock moved back', () => {
  assert.equal(isRolloverDue('2026-10-07', null), true);
  assert.equal(isRolloverDue('2026-10-07', '2026-10-06'), true);
  assert.equal(isRolloverDue('2026-10-07', '2026-10-04'), true);
  assert.equal(isRolloverDue('2026-10-07', '2026-10-07'), false);
  assert.equal(isRolloverDue('2026-10-06', '2026-10-07'), false);
});
