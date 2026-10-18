const allowedStatuses = new Set(['submitted', 'acknowledged', 'in_progress', 'completed', 'cancelled']);
const openStatuses = new Set(['submitted', 'acknowledged', 'in_progress']);
const nextStatus = { submitted:'acknowledged', acknowledged:'in_progress', in_progress:'completed' };
const label = status => status === 'in_progress' ? 'in progress' : status;

export function cleanCrewQueue(rows) {
 if (!Array.isArray(rows)) return [];
 return rows.slice(0,200).filter(row => row && typeof row.id === 'string' && typeof row.sessionId === 'string' && /^[0-9]{1,2}[A-F]$/.test(row.seat) && allowedStatuses.has(row.status))
  .map(row => ({id:row.id,sessionId:row.sessionId,seat:row.seat,status:row.status,category:String(row.category||'general').slice(0,40),details:String(row.details||'').slice(0,300),createdAt:row.createdAt||null}));
}

export function crewToolResult(name,input,rows,snapshotAt,source='confirmed') {
 const base={status:'ok',simulated:true,source,snapshotAt,limitations:['Fictional demo queue; no message is sent and no status is changed.']};
 const seat=typeof input?.seat==='string' && /^[0-9]{1,2}[A-F]$/i.test(input.seat)?input.seat.toUpperCase():null;
 if(name==='get_queue_summary') {
  const counts={submitted:0,acknowledged:0,in_progress:0,completed:0,cancelled:0};
  for(const row of rows) counts[row.status]++;
  return {...base,facts:{total:rows.length,open:rows.filter(row=>openStatuses.has(row.status)).length,counts}};
 }
 if(name==='list_crew_requests') {
  const status=allowedStatuses.has(input?.status)?input.status:null;
  const selected=rows.filter(row=>(!seat||row.seat===seat)&&(!status||row.status===status));
  return {...base,facts:{total:selected.length,requests:selected.slice(0,10).map(({sessionId,details,...row})=>row),truncated:selected.length>10}};
 }
 if(name==='get_crew_request') {
  const row=rows.find(row=>row.id===input?.requestId);
  if(!row)return {...base,status:'not_found',facts:{request:null}};
  const {sessionId,...request}=row;
  return {...base,facts:{request}};
 }
 return {...base,status:'invalid',facts:{}};
}

function line(row,includeDetails=true) {
 const detail=includeDetails&&row.details ? `: passenger-reported “${row.details}”` : '';
 return `Seat ${row.seat}${detail} (${label(row.status)}; request ${row.id}).`;
}

export function validatedCrewAnswer(plan, evidence, rows, {source='confirmed',snapshotAt=new Date().toISOString(),question=''}={}) {
 const safe={source,snapshotAt,handover:false};
 if(!plan || typeof plan!=='object' || !Array.isArray(evidence)||!evidence.length) return {...safe,reply:'I could not verify the current queue. Please refresh and try again.'};
 const used=new Set(),listed=new Set(),fetched=new Set(),seatLists=new Map();
 for(const item of evidence) {
  if(item?.status!=='ok'||item.snapshotAt!==snapshotAt||item.source!==source)continue;
  if(item.name==='get_queue_summary')used.add('summary');
  if(item.name==='list_crew_requests') {used.add('list');for(const row of item.facts?.requests||[])listed.add(row.id);if(!item.input?.seat&&!item.input?.status)used.add('all_list');if(item.input?.seat&&!item.input?.status)seatLists.set(String(item.input.seat).toUpperCase(),item.facts);}
  if(item.name==='get_crew_request') {used.add('get');if(item.facts?.request?.id)fetched.add(item.facts.request.id);}
 }
 const all=cleanCrewQueue(rows), open=all.filter(row=>openStatuses.has(row.status));
 const ids=Array.isArray(plan.requestIds)?plan.requestIds.filter(id=>typeof id==='string').slice(0,10):[];
 const selected=ids.map(id=>all.find(row=>row.id===id));
 if(selected.some(row=>!row)||new Set(ids).size!==ids.length)return {...safe,reply:'I could not verify those requests. Please refresh the queue.'};
 const seat=typeof plan.seat==='string'&&/^[0-9]{1,2}[A-F]$/i.test(plan.seat)?plan.seat.toUpperCase():null;
 const askedSeat=String(question).toUpperCase().match(/\b[0-9]{1,2}[A-F]\b/)?.[0]||null;
 if(askedSeat && seat && seat!==askedSeat)return {...safe,reply:'I could not verify the requested seat. Please refresh and try again.'};
 const wording=String(question).trim().toLowerCase();
 const requiredKind=/\b(handover|hand off|shift briefing|briefing)\b/.test(wording)?'handover'
  :/\b(draft|wording|reply|respond|say to|tell the passenger)\b/.test(wording)?'draft'
   :/^(?:please\s+)?(?:acknowledge|start|complete|mark)\b/.test(wording)?'proposal':null;
 if(requiredKind&&plan.kind!==requiredKind)return {...safe,reply:'I could not verify enough queue evidence for that answer. Please refresh and try again.'};
 switch(plan.kind) {
  case 'summary':
   if(!used.has('summary'))break;
   return {...safe,reply:`${open.length} open ${source==='sample'?'sample':'confirmed demo'} request${open.length===1?'':'s'} (${open.filter(r=>r.status==='submitted').length} submitted, ${open.filter(r=>r.status==='acknowledged').length} acknowledged, ${open.filter(r=>r.status==='in_progress').length} in progress). Queue checked ${snapshotAt}.`};
  case 'seat':
   if(!seat||!seatLists.has(seat))break;
   {const matching=all.filter(row=>row.seat===seat),facts=seatLists.get(seat);
    return {...safe,reply:matching.length?`Seat ${seat} has ${facts.total} request${facts.total===1?'':'s'}. ${matching.filter(row=>listed.has(row.id)).slice(0,5).map(row=>line(row,false)).join(' ')}${facts.truncated?' More are on the board.':''}`:`No ${source==='sample'?'sample':'confirmed'} request for seat ${seat} appears in this snapshot.`};}
  case 'handover':
   if(!used.has('summary')||!used.has('all_list'))break;
   {const shown=open.filter(row=>listed.has(row.id)).slice(0,8);
    return {...safe,handover:true,reply:`Draft handover · queue checked ${snapshotAt}. ${open.length} open ${source==='sample'?'sample':'confirmed demo'} request${open.length===1?'':'s'}. ${shown.map(row=>line(row)).join(' ')}${open.length>shown.length?` ${open.length-shown.length} more are on the board.`:''} For crew review only; no passenger update has been sent and no status has changed.`};}
  case 'detail':
   if(!used.has('get')||selected.length!==1||!fetched.has(selected[0].id))break;
   if(askedSeat&&selected[0].seat!==askedSeat)break;
   return {...safe,reply:line(selected[0])};
  case 'draft':
   if(!used.has('get')||selected.length!==1||!fetched.has(selected[0].id))break;
   if(askedSeat&&selected[0].seat!==askedSeat)break;
   {const row=selected[0];const sentence=({submitted:'We have your request and the crew will review it.',acknowledged:'The crew has acknowledged your request.',in_progress:'The crew is working on your request.',completed:'The crew marked your request as completed.',cancelled:'Your request was cancelled.'})[row.status];
    return {...safe,reply:`Draft for crew review, seat ${row.seat}: “${sentence}” This has not been sent.`};}
  case 'proposal':
   if(source==='sample'||!used.has('get')||selected.length!==1||!fetched.has(selected[0].id))break;
   {const row=selected[0], status=nextStatus[row.status];
    const requestedTarget=/^(?:please\s+)?(?:acknowledge|mark\b.*\backnowledged\b)/.test(wording)?'acknowledged':/^(?:please\s+)?(?:start|mark\b.*\bin progress\b)/.test(wording)?'in_progress':/^(?:please\s+)?(?:complete|mark\b.*\bcompleted\b)/.test(wording)?'completed':null;
    if(!askedSeat||row.seat!==askedSeat||!status||plan.targetStatus!==status||requestedTarget!==status||all.filter(item=>item.seat===askedSeat&&item.status===row.status).length!==1)break;
    return {...safe,reply:`Review this demo change: ${line(row)} Change status to ${label(status)}? Nothing changes until you confirm.`,proposal:{sessionId:row.sessionId,id:row.id,expectedStatus:row.status,status,seat:row.seat,details:row.details}};}
 }
 return {...safe,reply:'I could not verify enough queue evidence for that answer. Please refresh and try again.'};
}
