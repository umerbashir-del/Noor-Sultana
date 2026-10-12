import { randomUUID } from 'node:crypto';

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

export async function createStoredSession() {
  const id = randomUUID();
  await query('noor_demo_sessions', { method: 'POST', body: { id }, prefer: 'return=minimal' });
  return id;
}

export async function reserveStoredCall(id) {
  const result = await query('rpc/noor_reserve_demo_call', { method: 'POST', body: { p_id: id } });
  return result && typeof result === 'object' ? result : { status: 'missing' };
}

export async function completeStoredCall(id, message, reply) {
  await query('rpc/noor_complete_demo_call', { method: 'POST', body: { p_id: id, p_message: message, p_reply: reply } });
}

export async function deleteStoredSession(id) {
  await query(`noor_demo_sessions?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
}
