import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedSystem } from './prompt-cache.mjs';
import { requestToolModel, answerWithTools } from './agent.mjs';
import { planClaudeReservation } from './token-budget.mjs';

test('cache marker preserves all text and leaves changing memory outside the prefix', () => {
 const cachePrefix = 'Fixed Noor instructions.';
 for (const suffix of ['', '\nSESSION MEMORY: private passenger preference', '\nNew scenario']) {
  const system = cachePrefix + suffix;
  const blocks = cachedSystem({ system, cachePrefix, promptCaching: true });
  assert.equal(blocks.map(block => block.text).join(''), system);
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral', ttl: '5m' });
  assert.ok(blocks.slice(1).every(block => !block.cache_control));
 }
 assert.equal(cachedSystem({system:'a',cachePrefix:'a'}),'a');
 assert.equal(cachedSystem({system:'a',cachePrefix:'b',promptCaching:true}),'a');
 assert.equal(cachedSystem({system:'a',cachePrefix:'',promptCaching:true}),'a');
});

test('counting and Messages send identical structured prompts, tools and messages', async () => {
 const args={apiKey:'private-test-key',model:'claude-test',system:'Stable\nChanging memory',cachePrefix:'Stable',promptCaching:true,
  tools:[{name:'flight_status',input_schema:{type:'object'}}],messages:[{role:'user',content:'Flight status?'}]};
 const bodies=[];
 const fetchImpl=async(url,options)=>{
  bodies.push(JSON.parse(options.body));
  return Response.json(String(url).endsWith('count_tokens')?{input_tokens:100}:{content:[],usage:{input_tokens:10,output_tokens:2,cache_creation_input_tokens:90,cache_read_input_tokens:0}});
 };
 await planClaudeReservation({...args,fetchImpl});
 const result=await requestToolModel({...args,fetchImpl});
 const {max_tokens,...sent}=bodies[1];
 assert.equal(max_tokens,700);
 assert.deepEqual(bodies[0],sent);
 assert.deepEqual(sent.tools,args.tools);
 assert.deepEqual(sent.messages,args.messages);
 assert.equal(result.usageTokens,102); // Cache writes still count toward usage limits.
 assert.ok(!JSON.stringify(sent).includes('private-test-key'));
 const disabled=[];
 await requestToolModel({...args,promptCaching:false,fetchImpl:async(url,options)=>{disabled.push(JSON.parse(options.body));return Response.json({content:[]});}});
 assert.equal(disabled[0].system,args.system);
});

test('loop supplies fixed prefix before dynamic context without changing model-facing text',async()=>{
 let seen;
 await answerWithTools({apiKey:'offline',model:'claude-test',system:'Noor rules',messages:[{role:'user',content:'Hello'}],
  callModel:async(args)=>{seen=args;return{content:[{type:'text',text:'{"reply":"Welcome aboard."}'}]};}});
 assert.ok(seen.cachePrefix.startsWith('Noor rules'));
 assert.ok(!seen.cachePrefix.includes('SESSION MEMORY ('));
 assert.ok(seen.system.startsWith(seen.cachePrefix));
 assert.ok(seen.system.includes('SESSION MEMORY ('));
});

test('short and changed prefixes are sent unchanged for provider eligibility/invalidation',()=>{
 const original=cachedSystem({system:'a',cachePrefix:'a',promptCaching:true});
 const changed=cachedSystem({system:'b',cachePrefix:'b',promptCaching:true});
 assert.equal(original[0].text,'a');
 assert.equal(changed[0].text,'b');
 assert.notDeepEqual(original,changed); // No padding or stale local prompt cache.
});
