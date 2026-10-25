import { getJourney } from '../prototype/journeys.mjs';
import {randomUUID} from 'node:crypto';
import {sessionIdCookie,sessionIdFrom,visitorIdFrom,visitorCookie} from '../lib/vercel-session.mjs';
import {createStoredSession,deleteStoredSession,supabaseEnabled} from '../lib/supabase-store.mjs';
import {json,sameOrigin} from '../lib/vercel-shared.mjs';
export async function POST(request) {
 if(!sameOrigin(request))return json({error:'Request origin is not allowed.'},403);
 try{
  if(!supabaseEnabled())return json({error:'Server-backed conversation storage is required.'},503);
  const journey = getJourney(new URL(request.url).searchParams.get('journey') || 'tokyo');
  if (!journey) return json({error:'Please send a valid request.'},400);
  const previous = sessionIdFrom(request);
  if (previous) await deleteStoredSession(previous);
  const visitorId=visitorIdFrom(request)||randomUUID();
  const id=await createStoredSession(visitorId, journey.id);
  const response=json({started:true},200,{'set-cookie':sessionIdCookie(id,{journeyId:journey.id})});
  response.headers.append('set-cookie',visitorCookie(visitorId));
  return response;
 }catch{return json({error:'Could not start a conversation. Please try again.'},503);}
}
