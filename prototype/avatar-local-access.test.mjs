import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {request} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import vm from 'node:vm';
const source=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
const checkSource=source.slice(source.indexOf('function localAvatarRequestAllowed('),source.indexOf('const localAvatarFiles = new Set();'));
function allowed(host,headers={},enabled=true,rawHeaders){const c={localAvatarEnabled:enabled};vm.createContext(c);vm.runInContext(checkSource,c);return c.localAvatarRequestAllowed({headers:{host,...headers},rawHeaders});}
test('licensed request guard accepts exact loopback authorities and rejects aliases or forwarding',()=>{
 for(const host of ['127.0.0.1','127.0.0.1:4180','localhost','LOCALHOST:80','[::1]','[::1]:4180'])assert.equal(allowed(host),true,host);
 for(const host of [undefined,'noor.example','127.0.0.1.evil','localhost.evil','localhost.','127.1','2130706433','127.0.0.1@evil','localhost:99999','::1','[::1]evil'])assert.equal(allowed(host),false,String(host));
 for(const header of ['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-forwarded-custom','via','x-real-ip','cf-connecting-ip','true-client-ip'])assert.equal(allowed('127.0.0.1:4180',{[header]:''}),false,header);
 assert.equal(allowed('127.0.0.1',{},false),false,'Production/public bind gate stays closed');
 assert.equal(allowed('127.0.0.1',{},true,['Host','127.0.0.1','Host','evil.example']),false,'Duplicate Host fields');
});
test('HTTP licensed assets reject public Host and forwarded requests while normal app remains reachable',async()=>{
 const testData=await mkdtemp(join(tmpdir(),'noor-avatar-access-'));
 Object.assign(process.env,{NODE_ENV:'test',NOOR_HOST:'127.0.0.1',PORT:'0',NOOR_SKIP_VOICE_WARMUP:'1',NOOR_EMAIL_DB:':memory:',NOOR_USAGE_DB:':memory:',NOOR_DATA_DIR:testData,ANTHROPIC_API_KEY:'',RESEND_API_KEY:''});
 let server;
 try {
 const imported=await import('./server.mjs');server=imported.server;if(!server.listening)await once(server,'listening');
 const port=server.address().port;
 const get=(path,headers)=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path,headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  const localHost=`127.0.0.1:${port}`;
  const licensed=existsSync(new URL('./live2d-local/manifest.json',import.meta.url));
  assert.equal(await get('/live2d-local/manifest.json',{host:localHost}),licensed?200:404);
  for(const host of ['localhost:'+port,'[::1]:'+port])assert.equal(await get('/live2d-local/manifest.json',{host}),licensed?200:404);
  for(const host of ['noor.example','127.0.0.1.attacker.example'])assert.equal(await get('/live2d-local/manifest.json',{host}),404);
  for(const header of ['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-forwarded-custom','via','x-real-ip','cf-connecting-ip','true-client-ip'])assert.equal(await get('/live2d-local/manifest.json',{host:localHost,[header]:'proxy-fixture'}),404,header);
  assert.equal(await get('/live2d-local/core/live2dcubismcore.min.js',{host:'public.example'}),404);
  assert.equal(await get('/live2d%2Dlocal/manifest.json',{host:'public.example'}),404,'Decoded path uses same guard');
  assert.equal(await get('/flight-demo.html',{host:'public.example','x-forwarded-proto':'https'}),200,'Only licensed paths are restricted');
  assert.equal(await get('/avatar.js',{host:'public.example','x-forwarded-for':'203.0.113.1'}),200);
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(testData,{recursive:true,force:true});}
});
