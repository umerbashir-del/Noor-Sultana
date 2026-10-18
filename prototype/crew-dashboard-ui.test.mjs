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
  if(input.action==='ask')return response({reply:'Review the exact request.',proposal:{sessionId:submitted.sessionId,id:submitted.id,expectedStatus:'submitted',status:'acknowledged',seat:'12A',details:submitted.details}});
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
