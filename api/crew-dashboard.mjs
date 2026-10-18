import {json,sameOrigin} from '../lib/vercel-shared.mjs';
import {crewAccessConfigured,validCrewCode,crewAuthorized,crewAccessCookie,clearCrewAccessCookie} from '../lib/crew-dashboard-auth.mjs';
import {supabaseEnabled,listStoredCrewRequests,updateStoredCrewRequest} from '../lib/supabase-store.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export async function POST(request){
 if(!sameOrigin(request))return json({error:'Request origin is not allowed.'},403);
 let input;
 try{if(Number(request.headers.get('content-length'))>1000)return json({error:'Invalid request.'},400);const text=await request.text();if(text.length>1000)return json({error:'Invalid request.'},400);input=JSON.parse(text);}catch{return json({error:'Invalid request.'},400);}
 if(!input||typeof input!=='object')return json({error:'Invalid request.'},400);
 if(input.action==='logout')return json({signedOut:true},200,{'set-cookie':clearCrewAccessCookie()});
 if(!crewAccessConfigured())return json({error:'Demo crew access is not configured.'},503);
 if(input.action==='login')return validCrewCode(input.code)?json({signedIn:true},200,{'set-cookie':crewAccessCookie()}):json({error:'Crew access code was not accepted.'},401);
 if(!crewAuthorized(request))return json({error:'Crew sign-in is required.'},401);
 try{
  if(!supabaseEnabled())throw Error('Storage required');
  if(input.action==='list')return json({requests:await listStoredCrewRequests()});
  if(input.action==='update'){
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
