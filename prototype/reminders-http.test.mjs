import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
test('reminder HTTP flow requires a session, origin checks, and confirmed ownership', async () => {
 const testRoot=resolve(tmpdir());
 const testData=await mkdtemp(join(testRoot,'noor-security-http-'));
 process.env.NOOR_DATA_DIR=testData;
 const originalFetch=globalThis.fetch;let modelCalls=0;
 process.env.ANTHROPIC_API_KEY='offline-http-test-key';
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.anthropic.com/v1/messages/count_tokens')return Response.json({input_tokens:100});
  if(String(url)==='https://api.anthropic.com/v1/messages')return Response.json({content:++modelCalls===1?[{type:'tool_use',id:'prepare',name:'prepare_reminder',input:{"kind":"boarding"}}]:[{type:'text',text:'{"reply":"Review and confirm below."}'}],usage:{input_tokens:100,output_tokens:20}});
  if(new URL(url).hostname!=='127.0.0.1')throw Error('External network disabled in offline tests');
  return originalFetch(url,options);
 };
 process.env.PORT = '0';
 process.env.NOOR_SKIP_VOICE_WARMUP = '1';
 process.env.NOOR_EMAIL_DB = ':memory:';
 process.env.NOOR_USAGE_DB = ':memory:';
 const { server } = await import('./server.mjs');
 if (!server.listening) await once(server, 'listening');
 const base = `http://127.0.0.1:${server.address().port}`;
 const start = async () => (await fetch(base + '/api/session', { method: 'POST' })).headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
 const call = (cookie, body, origin) => fetch(base + '/api/reminders', { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
 try {
  assert.equal((await call('', { action: 'list' })).status, 401);
  const alice = await start(), bob = await start();
  assert.equal((await call(alice, { action: 'list' }, 'https://other.example')).status, 403);
  const chat = await fetch(base + '/api/chat', { method: 'POST', headers: { cookie: alice, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Remind me before boarding' }) });
  assert.equal((await chat.json()).passengerReminders, true);
  const review = await call(alice, { action: 'review', kind: 'boarding', dueAt: Date.now() + 60000, timeZone: 'UTC' });
  assert.equal(review.status, 200);
  const { draft } = await review.json();
  assert.equal((await call(alice, { action: 'save', token: draft.token })).status, 400);
  const save = await call(alice, { action: 'save', token: draft.token, confirmed: true });
  assert.equal(save.status, 200);
  const { reminder } = await save.json();
  assert.equal((await (await call(bob, { action: 'list' })).json()).reminders.length, 0);
  assert.equal((await call(bob, { action: 'cancel', id: reminder.id })).status, 404);
  assert.equal((await (await call(alice, { action: 'cancel', id: reminder.id })).json()).reminder.status, 'cancelled');
  await fetch(base + '/api/session/end', { method: 'POST', headers: { cookie: alice } });
  assert.equal((await call(alice, { action: 'list' })).status, 401);
 } finally { globalThis.fetch=originalFetch; await new Promise((resolve) => server.close(resolve)); if(!resolve(testData).startsWith(testRoot+sep)||!basename(testData).startsWith('noor-security-http-'))throw Error('Unsafe test cleanup');await rm(testData,{recursive:true,force:true}); }
});
