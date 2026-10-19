import {randomUUID} from 'node:crypto';
// In-memory REST/RPC double. Never forwards network requests.
export function createHostedTestBackend(modelFetch=async()=>{throw Error('Unexpected model call');}) {
 const sessions=new Map(),crewSessions=new Map(),ledger=[];let now=Date.now();
 const day=()=>new Date(now).toISOString().slice(0,10);
 const active=session=>session&&now-session.createdAt<7200000&&now-session.activeAt<900000;
 const backend={sessions,crewSessions,ledger,failReserve:false,failSettle:false,advance:ms=>{now+=ms;},day,fetch:async(url,options={})=>{
  const address=new URL(url);
  if(address.hostname==='api.anthropic.com'){
   if(address.pathname==='/v1/messages/count_tokens')return Response.json({input_tokens:100});
   if(address.pathname==='/v1/messages')return modelFetch(url,options);
   throw Error('Unexpected provider endpoint');
  }
  if(address.hostname!=='demo.supabase.co')return modelFetch(url,options);
  if(options.headers?.apikey!=='sb_secret_test_only')throw Error('Server credential missing');
  const path=address.pathname.replace('/rest/v1/','');const body=options.body?JSON.parse(options.body):{};
  if(path==='noor_demo_sessions'&&options.method==='POST'){sessions.set(body.id,{...body,calls:0,messages:[],createdAt:now,activeAt:now});return new Response(null,{status:201});}
  if(path==='noor_crew_sessions'&&options.method==='POST'){crewSessions.set(body.id,{...body,createdAt:now,expiresAt:now+7200000});return new Response(null,{status:201});}
  if(path==='noor_demo_sessions'&&options.method==='DELETE'){sessions.delete(address.searchParams.get('id')?.replace('eq.',''));return new Response(null,{status:204});}
  const session=sessions.get(body.p_id||body.p_session_id);
  if(path==='rpc/noor_list_crew_requests'){
   return Response.json([...sessions.values()].filter(active).flatMap(s=>(s.demo_actions?.crew?.requests||[]).map(({token,...r})=>({...r,sessionId:s.id}))));
  }
  if(path==='rpc/noor_update_crew_request'){
   if(!active(session))return Response.json('missing');
   const r=session.demo_actions?.crew?.requests.find(r=>r.id===body.p_request_id);if(!r)return Response.json('missing');
   if(r.status===body.p_status)return Response.json('ok');
   if(r.status!==body.p_expected_status)return Response.json('conflict');
   const next={submitted:'acknowledged',acknowledged:'in_progress',in_progress:'completed'};
   if(next[r.status]!==body.p_status)return Response.json('invalid');
   r.status=body.p_status;r.updatedAt=now;session.actions_version=(session.actions_version||0)+1;return Response.json('ok');
  }
  if(path==='rpc/noor_read_demo_actions'){
   if(!active(session))return Response.json({status:'missing'});
   return Response.json({status:'ok',version:session.actions_version||0,state:session.demo_actions||{}});
  }
  if(path==='rpc/noor_commit_demo_actions'){
   if(!active(session))return Response.json('missing');
   if(backend.actionConflicts>0){backend.actionConflicts--;return Response.json('conflict');}
   if((session.actions_version||0)!==body.p_version)return Response.json('conflict');
   session.demo_actions=structuredClone(body.p_state);session.actions_version=(session.actions_version||0)+1;return Response.json('ok');
  }
  if(path==='rpc/noor_reserve_demo_call'){
   if(!active(session)||!session.visitor_hash)return Response.json({status:'missing'});
   if(session.calls>=100)return Response.json({status:'limit'});
   session.calls++;session.activeAt=now;return Response.json({status:'ok',messages:session.messages,memory:session.memory});
  }
  if(path==='rpc/noor_complete_demo_call_v2'){
   if(!active(session))return Response.json(false);
   session.messages=[...session.messages,{role:'user',content:body.p_message},{role:'assistant',content:body.p_reply}].slice(-6);session.memory=body.p_memory;return Response.json(true);
  }
  if(path==='rpc/noor_reserve_demo_model_call'){
   if(backend.failReserve)return new Response(null,{status:503});
   if(!active(session))return Response.json({status:'missing'});
   const global=ledger.filter(r=>r.day===day()),visitor=global.filter(r=>r.visitorHash===session.visitor_hash);
   const tokens=rows=>rows.reduce((sum,r)=>sum+(r.actual??r.reserved),0);
   if(global.length>=body.p_global_requests||tokens(global)+body.p_reserved_tokens>body.p_global_tokens)return Response.json({status:'limit',scope:'global'});
   if(visitor.length>=body.p_visitor_requests||tokens(visitor)+body.p_reserved_tokens>body.p_visitor_tokens)return Response.json({status:'limit',scope:'visitor'});
   const id=randomUUID();ledger.push({id,sessionId:body.p_session_id,visitorHash:session.visitor_hash,day:day(),state:'reserved',reserved:body.p_reserved_tokens,actual:null,createdAt:now});return Response.json({status:'ok',id});
  }
  if(path==='rpc/noor_settle_demo_model_call'){
   if(backend.failSettle)return new Response(null,{status:503});
   const row=ledger.find(r=>r.id===body.p_id&&r.sessionId===body.p_session_id&&r.state==='reserved');if(!row)return Response.json(false);row.state=body.p_state;row.actual=body.p_actual_tokens;return Response.json(true);
  }
  if(path==='rpc/noor_reserve_crew_model_call'){
   if(backend.failReserve)return new Response(null,{status:503});
   const crew=crewSessions.get(body.p_session_id);if(!crew||crew.expiresAt<=now)return Response.json({status:'missing'});
   const global=ledger.filter(r=>r.day===day()),crewDaily=global.filter(r=>r.crewSessionId);
   const sessionRows=ledger.filter(r=>r.crewSessionId===body.p_session_id);
   const tokens=rows=>rows.reduce((sum,r)=>sum+(r.actual??r.reserved),0);
   if(global.length>=body.p_global_requests||tokens(global)+body.p_reserved_tokens>body.p_global_tokens)return Response.json({status:'limit',scope:'global'});
   if(crewDaily.length>=body.p_crew_requests||tokens(crewDaily)+body.p_reserved_tokens>body.p_crew_tokens)return Response.json({status:'limit',scope:'crew'});
   if(sessionRows.length>=body.p_session_requests)return Response.json({status:'limit',scope:'session'});
   if(sessionRows.filter(r=>r.createdAt>now-60000).length>=body.p_minute_requests)return Response.json({status:'limit',scope:'rate'});
   if(sessionRows.some(r=>r.state==='reserved'))return Response.json({status:'limit',scope:'concurrent'});
   const id=randomUUID();ledger.push({id,crewSessionId:body.p_session_id,visitorHash:crew.visitor_hash,day:day(),state:'reserved',reserved:body.p_reserved_tokens,actual:null,createdAt:now});return Response.json({status:'ok',id});
  }
  if(path==='rpc/noor_settle_crew_model_call'){
   if(backend.failSettle)return new Response(null,{status:503});
   const row=ledger.find(r=>r.id===body.p_id&&r.crewSessionId===body.p_session_id&&r.state==='reserved');
   if(!row)return Response.json(false);row.state=body.p_state;row.actual=body.p_actual_tokens;return Response.json(true);
  }
  throw Error('Unexpected offline storage endpoint: '+path);
 }};return backend;
}
