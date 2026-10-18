import {randomUUID} from 'node:crypto';
import {sessionIdCookie,visitorIdFrom,visitorCookie} from '../lib/vercel-session.mjs';
import {createStoredSession,supabaseEnabled} from '../lib/supabase-store.mjs';
import {json,sameOrigin} from '../lib/vercel-shared.mjs';
export async function POST(request) {
 if(!sameOrigin(request))return json({error:'Request origin is not allowed.'},403);
 try{
  if(!supabaseEnabled())return json({error:'Server-backed conversation storage is required.'},503);
  const visitorId=visitorIdFrom(request)||randomUUID();
  const id=await createStoredSession(visitorId);
  const response=json({started:true},200,{'set-cookie':sessionIdCookie(id)});
  response.headers.append('set-cookie',visitorCookie(visitorId));
  return response;
 }catch{return json({error:'Could not start a conversation. Please try again.'},503);}
}
