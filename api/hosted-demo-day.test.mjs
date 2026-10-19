import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {demoDayStart,demoDayEnd,hostedDemoDayActive,practicalUnlimited} from '../lib/hosted-demo-day.mjs';
import {hostedClaudeLimits} from '../lib/hosted-budget.mjs';
import {crewClaudeLimits} from '../lib/crew-budget.mjs';

test('October 19 New York hosted allowance is production-only and expires at local midnight',()=>{
 const production={VERCEL_ENV:'production'};
 assert.equal(hostedDemoDayActive(production,demoDayStart-1),false);
 assert.equal(hostedDemoDayActive(production,demoDayStart),true);
 assert.equal(hostedDemoDayActive(production,demoDayEnd-1),true);
 assert.equal(hostedDemoDayActive(production,demoDayEnd),false);
 assert.equal(hostedDemoDayActive({SUPABASE_URL:'https://hqtdzgusnkpfwrwnlkpv.supabase.co'},demoDayStart),true);
 assert.equal(hostedDemoDayActive({VERCEL_ENV:'preview',SUPABASE_URL:'https://hqtdzgusnkpfwrwnlkpv.supabase.co'},demoDayStart),false);
 assert.equal(hostedDemoDayActive({},demoDayStart),false);
});

test('passenger and crew model caps lift for the day and resume after it',()=>{
 const env={VERCEL_ENV:'production',NOOR_DAILY_CLAUDE_GLOBAL_TOKENS:'300000',NOOR_DAILY_CLAUDE_CREW_TOKENS:'60000'};
 assert.ok(Object.values(hostedClaudeLimits(env,demoDayStart)).every(value=>value===practicalUnlimited));
 assert.ok(Object.values(crewClaudeLimits(env,demoDayStart)).every(value=>value===practicalUnlimited));
 assert.equal(hostedClaudeLimits(env,demoDayEnd).globalTokens,300000);
 assert.equal(crewClaudeLimits(env,demoDayEnd).crewTokens,60000);
 assert.deepEqual(hostedClaudeLimits(env,demoDayEnd),{
  visitorRequests:100,globalRequests:500,visitorTokens:30000,globalTokens:300000,
 });
});

test('session allowance migration changes only question and voice counts',async()=>{
 const historical=await readFile(new URL('../supabase/migrations/20261019_noor_hosted_demo_day_allowance.sql',import.meta.url),'utf8');
 const migration=await readFile(new URL('../supabase/migrations/20261020_noor_session_allowances.sql',import.meta.url),'utf8');
 const functions=text=>text.slice(text.indexOf('create or replace function public.noor_reserve_demo_call'));
 const expected=functions(historical).replaceAll('calls<30','calls<100').replaceAll('calls>=30','calls>=100').replaceAll('voice_calls>=10','voice_calls>=50');
 assert.equal(functions(migration),expected);
});

test('SQL keeps counters and usage while limiting the exception to the same day',async()=>{
 const sql=await readFile(new URL('../supabase/migrations/20261019_noor_hosted_demo_day_allowance.sql',import.meta.url),'utf8');
 assert.match(sql,/2026-10-19T04:00:00Z/);
 assert.match(sql,/2026-10-20T04:00:00Z/);
 assert.match(sql,/set calls=calls\+1/);
 assert.match(sql,/set voice_calls=voice_calls\+1/);
 assert.match(sql,/used_characters=public\.noor_demo_voice_budget\.used_characters\+excluded\.used_characters/);
 assert.match(sql,/calls<30 or public\.noor_demo_unlimited_at\(now\(\)\)/);
 assert.match(sql,/voice_calls>=10 and not public\.noor_demo_unlimited_at\(now\(\)\)/);
 assert.doesNotMatch(sql,/\b(?:delete\s+from|truncate\s+table)\b/i);
 for(const fn of ['noor_reserve_demo_call','noor_reserve_demo_voice_v2']){
  assert.match(sql,new RegExp('revoke all on function public\\.'+fn+'[^;]+from public,anon,authenticated'));
  assert.match(sql,new RegExp('grant execute on function public\\.'+fn+'[^;]+to service_role'));
 }
});
