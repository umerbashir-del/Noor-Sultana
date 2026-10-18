import {createHostedTestBackend} from '../lib/test-hosted-backend.mjs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {after,test} from 'node:test';
import {POST as start} from './session.mjs';
import {POST as chat} from './chat.mjs';
import {POST as end} from './session/end.mjs';
process.env.NOOR_SESSION_SECRET=randomBytes(32).toString('hex');
process.env.ANTHROPIC_API_KEY='offline-test-key';
process.env.SUPABASE_URL='https://demo.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test_only';
const originalFetch=globalThis.fetch;
let modelFetch;const backend=createHostedTestBackend((...args)=>modelFetch(...args));globalThis.fetch=backend.fetch;
after(()=>{globalThis.fetch=originalFetch;});
const request=(path,cookie,body,origin='https://noor.example')=>new Request('https://noor.example'+path,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
const cookieOf=response=>response.headers.get('set-cookie').split(';')[0];
const response=content=>Response.json({content,usage:{input_tokens:10,output_tokens:5}});
const final=reply=>response([{type:'text',text:JSON.stringify({reply,expression:'thoughtful'})}]);

test('hosted chat keeps server conversation history with the mandatory harness',async()=>{
 let cookie=cookieOf(await start(request('/api/session')));const seen=[];
 modelFetch=async(url,options)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');const body=JSON.parse(options.body);assert.ok(body.tools.length);seen.push(body.messages);return final('Welcome aboard.');};
 const first=await chat(request('/api/chat',cookie,{message:'Hello Noor'}));assert.equal(first.status,200);cookie=cookieOf(first);
 assert.equal((await chat(request('/api/chat',cookie,{message:'What did you say?'}))).status,200);
 assert.deepEqual(seen[1],[{role:'user',content:'Hello Noor'},{role:'assistant',content:'Welcome aboard.'},{role:'user',content:'What did you say?'}]);
 assert.match((await end(request('/api/session/end',cookie))).headers.get('set-cookie'),/Max-Age=0/);
});

test('omitted, false, malformed and true useTools flags all enforce fresh hosted evidence',async()=>{
 for(const flag of [undefined,false,null,'false',true]){
 const cookie=cookieOf(await start(request('/api/session')));let calls=0;
 modelFetch=async(url,options)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');const body=JSON.parse(options.body);assert.ok(body.tools.every(t=>t.input_schema.additionalProperties===false));return ++calls===1?response([{type:'tool_use',id:'status',name:'flight_status',input:{flightId:'CL204'}}]):final('We are on time.');};
 const reply=await chat(request('/api/chat',cookie,{message:'Are we delayed?',demoScenario:'delayed',...(flag!==undefined?{useTools:flag}:{})}));assert.equal(reply.status,200);const result=await reply.json();assert.equal(result.evidenceStatus,'grounded');assert.deepEqual(result.toolsUsed,['flight_status']);assert.match(result.reply,/Delayed by 45 minutes/);assert.ok(!result.reply.includes('We are on time'));assert.equal(calls,2);
 }
});

test('hosted final answers block unsupported completion claims with or without the legacy flag',async()=>{
 for(const useTools of [false,true]){const cookie=cookieOf(await start(request('/api/session')));modelFetch=async url=>{assert.equal(url,'https://api.anthropic.com/v1/messages');return final('I have submitted your crew request and sent your email.');};const r=await chat(request('/api/chat',cookie,{message:'Hello',useTools}));assert.equal(r.status,200);const result=await r.json();assert.equal(result.evidenceStatus,'limited');assert.match(result.reply,/cannot confirm/);assert.deepEqual(result.toolsUsed,[]);assert.ok(!result.reply.includes('I have submitted'));}
});

test('hosted action tools only report preparation availability and never submit',async()=>{
 const cookie=cookieOf(await start(request('/api/session')));let calls=0;
 modelFetch=async url=>{assert.equal(url,'https://api.anthropic.com/v1/messages');return ++calls===1?response([{type:'tool_use',id:'crew',name:'prepare_crew_request',input:{category:'seat',details:'Seat assistance'}}]):final('I submitted the request.');};
 const r=await chat(request('/api/chat',cookie,{message:'Could someone help with my seat?',useTools:false}));assert.equal(r.status,200);const result=await r.json();assert.equal(result.crewAssistance,false);assert.match(result.reply,/local demo only/);assert.ok(!result.reply.includes('I submitted'));
});

test('hosted weather uses the tool result rather than a direct legacy model path',async()=>{
 const cookie=cookieOf(await start(request('/api/session')));let models=0;const hosts=[];
 modelFetch=async(url,options)=>{const address=new URL(url);hosts.push(address.hostname);if(address.hostname==='geocoding-api.open-meteo.com')return Response.json({results:[{name:'Paris',country:'France',latitude:48.85,longitude:2.35,timezone:'Europe/Paris',population:2100000}]});if(address.hostname==='api.open-meteo.com')return Response.json({timezone:'Europe/Paris',current:{time:Math.floor(Date.now()/1000),temperature_2m:19,weather_code:3}});assert.equal(address.hostname,'api.anthropic.com');return ++models===1?response([{type:'tool_use',id:'weather',name:'weather',input:{location:'Paris, France',when:'current'}}]):final('Paris is overcast and 19°C.');};
 const r=await chat(request('/api/chat',cookie,{message:'What is the weather in Paris, France?'}));assert.equal(r.status,200);const result=await r.json();assert.equal(result.weather.city,'Paris');assert.equal(result.weather.temperatureC,19);assert.deepEqual(result.toolsUsed,['weather']);assert.ok(hosts.includes('geocoding-api.open-meteo.com'));
});

test('origin and session checks run before any hosted model call',async()=>{
 modelFetch=async()=>{throw Error('Must not contact any provider');};assert.equal((await start(request('/api/session',null,null,'https://other.example'))).status,403);assert.equal((await chat(request('/api/chat',null,{message:'Hello'}))).status,401);
});
