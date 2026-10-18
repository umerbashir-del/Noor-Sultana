import test from 'node:test';import assert from 'node:assert/strict';
import {actionClaimCheck} from './action-claims.mjs';
import {answerWithTools,executePassengerTool,passengerTools} from './agent.mjs';
import {createTraceStore} from './trace-store.mjs';
test('unsupported active, passive, terse and promised actions are blocked',()=>{
 for(const reply of ["I have submitted your crew request and sent your email.","I've saved your reminder.",'Your reminder has been saved.','Your email was sent.','Your reservation is confirmed.','Your reminder is all set.','The crew are on their way.','Done!','Submitted your request.','Your email: sent.','Your reminder is now saved.','No real crew has been contacted, but I sent your email.',"I'll send your email now.",'We successfully booked your flight.'])assert.equal(actionClaimCheck(reply).blocked,true,reply);
});
test('negations, review instructions and factual travel answers remain readable',()=>{
 for(const reply of ['Nothing has been submitted or scheduled; review and confirm below.','I have not sent an email.','No real crew has been contacted.','If your flight is cancelled, ask the airline for help.','Your reminder has not been saved.','Review the exact time and confirm saving.','The airline can help with your booking.','Fictional CL 204 demo: Landed.','How can I help with your journey?']){const result=actionClaimCheck(reply);assert.equal(result.blocked,false,reply);assert.equal(result.reply,reply);}
});
test('a direct model success claim is replaced and traced without executing an action',async()=>{
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(t=>t.name)});
 try{const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:'Hello'}],traceFactory:()=>store.start(),callModel:async()=>({content:[{type:'text',text:'{"reply":"I have submitted your crew request and sent your email."}'}]}),execute:async()=>{throw Error('No action may execute');}});assert.equal(result.evidenceStatus,'limited');assert.match(result.reply,/cannot confirm/);assert.deepEqual(result.toolsUsed,[]);const rows=store.read();assert.ok(rows.some(e=>e.event==='action_claim_blocked'));assert.equal(rows.at(-1).metadata.evidenceStatus,'limited');assert.ok(!JSON.stringify(rows).includes('sent your email'));}finally{store.close();}
});
test('preparation output overrides model claims and still requires review',async()=>{
 let rounds=0;const result=await answerWithTools({apiKey:'offline',model:'test',system:'scope',messages:[{role:'user',content:'Please help with my seat'}],callModel:async()=>++rounds===1?{content:[{type:'tool_use',id:'crew',name:'prepare_crew_request',input:{category:'seat',details:'Seat assistance'}}]}:{content:[{type:'text',text:'{"reply":"I submitted the request."}'}]},execute:executePassengerTool});assert.equal(result.crewAssistance,true);assert.match(result.reply,/confirm/);assert.match(result.reply,/nothing has been submitted/i);assert.ok(!result.reply.includes('I submitted'));
});
