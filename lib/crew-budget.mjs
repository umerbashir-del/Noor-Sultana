import {planClaudeReservation} from '../prototype/token-budget.mjs';
import {requestToolModel} from '../prototype/agent.mjs';
import {hostedClaudeLimits} from './hosted-budget.mjs';
import {reserveStoredCrewModelCall,settleStoredCrewModelCall} from './supabase-store.mjs';

export class CrewBudgetError extends Error{
 constructor(status=503,scope){
  super(status===429?'Crew Noor has reached a usage or rate limit. Please try again later.':status===401?'Your crew session has ended. Please sign in again.':'Crew spending checks are unavailable. Please try again later.');
  this.status=status;this.scope=scope;
 }
}

export function crewClaudeLimits(env=process.env){
 const common=hostedClaudeLimits(env);
 // These request counts are model rounds. A normal crew question uses two rounds.
 const limits={crewRequests:80,crewTokens:60000,sessionRequests:40,minuteRequests:6,globalRequests:common.globalRequests,globalTokens:common.globalTokens};
 const keys={crewRequests:'CREW_REQUESTS',crewTokens:'CREW_TOKENS',sessionRequests:'CREW_SESSION_REQUESTS',minuteRequests:'CREW_MINUTE_REQUESTS'};
 for(const [key,suffix] of Object.entries(keys)){
  const raw=env['NOOR_DAILY_CLAUDE_'+suffix];if(raw===undefined||raw==='')continue;
  const value=Number(raw);if(!Number.isSafeInteger(value)||value<1||value>2147483647)throw new CrewBudgetError();
  limits[key]=value;
 }
 return limits;
}

export async function runCrewClaude(args,crewSessionId,{count=planClaudeReservation,requestModel=requestToolModel,reserve=reserveStoredCrewModelCall,settle=settleStoredCrewModelCall,env=process.env}={}){
 let reservation,id;
 try{
  if(!/^[a-f0-9-]{36}$/i.test(crewSessionId||''))throw new CrewBudgetError(401);
  const limits=crewClaudeLimits(env);
  reservation=await count({...args,maxOutputTokens:700});
  if(!Number.isSafeInteger(reservation?.reservedTokens)||reservation.reservedTokens<1)throw new CrewBudgetError();
  const held=await reserve(crewSessionId,reservation.reservedTokens,limits);
  if(held?.status==='limit')throw new CrewBudgetError(429,held.scope);
  if(held?.status==='missing')throw new CrewBudgetError(401);
  if(held?.status!=='ok'||typeof held.id!=='string'||!/^[a-f0-9-]{36}$/i.test(held.id))throw new CrewBudgetError();
  id=held.id;
 }catch(error){throw error instanceof CrewBudgetError?error:new CrewBudgetError();}
 try{
  const result=await requestModel({...args,maxOutputTokens:700});
  const actual=Number.isSafeInteger(result.usageTokens)&&result.usageTokens>=0?result.usageTokens:null;
  const saved=await settle(crewSessionId,id,actual,'done');
  if(saved!==true)throw new CrewBudgetError();
  return {...result,reservation};
 }catch(error){
  // Once the model request may have started, its reserved tokens remain charged.
  try{await settle(crewSessionId,id,null,'uncertain');}catch{}
  throw error;
 }
}
