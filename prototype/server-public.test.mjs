import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';

test('health, visitor cookies, origin checks, and session isolation work over HTTP', async () => {
 const testRoot=resolve(tmpdir());
 const testData=await mkdtemp(join(testRoot,'noor-security-http-'));
 process.env.NOOR_DATA_DIR=testData;
 const originalFetch=globalThis.fetch;let modelCalls=0;
 process.env.ANTHROPIC_API_KEY='offline-http-test-key';
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.anthropic.com/v1/messages/count_tokens')return Response.json({input_tokens:100});
  if(String(url)==='https://api.anthropic.com/v1/messages')return Response.json({content:++modelCalls===1?[{type:'tool_use',id:'prepare',name:'prepare_arrival_email',input:{}}]:[{type:'text',text:'{"reply":"Review and confirm below."}'}],usage:{input_tokens:100,output_tokens:20}});
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
  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const avatarManifest = await fetch(`${base}/live2d-local/manifest.json`);
    // Licensed assets are optional in a code-only checkout. Chat and PNG fallback are not.
    if (existsSync(new URL('./live2d-local/manifest.json', import.meta.url))) {
      assert.equal(avatarManifest.status, 200);
      const avatar = await avatarManifest.json();
      const nativeModel = await fetch(`${base}/live2d-local/${avatar.model}`);
      assert.equal(nativeModel.status, 200);
      assert.match(nativeModel.headers.get('content-type'), /application\/json/);
    } else {
      assert.equal(avatarManifest.status, 404);
    }
    const flightPage = await fetch(`${base}/flight-demo.html`);
    assert.equal(flightPage.status, 200);
    assert.match(await flightPage.text(), /src="\.\/assets\/noor\.png"/);
    const fallbackImage = await fetch(`${base}/assets/noor.png`);
    assert.equal(fallbackImage.status, 200);
    assert.match(fallbackImage.headers.get('content-type'), /image\/png/);
    assert.equal((await fetch(`${base}/live2d-local/not-in-manifest.js`)).status, 404);
    assert.equal((await fetch(`${base}/live2d-local/../server.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/avatar.js`)).status, 200);

    const startAlice = await fetch(`${base}/api/session`, { method: 'POST' });
    assert.equal(startAlice.status, 200);
    const aliceCookies = startAlice.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
    assert.match(aliceCookies, /noor_session=/);
    assert.match(aliceCookies, /noor_visitor=/);

    const startBob = await fetch(`${base}/api/session`, { method: 'POST' });
    const bobCookies = startBob.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
    const aliceSession = /noor_session=([a-f0-9]+)/.exec(aliceCookies)[1];
    const bobVisitor = /noor_visitor=([a-f0-9]+)/.exec(bobCookies)[1];
    const mixed = await fetch(`${base}/api/stop`, {
      method: 'POST', headers: { cookie: `noor_session=${aliceSession}; noor_visitor=${bobVisitor}` },
    });
    assert.equal(mixed.status, 401);

    const chat = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { cookie: aliceCookies, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Prepare my arrival email draft.' }),
    });
    assert.equal(chat.status, 200);
    const prepared=await chat.json();
    assert.match(prepared.reply, /review.*confirm/i);
    assert.ok(prepared.emailDraft);

    const forbidden = await fetch(`${base}/api/stop`, {
      method: 'POST', headers: { cookie: aliceCookies, origin: 'https://other.example' },
    });
    assert.equal(forbidden.status, 403);
  } finally {
    globalThis.fetch=originalFetch;
    await new Promise((resolve) => server.close(resolve));
    if(!resolve(testData).startsWith(testRoot+sep)||!basename(testData).startsWith('noor-security-http-'))throw Error('Unsafe test cleanup');await rm(testData,{recursive:true,force:true});
  }
});
