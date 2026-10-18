import test from 'node:test';
import assert from 'node:assert/strict';
import { passengerTools,validateToolInput } from './tool-contracts.mjs';
import { executePassengerTool } from './tool-executor.mjs';
import { fixtureInput } from './test-tool-inputs.mjs';

test('all 13 public tools expose explicit closed schemas, never generic query inputs',()=>{
 assert.equal(passengerTools.length,13);
 for(const tool of passengerTools){
  assert.equal(tool.input_schema.additionalProperties,false);
  assert.equal(Object.hasOwn(tool.input_schema.properties,'query'),false);
  assert.throws(()=>validateToolInput(tool.name,{query:'legacy input'}),error=>error.code==='invalid_arguments');
  validateToolInput(tool.name,fixtureInput(tool.name,'Baggage allowance'));
 }
});
test('field-specific validation does not echo private field names or values',()=>{
 try{validateToolInput('translate_travel_phrase',{phrase:'private passenger text',language:'French',privateSecret:'sk-private'});assert.fail('must reject');}
 catch(error){
  assert.equal(error.code,'invalid_arguments');
  assert.ok(error.fieldErrors.some(e=>e.field==='language'));
  assert.ok(!JSON.stringify(error.fieldErrors).includes('private'));
 }
 assert.throws(()=>validateToolInput('baggage_allowance',{flightId:'CL204',bagType:'all',fare:'business'}));
 assert.throws(()=>validateToolInput('prepare_reminder',{kind:'boarding',delayMinutes:0}));
 assert.throws(()=>validateToolInput('flight_status',[]));
});
test('real deterministic adapters share typed result and evidence envelopes',async()=>{
 for(const name of passengerTools.map(t=>t.name).filter(n=>!['weather','flight_tracking'].includes(n))){
  const result=await executePassengerTool(name,fixtureInput(name,'Where is baggage claim?'),{local:true,originalMessage:'Please help with my seat'});
  assert.equal(result.tool,name);
  assert.match(result.id,/^[a-f0-9-]{36}$/);
  assert.ok(['ok','unsupported','unavailable','needs_confirmation'].includes(result.status));
  assert.equal(typeof result.simulated,'boolean');
  assert.equal(typeof result.confirmationRequired,'boolean');
  assert.ok(Array.isArray(result.limitations));
  assert.ok(Number.isFinite(Date.parse(result.observedAt)));
 }
});
test('unsupported scope and hosted action preparation have explicit non-evidence statuses',async()=>{
 const other=await executePassengerTool('flight_status',{flightId:'NH110'});
 assert.equal(other.status,'unsupported');assert.equal(other.facts,null);
 const hosted=await executePassengerTool('prepare_reminder',{kind:'boarding'},{local:false});
 assert.equal(hosted.status,'unavailable');
 assert.equal(hosted.confirmationRequired,false);
 const reminder=await executePassengerTool('prepare_reminder',{kind:'boarding',delayMinutes:1},{local:true});
 assert.equal(reminder.status,'needs_confirmation');
 assert.equal(reminder.facts.saved,false);
 const crew=await executePassengerTool('prepare_crew_request',{category:'comfort',details:'A pillow please'},{local:true,originalMessage:'A pillow please'});
 assert.equal(crew.facts.submitted,false);
 assert.equal(crew.crewProposal.category,'comfort');
});


test('malformed result envelopes are rejected before they can serve as evidence',async()=>{
 const {validateToolResult}=await import('./tool-contracts.mjs');
 const good=await executePassengerTool('flight_status',{flightId:'CL204'});
 validateToolResult(good,'flight_status');
 for(const patch of [{facts:null},{status:'invented'},{observedAt:'not-a-date'},{scope:null},{confirmationRequired:true},{tool:'baggage_allowance'}]){
  assert.throws(()=>validateToolResult({...good,...patch},'flight_status'),error=>error.code==='invalid_result');
 }
});
