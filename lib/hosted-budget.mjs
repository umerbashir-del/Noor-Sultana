import {planClaudeReservation} from '../prototype/token-budget.mjs';
import {requestToolModel} from '../prototype/agent.mjs';
import {reserveStoredModelCall,settleStoredModelCall} from './supabase-store.mjs';
import {hostedDemoDayActive,practicalUnlimited} from './hosted-demo-day.mjs';
export class HostedBudgetError extends Error {
 constructor(status=503,scope){super(status===429?'Noor has reached today’s usage limit. Please try tomorrow.':status===401?'Your conversation has ended. Please start a new one.':'Spending checks are unavailable. Please try again later.');this.status=status;this.scope=scope;}
}
export function hostedClaudeLimits(env=process.env,now=Date.now()) {
 const defaults={visitorRequests:30,globalRequests:500,visitorTokens:30000,globalTokens:300000};
 const keys={visitorRequests:'VISITOR_REQUESTS',globalRequests:'GLOBAL_REQUESTS',visitorTokens:'VISITOR_TOKENS',globalTokens:'GLOBAL_TOKENS'};
 for(const [key,suffix] of Object.entries(keys)){
  const raw=env['NOOR_DAILY_CLAUDE_'+suffix];if(raw===undefined||raw==='')continue;
  const value=Number(raw);if(!Number.isSafeInteger(value)||value<1||value>2147483647)throw new HostedBudgetError();defaults[key]=value;
 }
 if(hostedDemoDayActive(env,now))for(const key of Object.keys(defaults))defaults[key]=practicalUnlimited;
 return defaults;
}
export async function runHostedClaude(args,sessionId,{count=planClaudeReservation,requestModel=requestToolModel,reserve=reserveStoredModelCall,settle=settleStoredModelCall,env=process.env}={}) {
 let reservation,id;
 try{
  const limits=hostedClaudeLimits(env);
  reservation=await count({...args,maxOutputTokens:700});
  const held=await reserve(sessionId,reservation.reservedTokens,limits);
  if(held?.status==='limit')throw new HostedBudgetError(429,held.scope==='global'?'global':'visitor');
  if(held?.status==='missing')throw new HostedBudgetError(401);
  if(held?.status!=='ok'||typeof held.id!=='string'||!/^[a-f0-9-]{36}$/.test(held.id))throw new HostedBudgetError();
  id=held.id;
 }catch(error){throw error instanceof HostedBudgetError?error:new HostedBudgetError();}
 try{
  const result=await requestModel({...args,maxOutputTokens:700});
  const actual=Number.isSafeInteger(result.usageTokens)&&result.usageTokens>=0?result.usageTokens:null;
  let saved;try{saved=await settle(sessionId,id,actual,'done');}catch{throw new HostedBudgetError();}
  if(saved!==true)throw new HostedBudgetError();
  return {...result,reservation};
 }catch(error){
  // A request may have reached Claude: never refund or reset uncertain usage.
  try{await settle(sessionId,id,null,'uncertain');}catch{ /* The existing reservation still counts. */ }
  throw error;
 }
}
