import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('combined-flow CLI verifies hooks, cache use and session end while preserving earlier report', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'noor-combined-flow-'));
 try {
  await writeFile(join(dir, 'report.json'), 'earlier baseline');
  await run(process.execPath, ['scripts/baseline-chat.mjs', '--verify-flow', '--output='+dir, '--report=combined-flow.json'], { cwd: root, timeout: 15000 });
  const report = JSON.parse(await readFile(join(dir, 'combined-flow.json'), 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.mode, 'offline-fixture');
  assert.ok(Object.values(report.flowChecks).every(value => value === true));
  assert.equal(report.modelCalls, 2);
  assert.equal(report.hookOrder.length, 6);
  assert.equal(await readFile(join(dir, 'report.json'), 'utf8'), 'earlier baseline');
  assert.ok(!JSON.stringify(report.events).includes('offline-fixture'));
  const identity = JSON.parse(await readFile(join(dir, 'visitor.json'), 'utf8'));
  assert.ok(!JSON.stringify(report).includes(identity.visitorCookie));
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runner rejects report path traversal before opening the server or spending credits', async () => {
 await assert.rejects(() => run(process.execPath, ['scripts/baseline-chat.mjs', '--report=../report.json'], { cwd: root, timeout: 5000 }), error => {
  assert.match(error.stderr, /simple JSON filename/);
  assert.ok(!error.stdout.includes('Noor demo listening'));
  return true;
 });
});
