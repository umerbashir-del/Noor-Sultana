import {json,sameOrigin} from './vercel-shared.mjs';
import {sessionIdFrom} from './vercel-session.mjs';
import {supabaseEnabled,readStoredDemoActions,commitStoredDemoActions} from './supabase-store.mjs';
import {CrewError} from '../prototype/crew.mjs';
import {ReminderError} from '../prototype/reminders.mjs';

export function hostedActionHandler(action) {
 return async function POST(request) {
  if(!sameOrigin(request))return json({error:'Request origin is not allowed.'},403);
  const id=sessionIdFrom(request);
  if(!id)return json({error:'Start a new conversation before using demo actions.'},401);
  let input;
  try {
   if(Number(request.headers.get('content-length'))>2500)return json({error:'Action is too long.'},400);
   const body=await request.text();
   if(body.length>2500)return json({error:'Action is too long.'},400);
   input=JSON.parse(body);
  }catch{return json({error:'Please send a valid action.'},400);}
  try {
   if(!supabaseEnabled())return json({error:'Server-backed action storage is required.'},503);
   for(let attempt=0;attempt<3;attempt++){
    const stored=await readStoredDemoActions(id);
    if(stored?.status==='missing')return json({error:'Conversation expired. Start a new one.'},401);
    if(stored?.status!=='ok'||!Number.isSafeInteger(stored.version)||!stored.state||typeof stored.state!=='object'||Array.isArray(stored.state))throw Error('Invalid storage result');
    const state=structuredClone(stored.state),result=action(state,input);
    if(JSON.stringify(state)===JSON.stringify(stored.state))return json(result);
    const saved=await commitStoredDemoActions(id,stored.version,state);
    if(saved==='ok')return json(result);
    if(saved==='missing')return json({error:'Conversation expired. Start a new one.'},401);
    if(saved!=='conflict')throw Error('Invalid commit result');
   }
   return json({error:'Another action changed this conversation. Please review and try again.'},409);
  }catch(error){
   if(error instanceof CrewError||error instanceof ReminderError)return json({error:error.message},error.status);
   return json({error:'Demo action storage is unavailable. Nothing new is confirmed; refresh the status before retrying.'},503);
  }
 };
}
