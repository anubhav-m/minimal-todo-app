import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, newClientId } from './taskSync.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

// --- add: double submit ------------------------------------------------------

test('a double submit takes the draft once, so one request is sent', async () => {
  const draft = createDraft();
  const sent = [];
  const submit = async () => {
    const text = draft.take();
    if (!text) return;
    sent.push(text);
    await tick();
  };

  draft.set('Buy milk');
  await Promise.all([submit(), submit(), submit()]);

  assert.deepEqual(sent, ['Buy milk']);
});

test('the draft ignores blank text and is not restored over newer typing', () => {
  const draft = createDraft();
  draft.set('   ');
  assert.equal(draft.take(), null);

  draft.set('Buy milk');
  assert.equal(draft.take(), 'Buy milk');
  assert.equal(draft.restore('Buy milk'), true);
  assert.equal(draft.take(), 'Buy milk');

  draft.set('Something newer');
  assert.equal(draft.restore('Buy milk'), false);
  assert.equal(draft.take(), 'Something newer');
});

test('client ids are unique when generated concurrently, with or without crypto.randomUUID', async () => {
  const batches = await Promise.all(Array.from({ length: 50 }, async () => Array.from({ length: 200 }, newClientId)));
  assert.equal(new Set(batches.flat()).size, 10000);

  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const fallback = Array.from({ length: 10000 }, newClientId);
    assert.equal(new Set(fallback).size, 10000);
    assert.match(fallback[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', original);
  }
});
