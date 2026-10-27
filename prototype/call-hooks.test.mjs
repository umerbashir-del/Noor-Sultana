import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallHooks, HookBlocked } from './call-hooks.mjs';
import { answerWithTools, executePassengerTool, passengerTools } from './agent.mjs';
import { createTraceStore } from './trace-store.mjs';
const text = () => ({ content: [{ type: 'text', text: '{"reply":"Please ask cabin crew.","expression":"thoughtful"}' }] });
const tool = () => ({ content: [{ type: 'tool_use', id: 'private-tool-id', name: 'flight_status', input: { flightId: 'CL204' } }] });
const base = { apiKey: 'secret-test-key', model: 'claude-test', system: 'PRIVATE prompt', messages: [{ role: 'user', content: 'Hello' }] };
const phases = ['beforeModel','afterModel','beforeTool','afterTool'];

test('model/tool hooks run in registration order around actual calls and see only frozen metadata', async () => {
 const order=[], snapshots=[];
 const hooks=Object.fromEntries(phases.map(phase=>[phase,[1,2].map(index=>async metadata=>{
  order.push(phase+index);snapshots.push(metadata);assert.ok(Object.isFrozen(metadata));
 })]));
 let round=0;
 await answerWithTools({...base,hooks,requiredHooks:{beforeModel:[()=>{order.push('modelGuard');return true;}],beforeTool:[()=>{order.push('toolGuard');return true;}]},
  callModel:async()=>{order.push('model');return ++round===1?tool():text();},
  execute:async(...args)=>{order.push('tool');return executePassengerTool(...args);}});
 assert.deepEqual(order,['modelGuard','beforeModel1','beforeModel2','model','afterModel1','afterModel2','toolGuard','beforeTool1','beforeTool2','tool','afterTool1','afterTool2','modelGuard','beforeModel1','beforeModel2','model','afterModel1','afterModel2']);
 for(const secret of ['PRIVATE','secret-test-key','private-tool-id','Hello','CL204'])assert.ok(!JSON.stringify(snapshots).includes(secret));
 assert.equal(snapshots.find(row=>row.tool==='flight_status'&&row.status==='success').resultStatus,'ok');
});

test('optional hook throws, rejects, times out or attempts mutation without stopping chat',async()=>{
 const failures=[];let aborted=false,calls=0;
 const runner=createCallHooks({timeoutMs:5,emit:(event,fields)=>{if(event==='hook_failure')failures.push(fields);},hooks:{beforeModel:[
  ()=>{throw Error('PRIVATE exception');},async()=>{throw Error('PRIVATE async error');},
  (metadata,signal)=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;})),
  metadata=>{metadata.status='error';},()=>{calls++;},
 ]}});
 await runner('beforeModel',{model:'claude-test',status:'started',apiKey:'PRIVATE'});
 assert.equal(calls,1);assert.equal(aborted,true);assert.equal(failures.length,4);
 assert.equal(failures[2].errorKind,'hook_timeout');assert.ok(!JSON.stringify(failures).includes('PRIVATE'));
 const answer=await answerWithTools({...base,hooks:Object.fromEntries(phases.map(phase=>[phase,[()=>{throw Error('PRIVATE');}]])),callModel:async()=>text()});
 assert.equal(answer.reply,'Please ask cabin crew.');
});

for(const failure of ['deny','missing-return','throw','timeout']) {
 test('required model hook fails closed on '+failure+' and still runs afterModel',async()=>{
  let called=false;const after=[];
  const guard=()=>{if(failure==='throw')throw Error('PRIVATE');if(failure==='timeout')return new Promise(()=>{});return failure==='deny'?false:undefined;};
  await assert.rejects(()=>answerWithTools({...base,hookTimeoutMs:5,requiredHooks:{beforeModel:[guard]},hooks:{afterModel:[metadata=>after.push(metadata)]},callModel:async()=>{called=true;return text();}}),error=>{
   assert.ok(error instanceof HookBlocked);assert.equal(error.code,'hook_blocked');assert.ok(!error.message.includes('PRIVATE'));return true;
  });
  assert.equal(called,false);assert.equal(after.length,1);assert.equal(after[0].status,'error');assert.equal(after[0].errorKind,'hook_blocked');
 });
}

test('blocked tool never executes; afterTool observes denial and model receives safe feedback',async()=>{
 let rounds=0,executed=0;const after=[];
 const answer=await answerWithTools({...base,requiredHooks:{beforeTool:[()=>false]},hooks:{afterTool:[metadata=>after.push(metadata)]},
  callModel:async(args)=>{if(++rounds===1)return tool();assert.equal(args.messages.at(-1).content[0].is_error,true);assert.ok(!JSON.stringify(args.messages).includes('required check'));return text();},
  execute:async()=>{executed++;throw Error('must not execute');}});
 assert.equal(executed,0);assert.deepEqual(answer.toolsUsed,[]);
 assert.equal(after.length,1);assert.equal(after[0].status,'error');assert.equal(after[0].errorKind,'hook_blocked');
});

test('afterModel preserves provider error even when optional observers fail',async()=>{
 const original=Error('PRIVATE provider error'),after=[];
 await assert.rejects(()=>answerWithTools({...base,hooks:{afterModel:[metadata=>after.push(metadata),()=>{throw Error('observer error');}]},callModel:async()=>{throw original;}}),error=>error===original);
 assert.equal(after[0].status,'error');assert.equal(after[0].errorKind,'model_unavailable');
 assert.ok(!JSON.stringify(after).includes('PRIVATE'));
});

for(const failure of ['throw','malformed']) {
 test('afterTool reports '+failure+' as an error without replacing safe tool feedback',async()=>{
  let rounds=0;const after=[];
  await answerWithTools({...base,hooks:{afterTool:[metadata=>after.push(metadata),()=>{throw Error('observer error');}]},
   execute:async()=>{if(failure==='throw')throw Error('PRIVATE');return {reply:'PRIVATE malformed output'};},
   callModel:async(args)=>{if(++rounds===1)return tool();assert.equal(args.messages.at(-1).content[0].is_error,true);assert.ok(!JSON.stringify(args.messages).includes('PRIVATE malformed'));return text();}});
  assert.equal(after[0].status,'error');assert.equal(after[0].errorKind,'tool_failed');
 });
}

test('hook events persist sanitized outcomes; broken trace emitters do not change hook decisions',async()=>{
 const store=createTraceStore({dbPath:':memory:',toolNames:passengerTools.map(tool=>tool.name)});
 try {
  await answerWithTools({...base,traceFactory:()=>store.start(),hooks:{beforeModel:[()=>{throw Error('PRIVATE');}]},callModel:async()=>text()});
  const rows=store.read();assert.ok(rows.some(row=>row.event==='hook_failure'&&row.metadata.errorKind==='hook_failed'));
  assert.deepEqual(rows.filter(row=>row.event==='call_hook').map(row=>row.metadata.hookPhase),['beforeModel','afterModel']);
  assert.ok(!JSON.stringify(rows).includes('PRIVATE'));assert.ok(!JSON.stringify(rows).includes('secret-test-key'));
  const run=createCallHooks({emit:()=>{throw Error('disk full');},requiredHooks:{beforeTool:[()=>false]}});
  await assert.rejects(()=>run('beforeTool',{tool:'flight_status'}),HookBlocked);
  const answer=await answerWithTools({...base,traceFactory:()=>({event(){throw Error('disk full');}}),callModel:async()=>text()});
  assert.equal(answer.reply,'Please ask cabin crew.');
 }finally{store.close();}
});

test('required after hooks and invalid required registrations fail closed',()=>{
 assert.throws(()=>createCallHooks({requiredHooks:{afterModel:[()=>true]}}),HookBlocked);
 assert.throws(()=>createCallHooks({timeoutMs:0}),HookBlocked);
 for(const requiredHooks of [null,42,[],{beforeModel:null},{beforeTool:[null]}])assert.throws(()=>createCallHooks({requiredHooks}),HookBlocked);
});

for(const failure of ['throw','timeout']) {
 test('required tool hook '+failure+' cannot reach execution',async()=>{
  let rounds=0,executed=false;const after=[];
  await answerWithTools({...base,hookTimeoutMs:5,requiredHooks:{beforeTool:[()=>{if(failure==='throw')throw Error('PRIVATE');return new Promise(()=>{});}]},
   hooks:{afterTool:[metadata=>after.push(metadata)]},execute:async()=>{executed=true;throw Error('must not execute');},callModel:async()=>++rounds===1?tool():text()});
  assert.equal(executed,false);assert.equal(after[0].errorKind,'hook_blocked');
 });
}

test('invalid model output is reported as an error to afterModel',async()=>{
 const after=[];
 await assert.rejects(()=>answerWithTools({...base,hooks:{afterModel:[metadata=>after.push(metadata)]},callModel:async()=>({content:null})}));
 assert.equal(after[0].status,'error');assert.equal(after[0].errorKind,'invalid_response');
});

test('tool reuse emits reuse evidence rather than a second execution hook',async()=>{
 let rounds=0;const after=[];
 await answerWithTools({...base,messages:[{role:'user',content:'What bags are included?'}],hooks:{afterTool:[metadata=>after.push(metadata)]},
  callModel:async()=>{rounds++;return{content:[{type:'tool_use',id:'bag-'+rounds,name:'baggage_allowance',input:{flightId:'CL204',bagType:'all'}}]};}});
 assert.equal(after.length,1);assert.equal(after[0].tool,'baggage_allowance');
});
