import assert from 'node:assert/strict';
import test from 'node:test';
import { arrivalEmailIntent, arrivalNoteIntent, createArrivalEmailDraft, fixedArrivalNote } from './email-draft.mjs';

test('arrival email uses the fixed note and does not accept user-written content', () => {
  const draft = createArrivalEmailDraft();
  assert.ok(draft.body.includes(fixedArrivalNote));
  assert.match(draft.subject, /demo/i);
  assert.match(draft.body, /fictional Noor International Airlines CL 204/);
  assert.match(draft.body, /does not include live flight or airport information/i);
  assert.deepEqual(Object.keys(draft), ['subject', 'body']);
  assert.equal(createArrivalEmailDraft().body, draft.body);
});

test('email requests use the draft path', () => {
  assert.equal(arrivalEmailIntent('Please email me the arrival note'), true);
  assert.equal(arrivalEmailIntent('Can you send an e-mail?'), true);
  assert.equal(arrivalEmailIntent('What is the weather on arrival?'), false);
  assert.equal(arrivalNoteIntent('Show me the fixed arrival note.'), true);
  assert.equal(arrivalNoteIntent('Email me the arrival note'), false);
});
