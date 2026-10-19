// One-day hosted presentation allowance. All existing usage is still recorded.
// October 19, 2026 in New York runs from 04:00 UTC to 04:00 UTC the next day.
export const demoDayStart = Date.parse('2026-10-19T04:00:00Z');
export const demoDayEnd = Date.parse('2026-10-20T04:00:00Z');
export const practicalUnlimited = 2_147_483_647;

// VERCEL_ENV can be absent when Vercel's optional system-variable exposure is
// disabled. The production Noor Supabase URL is a fallback for that case.
const productionStore = 'https://hqtdzgusnkpfwrwnlkpv.supabase.co';
export function hostedDemoDayActive(env = process.env, now = Date.now()) {
 const production = env.VERCEL_ENV === 'production' ||
  (env.VERCEL_ENV == null && env.SUPABASE_URL === productionStore);
 return production && now >= demoDayStart && now < demoDayEnd;
}
