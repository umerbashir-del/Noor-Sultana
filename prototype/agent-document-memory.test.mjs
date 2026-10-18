import test from 'node:test';import assert from 'node:assert/strict';
import {createSessionStore} from './sessions.mjs';import {updateSessionMemory,cleanSessionMemory} from './session-memory.mjs';
import {findKnowledgeByReferences,readKnowledgeDocument} from './knowledge.mjs';import {answerWithTools} from './agent.mjs';
const ref={id:'baggage',section:'Can I bring this item?'};
function commit(store,session,message,sources=[]){assert.equal(store.commit(session,store.beginTurn(session),message,'Acknowledged.',sources),true);}
test('document references survive history trimming and trigger a fresh cited lookup',async()=>{
 const store=createSessionStore(),session=store.create();commit(store,session,'What do your documents say about a portable charger?');for(let i=0;i<8;i++)commit(store,session,'Thanks');
 assert.ok(!JSON.stringify(store.context(session,'And now?')).includes('portable charger'));assert.deepEqual(session.memory.documents,[ref]);
 let calls=0;const result=await answerWithTools({apiKey:'offline',model:'claude-test',system:'passenger only',messages:store.context(session,'And now?'),context:{sessionMemory:session.memory},callModel:async args=>{
  assert.deepEqual(args.tools.map(t=>t.name),['passenger_guidance']);
  return ++calls===1?{content:[{type:'tool_use',id:'guide',name:'passenger_guidance',input:{question:'What is the current flight status?'}}]}:{content:[{type:'text',text:JSON.stringify({reply:'Check the airline restricted-item guidance.',expression:'thoughtful'})}]};
 }});
 assert.equal(calls,1);assert.ok(result.knowledgeSources.some(s=>s.citationId==='baggage:2'));assert.match(result.reply,/\[baggage:2\]/);assert.deepEqual(result.toolsUsed,['passenger_guidance']);
});
test('references retain no excerpts, facts, confirmation or arbitrary fields',()=>{
 const memory=cleanSessionMemory({topics:['passenger_guidance'],documents:[{...ref,excerpt:'secret',approved:true,confirmed:true},{id:'../secret',section:'Can I bring this item?'}]});
 assert.deepEqual(memory.documents,[ref]);assert.ok(!JSON.stringify(memory).includes('secret'));assert.equal(memory.confirmed,undefined);
 assert.equal(updateSessionMemory(memory,'What is our flight status?').documents,undefined);assert.equal(updateSessionMemory(memory,'What is 2+2?').documents,undefined);
});
test('references re-read updated passages and version metadata rather than remembered facts',async()=>{
 const markdown=await readKnowledgeDocument('baggage');let reads=0;
 const result=await findKnowledgeByReferences([ref],{readDocument:async()=>{reads++;return markdown.replace('0.1','0.2').replace('Do not guess about batteries','Updated draft: do not guess about batteries');}});
 assert.equal(reads,1);assert.equal(result.source.version,'0.2');assert.match(result.excerpt,/Updated draft/);assert.equal(result.retrieval.method,'session-topic-references');
 assert.equal(await findKnowledgeByReferences([ref],{readDocument:async()=> '# Baggage\n### Different heading\nContent'}),null);
});
test('retrieved references commit only with accepted turns and remain conversation-local',()=>{
 const store=createSessionStore(),a=store.create(),b=store.create();
 const stale=store.beginTurn(a);store.cancelTurn(a,stale);assert.equal(store.commit(a,stale,'Hello','reply',[{...ref}]),false);assert.equal(a.memory.documents,undefined);
 commit(store,a,'Please use your documents.',[{...ref}]);assert.deepEqual(a.memory.documents,[ref]);assert.equal(b.memory.documents,undefined);store.end(a.id);assert.equal(store.get(a.id),null);assert.equal(store.create().memory.documents,undefined);
});

test('a direct model answer cannot skip fresh document retrieval after trimming',async()=>{
 const store=createSessionStore(),session=store.create();commit(store,session,'What do your documents say about a portable charger?');for(let i=0;i<8;i++)commit(store,session,'Thanks');
 let executions=0,models=0;
 const {executePassengerTool}=await import('./agent.mjs');
 const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:store.context(session,'And now?'),context:{sessionMemory:session.memory},execute:async(...args)=>{executions++;return executePassengerTool(...args);},callModel:async args=>{models++;assert.equal(executions,1);assert.match(args.system,/REQUIRED DOCUMENT FOLLOW-UP EVIDENCE/);return {content:[{type:'text',text:JSON.stringify({reply:'Use the draft restricted-items guidance [baggage:2].'})}]};}});
 assert.equal(executions,1);assert.equal(models,1);assert.deepEqual(result.toolsUsed,['passenger_guidance']);assert.ok(result.knowledgeSources.some(s=>s.citationId==='baggage:2'));
});
test('failed required document retrieval returns a limitation without calling the model',async()=>{
 const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:'And now?'}],context:{sessionMemory:{topics:['passenger_guidance'],documents:[ref]}},execute:async()=>{throw new Error('Unavailable');},callModel:async()=>{throw new Error('Must not call model');}});
 assert.equal(result.evidenceStatus,'limited');assert.equal(result.knowledgeSources,undefined);assert.match(result.reply,/could not retrieve/);
});

test('mixed-topic follow-ups retrieve retained guidance and fresh dedicated facts after trimming',async()=>{
 const {executePassengerTool}=await import('./agent.mjs');
 const specs=[{message:'Are we delayed, and what do your documents say about a portable charger?',tool:'flight_status',input:{flightId:'CL204'},context:{demoScenario:'landed'},match:/landed/i},{message:'How many checked bags are included, and what do your documents say about a portable charger?',tool:'baggage_allowance',input:{flightId:'CL204',bagType:'all'},context:{demoFare:'basic'},match:/No checked bag is included/i},{message:'Is vegetarian food available, and what do your documents say about a portable charger?',tool:'meals_and_services',input:{flightId:'CL204',category:'menu'},context:{demoScenario:'landed'},match:/service has ended/i}];
 for(const spec of specs){const store=createSessionStore(),session=store.create();commit(store,session,spec.message);for(let i=0;i<7;i++)commit(store,session,'Thanks');let models=0;const executed=[];
 const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:store.context(session,'And now?'),context:{...spec.context,sessionMemory:session.memory},execute:async(...args)=>{executed.push(args[0]);return executePassengerTool(...args);},callModel:async args=>{assert.ok(args.tools.some(t=>t.name==='passenger_guidance'));return ++models===1?{content:[{type:'tool_use',id:'fresh',name:spec.tool,input:spec.input}]}:{content:[{type:'text',text:'{"reply":"Here are the updates."}'}]};}});
 assert.deepEqual(executed,['passenger_guidance',spec.tool]);assert.equal(models,spec.tool==='baggage_allowance'?1:2);assert.equal(result.evidenceStatus,'grounded');assert.match(result.reply,spec.match);assert.match(result.reply,/\[baggage:2\]/);assert.ok(result.knowledgeSources.some(s=>s.citationId==='baggage:2'));
 }
});
