import test from 'node:test';
import assert from 'node:assert/strict';
import {getSampleCrewQueue} from './crew-sample-queue.mjs';

test('sample queue has stable fictional IDs, multiple statuses, and duplicate-seat context',()=>{
 const now=Date.parse('2026-10-18T12:00:00Z');
 const rows=getSampleCrewQueue(now);
 assert.equal(rows.length,4);
 assert.deepEqual(rows.map(row=>row.id),getSampleCrewQueue(now+60_000).map(row=>row.id));
 assert.equal(rows.filter(row=>row.seat==='12A').length,2);
 assert.deepEqual(new Set(rows.map(row=>row.status)),new Set(['submitted','acknowledged','in_progress']));
 assert.ok(rows.every(row=>row.createdAt<=now&&row.updatedAt<=now&&row.sessionId));
 assert.ok(rows.every(row=>!row.details.includes('Ignore all previous instructions')));
});

test('injection fixture is available only to explicit adversarial tests',()=>{
 const rows=getSampleCrewQueue(Date.parse('2026-10-18T12:00:00Z'),{includeAdversarial:true});
 assert.equal(rows.length,5);
 assert.match(rows.at(-1).details,/ignore all previous instructions/i);
 assert.equal(getSampleCrewQueue().length,4);
});
