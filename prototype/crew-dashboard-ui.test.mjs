import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

test('crew confirmation is applied even when a queue refresh is in progress',async()=>{
 const elements=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',hidden:false,children:[],append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
  return elements.get(id);
 };
 const submitted={sessionId:'11111111-1111-4111-8111-111111111111',id:'22222222-2222-4222-8222-222222222222',seat:'12A',details:'Seat recline is stuck',category:'seat',status:'submitted',createdAt:Date.now()};
 let listCalls=0,updates=0,releaseRefresh;
 const response=data=>({ok:true,status:200,json:async()=>data});
 const fetch=async(_url,{body})=>{
  const input=JSON.parse(body);
  if(input.action==='list'){
   listCalls++;
   if(listCalls===2)return new Promise(resolve=>{releaseRefresh=()=>resolve(response({requests:[submitted]}));});
   return response({requests:[{...submitted,status:listCalls>2?'acknowledged':'submitted'}]});
  }
  if(input.action==='askClaude')return response({reply:'Review the exact request.',source:'confirmed',snapshotAt:new Date().toISOString(),proposal:{sessionId:submitted.sessionId,id:submitted.id,expectedStatus:'submitted',status:'acknowledged',seat:'12A',details:submitted.details}});
  if(input.action==='update'){updates++;return response({updated:true});}
  throw Error('Unexpected request');
 };
 const document={getElementById:element,createElement:()=>element(Symbol()),querySelectorAll:()=>[]};
 const source=await readFile(new URL('./crew-dashboard.js',import.meta.url),'utf8');
 const context=createContext({document,fetch,Date,setTimeout:()=>1,clearTimeout:()=>{}});
 runInContext(source,context,{filename:'crew-dashboard.js'});
 await new Promise(setImmediate);
 assert.equal(listCalls,1);
 await runInContext('ask("Acknowledge seat 12A")',context);
 assert.equal(element('assistantProposal').hidden,false);
 const pendingRefresh=runInContext('load()',context);
 await new Promise(setImmediate);
 assert.equal(listCalls,2);
 await element('confirmProposal').onclick();
 assert.equal(updates,1);
 assert.match(element('assistantAnswer').textContent,/status updated to Acknowledged/);
 releaseRefresh();
 await pendingRefresh;
 await new Promise(setImmediate);
 assert.equal(listCalls,3);
 assert.equal(runInContext('rows[0].status',context),'acknowledged');
});

test('sample queue is read only and handover text is shown as a review draft',async()=>{
 const elements=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',hidden:false,children:[],append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
  return elements.get(id);
 };
 const sample={sessionId:'10000000-0000-4000-8000-000000000001',id:'20000000-0000-4000-8000-000000000001',seat:'12A',details:'Seat recline is stuck',category:'seat',status:'submitted',createdAt:Date.now()};
 const calls=[];
 const fetch=async(_url,{body})=>{const input=JSON.parse(body);calls.push(input);if(input.action==='list')return {ok:true,json:async()=>({requests:input.sample?[sample]:[]})};if(input.action==='askClaude')return {ok:true,json:async()=>({reply:'12A: seat help requested.',source:'sample',snapshotAt:'2026-10-18T12:00:00.000Z',handover:true,proposal:{id:sample.id,status:'completed'}})};throw Error('Sample queue must not update');};
 const document={getElementById:element,createElement:()=>element(Symbol()),querySelectorAll:()=>[]};
 const source=await readFile(new URL('./crew-dashboard.js',import.meta.url),'utf8');
 const context=createContext({document,fetch,Date,setTimeout:()=>1,clearTimeout:()=>{}});
 runInContext(source,context,{filename:'crew-dashboard.js'});
 await new Promise(setImmediate);
 element('statusFilter').value='active';
 element('queueSource').value='sample';
 element('queueSource').onchange();
 await new Promise(setImmediate);
 assert.equal(element('queueTitle').textContent,'Sample queue · fictional');
 assert.equal(element('requests').children.length,1);
 assert.equal(element('requests').children[0].children[4].textContent,'Read only');
 await runInContext('ask("Prepare a crew handover summary")',context);
 assert.equal(element('handoverDraft').hidden,false);
 assert.equal(element('handoverText').textContent,'12A: seat help requested.');
 assert.match(element('answerSource').textContent,/Sample queue · fictional/);
 assert.equal(element('assistantProposal').hidden,true);
 await element('confirmProposal').onclick();
 assert.equal(calls.some(call=>call.action==='update'),false);
});
