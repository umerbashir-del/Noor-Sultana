import {json,sameOrigin} from '../lib/vercel-shared.mjs';
import {randomUUID} from 'node:crypto';
import {crewAccessConfigured,validCrewCode,crewSessionIdFrom,newCrewSessionId,crewAccessCookie,clearCrewAccessCookie} from '../lib/crew-dashboard-auth.mjs';
import {supabaseEnabled,listStoredCrewRequests,updateStoredCrewRequest,createStoredCrewSession} from '../lib/supabase-store.mjs';
import {answerCrewQuestion} from '../lib/crew-assistant.mjs';
import {answerCrewWithClaude} from '../lib/crew-claude.mjs';
import {runCrewClaude,CrewBudgetError} from '../lib/crew-budget.mjs';
import {getSampleCrewQueue} from '../lib/crew-sample-queue.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export async function POST(request){
 if(!sameOrigin(request))return json({error:'Request origin is not allowed.'},403);
 let input;
 try{if(Number(request.headers.get('content-length'))>1000)return json({error:'Invalid request.'},400);const text=await request.text();if(text.length>1000)return json({error:'Invalid request.'},400);input=JSON.parse(text);}catch{return json({error:'Invalid request.'},400);}
 if(!input||typeof input!=='object')return json({error:'Invalid request.'},400);
 if(input.action==='logout')return json({signedOut:true},200,{'set-cookie':clearCrewAccessCookie()});
 if(!crewAccessConfigured())return json({error:'Demo crew access is not configured.'},503);
 if(input.action==='login'){
  if(!validCrewCode(input.code))return json({error:'Crew access code was not accepted.'},401);
  try {if(!supabaseEnabled())throw Error('Storage required');const id=newCrewSessionId();await createStoredCrewSession(id);return json({signedIn:true},200,{'set-cookie':crewAccessCookie(Date.now(),id)});}
  catch{return json({error:'Crew sign-in storage is unavailable.'},503);}
 }
 const crewSessionId=crewSessionIdFrom(request);
 if(!crewSessionId)return json({error:'Crew sign-in is required.'},401);
 try{
  if(!supabaseEnabled())throw Error('Storage required');
  if(input.action==='list')return json({requests:input.sample===true?getSampleCrewQueue():await listStoredCrewRequests(),source:input.sample===true?'sample':'confirmed',snapshotAt:new Date().toISOString()});
  if(input.action==='askClaude'){
   if(typeof input.question!=='string'||!input.question.trim()||input.question.length>300||typeof input.sample!=='undefined'&&typeof input.sample!=='boolean')return json({error:'Ask a crew question in 300 characters or fewer.'},400);
   const apiKey=process.env.ANTHROPIC_API_KEY;
   if(!apiKey)return json({error:'Crew Noor is not configured.'},503);
   const source=input.sample===true?'sample':'confirmed', snapshotAt=new Date().toISOString(), queue=source==='sample'?getSampleCrewQueue():await listStoredCrewRequests();
   const traceId=randomUUID(),events=[];
   try{
    const result=await answerCrewWithClaude({question:input.question,queue,source,snapshotAt,apiKey,model:process.env.ANTHROPIC_MODEL||'claude-haiku-5-5',sessionId:crewSessionId,callModel:args=>runCrewClaude(args,crewSessionId),trace:event=>events.push(event)});
    console.info('[crew-trace]',JSON.stringify({traceId,source,events}));
    return json({...result,traceId});
   }catch(error){
    console.info('[crew-trace]',JSON.stringify({traceId,source,events,status:'error',errorKind:error instanceof CrewBudgetError?'budget':'model'}));
    if(error instanceof CrewBudgetError)return json({error:error.message,traceId},error.status);
    return json({error:'Crew Noor is unavailable. Please try again.',traceId},503);
   }
  }
  if(input.action==='ask'){
   if(typeof input.question!=='string'||!input.question.trim()||input.question.length>300)return json({error:'Ask a crew question in 300 characters or fewer.'},400);
   return json(answerCrewQuestion(input.question,await listStoredCrewRequests()));
  }
  if(input.action==='update'){
   if(input.sample===true||getSampleCrewQueue().some(row=>row.sessionId===input.sessionId||row.id===input.id))return json({error:'Sample requests cannot be updated.'},400);
   if(!uuid(input.sessionId)||!uuid(input.id)||!['submitted','acknowledged','in_progress'].includes(input.expectedStatus)||!['acknowledged','in_progress','completed'].includes(input.status))return json({error:'Choose a valid request and status.'},400);
   const result=await updateStoredCrewRequest(input);
   if(result==='missing')return json({error:'This request or conversation is no longer available.'},404);
   if(result==='conflict')return json({error:'The request changed. Refresh before updating it.'},409);
   if(result==='invalid')return json({error:'That status transition is not allowed.'},400);
   if(result!=='ok')throw Error('Invalid storage result');
   return json({updated:true});
  }
  return json({error:'Unsupported crew action.'},400);
 }catch{return json({error:'Crew dashboard storage is unavailable. Refresh before retrying.'},503);}
}
