import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const directives = policy => new Map(policy.split(';').map(value=>value.trim().split(/\s+/)).filter(([name])=>name).map(([name,...values])=>[name,values]));
function assertMediaOnly(policy) {
  const parsed=directives(policy);
  assert.deepEqual(parsed.get('media-src'),["'self'",'blob:']);
  for(const name of ['default-src','script-src','style-src','connect-src']) assert.deepEqual(parsed.get(name),["'self'"]);
  assert.deepEqual(parsed.get('object-src'),["'none'"]);
}
test('local app allows generated Blob audio without opening script or network sources',async()=>{
  const server=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
  const policies=[...server.matchAll(/'content-security-policy': "([^"]+)"/g)].map(match=>match[1]);
  const app=policies.find(policy=>policy.startsWith("default-src 'self'"));
  assert.ok(app);assertMediaOnly(app);
  assert.equal(policies.filter(policy=>policy.startsWith("default-src 'none'")).length,2);
});
test('built flight demo receives the same bounded media permission',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  const route=config.headers.find(row=>row.source==='/flight-demo.html');
  assert.ok(route,'The build emits flight-demo.html, not the landing page');
  assertMediaOnly(route.headers.find(header=>header.key==='Content-Security-Policy').value);
  for(const path of ['/','/index.html','/crew-dashboard.html']){
    const policy=config.headers.find(row=>row.source===path).headers.find(header=>header.key==='Content-Security-Policy').value;
    assert.equal(directives(policy).has('media-src'),false,'Unrelated page policy remains unchanged');
  }
});
