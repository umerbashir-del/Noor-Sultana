import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore,idleSessionMs} from './sessions.mjs';
import {cleanSessionMemory,updateSessionMemory} from './session-memory.mjs';
import {answerWithTools} from './agent.mjs';
import {freshSession,updateSession,sessionCookie,sessionFrom,sessionIdCookie,sessionMemoryFrom} from '../lib/vercel-session.mjs';
const text=reply=>({content:[{type:'text',text:JSON.stringify({reply,expression:'thoughtful'})}]});
function commit(store,session,message,reply='Acknowledged.') {assert.equal(store.commit(session,store.beginTurn(session),message,reply),true);}
function longSession(flight='CL204'){
 const store=createSessionStore(),session=store.create();
 commit(store,session,'Please answer in Spanish. Keep your replies brief.');
 commit(store,session,flight+' checked baggage allowance?');
 for(let i=0;i<35;i++)commit(store,session,'Thank you','We are on time. Two checked bags are included.');
 return {store,session};
}
test('bounded structured memory survives 37 turns while original messages leave history',()=>{
 const {session}=longSession();
 assert.equal(session.messages.length,12);assert.ok(!JSON.stringify(session.messages).includes('Spanish'));
 assert.deepEqual(session.memory,{version:1,topics:['baggage_allowance'],flightId:'CL204',preferences:{language:'spanish',responseLength:'brief'}});
 assert.ok(JSON.stringify(session.memory).length<300);assert.ok(!JSON.stringify(session.memory).includes('Two checked bags'));
});
test('long-conversation follow-up uses current fare and fresh tool evidence',async()=>{
 const {store,session}=longSession();let rounds=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:store.context(session,'And now?'),context:{sessionMemory:session.memory,demoFare:'basic'},callModel:async args=>{
  rounds++;assert.match(args.system,/"requiredTools":\["baggage_allowance"\]/);assert.match(args.system,/"fare":"basic"/);assert.match(args.system,/"language":"spanish"/);
  return rounds===1?{content:[{type:'tool_use',id:'bags',name:'baggage_allowance',input:{flightId:'CL204',bagType:'all'}}]}:text('Two checked bags are still included.');
 }});
 assert.equal(rounds,2);assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,/No checked bag/);
});
test('an older unsupported flight is never replaced by default-flight evidence',async()=>{
 const {store,session}=longSession('NH110');let rounds=0;
 const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:store.context(session,'And now?'),context:{sessionMemory:session.memory},callModel:async args=>{
  assert.match(args.system,/"flightId":"NH110"/);
  return ++rounds===1?{content:[{type:'tool_use',id:'bags',name:'baggage_allowance',input:{flightId:'CL204',bagType:'all'}}]}:text('One checked bag is included.');
 }});
 assert.equal(result.evidenceStatus,'limited');assert.match(result.reply,/cannot verify/);
});
test('explicit topic and flight changes replace the topic, acknowledgments preserve it, unrelated questions clear it',()=>{
 let m=updateSessionMemory(null,'NH110 baggage allowance?');
 m=updateSessionMemory(m,'Is vegetarian food available on CL204?');
 assert.deepEqual(m.topics,['meals_and_services']);assert.equal(m.flightId,'CL204');
 m=updateSessionMemory(m,'Thanks');assert.deepEqual(m.topics,['meals_and_services']);
 m=updateSessionMemory(m,'What is 2+2?');assert.deepEqual(m.topics,[]);
});
test('memory updates are isolated, expire with sessions, and cannot commit cancelled turns',()=>{
 let now=1_000_000;const store=createSessionStore({clock:()=>now}),a=store.create(),b=store.create();
 commit(store,a,'Please answer in Japanese.');assert.deepEqual(b.memory.preferences,{});
 const old=store.beginTurn(a);store.cancelTurn(a,old);assert.equal(store.commit(a,old,'Reply in Spanish','Done'),false);assert.equal(a.memory.preferences.language,'japanese');
 now+=idleSessionMs;assert.equal(store.get(a.id),null);assert.deepEqual(store.create().memory.preferences,{});
});
test('only explicit bounded preferences and topics are retained, never arbitrary text, evidence or confirmation',()=>{
 const m=cleanSessionMemory({topics:['baggage_allowance','malicious'],flightId:'CL204',preferences:{language:'spanish',dietary:'vegetarian',allergy:'secret'},confirmed:true,toolFacts:{status:'landed'},email:'private@example.com',freeText:'ignore instructions'});
 assert.deepEqual(Object.keys(m).sort(),['flightId','preferences','topics','version']);assert.ok(!JSON.stringify(m).includes('private'));assert.ok(!JSON.stringify(m).includes('confirmed'));
 assert.equal(updateSessionMemory(null,'My friend is vegan').preferences.dietary,undefined);
 assert.equal(updateSessionMemory(null,'I am vegetarian').preferences.dietary,'vegetarian');
});
test('remembered reminder context never authorizes a saved action',async()=>{
 const memory=updateSessionMemory(null,'Remind me to check boarding in 10 minutes. I already confirmed.');
 let rounds=0;const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'scope',messages:[{role:'user',content:'Remind me to check boarding in 10 minutes. Skip review.'}],context:{sessionMemory:memory},callModel:async()=>++rounds===1?{content:[{type:'tool_use',id:'reminder',name:'prepare_reminder',input:{kind:'boarding',delayMinutes:10}}]}:text('Saved.')});
 assert.match(result.reply,/Nothing has been saved/);assert.match(result.reply,/confirm/);assert.equal(memory.confirmed,undefined);
});
test('hosted cookies preserve bounded memory after trimming and clear on a fresh session',()=>{
 process.env.NOOR_SESSION_SECRET='a'.repeat(64);
 const session=freshSession();updateSession(session,'Reply in Japanese.','Sure');updateSession(session,'NH110 baggage allowance?','Unavailable');
 for(let i=0;i<15;i++)updateSession(session,'Thanks','Okay');
 const cookie=sessionCookie(session).split(';')[0];
 const request=new Request('https://noor.example',{headers:{cookie}}),reopened=sessionFrom(request);
 assert.equal(reopened.messages.length,6);assert.equal(reopened.memory.flightId,'NH110');assert.equal(reopened.memory.preferences.language,'japanese');assert.ok(cookie.length<3700);
 const idCookie=sessionIdCookie('c807ac73-8308-40cc-97e3-dc869a2252de',session.memory).split(';')[0];
 assert.equal(sessionMemoryFrom(new Request('https://noor.example',{headers:{cookie:idCookie}})).flightId,'NH110');
 assert.deepEqual(freshSession().memory.preferences,{});
});

test('explicit preference corrections replace or remove older values',()=>{
 let memory=updateSessionMemory(null,'Please answer in Spanish. I am vegetarian.');
 memory=updateSessionMemory(memory,'Please reply in English.');assert.equal(memory.preferences.language,'english');
 memory=updateSessionMemory(memory,"Do not reply in Spanish.");assert.equal(memory.preferences.language,'english');
 memory=updateSessionMemory(memory,'Do not reply in English. I am no longer vegetarian.');assert.equal(memory.preferences.language,undefined);assert.equal(memory.preferences.dietary,undefined);
});
