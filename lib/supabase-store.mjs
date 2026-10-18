import { randomUUID, createHash } from 'node:crypto';
import { cleanSessionMemory } from '../prototype/session-memory.mjs';

export function supabaseEnabled() {
  const hasUrl = Boolean(process.env.SUPABASE_URL);
  const hasKey = Boolean(process.env.SUPABASE_SECRET_KEY);
  if (hasUrl !== hasKey) throw new Error('Supabase configuration is incomplete.');
  return hasUrl;
}

async function query(path, { method = 'GET', body, prefer } = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base || '') || !key?.startsWith('sb_secret_')) {
    throw new Error('Invalid Supabase server configuration.');
  }
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    console.error('[Supabase]', method, path.split('?')[0], response.status);
    throw new Error('Supabase storage is unavailable.');
  }
  if (response.status === 204 || prefer === 'return=minimal') return null;
  return response.json();
}

export async function createStoredSession(visitorId) {
  if(!/^[a-f0-9-]{36}$/.test(visitorId||''))throw new Error('Invalid visitor identity.');
  const id = randomUUID();
  await query('noor_demo_sessions', { method: 'POST', body: { id, visitor_hash: createHash('sha256').update(visitorId).digest('hex'), memory: cleanSessionMemory() }, prefer: 'return=minimal' });
  return id;
}

export async function reserveStoredCall(id) {
  const result = await query('rpc/noor_reserve_demo_call', { method: 'POST', body: { p_id: id } });
  return result && typeof result === 'object' ? result : { status: 'missing' };
}

export async function completeStoredCall(id, message, reply, memory) {
  const saved=await query('rpc/noor_complete_demo_call_v2', { method: 'POST', body: { p_id: id, p_message: message, p_reply: reply, p_memory: cleanSessionMemory(memory) } });
  if(saved!==true)throw new Error('Conversation expired before commit.');
}

export async function reserveStoredVoice(id, text, reservationId) {
  return query('rpc/noor_reserve_demo_voice_v2', {
    method: 'POST', body: { p_id: id, p_text: text, p_reservation_id: reservationId },
  });
}

export async function releaseStoredVoice(id, reservationId) {
  return query('rpc/noor_release_demo_voice', {
    method: 'POST', body: { p_id: id, p_reservation_id: reservationId },
  });
}

export async function deleteStoredSession(id) {
  await query(`noor_demo_sessions?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

export async function reserveStoredModelCall(sessionId,reservedTokens,limits) {
 return query('rpc/noor_reserve_demo_model_call',{method:'POST',body:{p_session_id:sessionId,p_reserved_tokens:reservedTokens,p_visitor_requests:limits.visitorRequests,p_global_requests:limits.globalRequests,p_visitor_tokens:limits.visitorTokens,p_global_tokens:limits.globalTokens}});
}
export async function settleStoredModelCall(sessionId,id,actualTokens,state='done') {
 return query('rpc/noor_settle_demo_model_call',{method:'POST',body:{p_session_id:sessionId,p_id:id,p_actual_tokens:actualTokens,p_state:state}});
}

export function readStoredDemoActions(id) {
 return query('rpc/noor_read_demo_actions',{method:'POST',body:{p_id:id}});
}
export function commitStoredDemoActions(id,version,state) {
 return query('rpc/noor_commit_demo_actions',{method:'POST',body:{p_id:id,p_version:version,p_state:state}});
}

export function listStoredCrewRequests(){return query('rpc/noor_list_crew_requests',{method:'POST',body:{}});}
export function updateStoredCrewRequest(input){return query('rpc/noor_update_crew_request',{method:'POST',body:{p_session_id:input.sessionId,p_request_id:input.id,p_expected_status:input.expectedStatus,p_status:input.status}});}
