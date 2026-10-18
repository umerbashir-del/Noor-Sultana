import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
const name='noor_crew';
function config(){
 const code=process.env.NOOR_CREW_DASHBOARD_KEY,secret=process.env.NOOR_SESSION_SECRET;
 if(typeof code!=='string'||code.length<32||!/^[a-f0-9]{64}$/i.test(secret||''))throw Error('Crew access is not configured');
 return {code,secret};
}
function digest(value){return createHash('sha256').update(value).digest();}
function signature(payload){const {code,secret}=config();return createHmac('sha256',Buffer.from(secret,'hex')).update('noor-crew:'+code+':'+payload).digest();}
export function validCrewCode(value){return typeof value==='string'&&value.length<=256&&timingSafeEqual(digest(value),digest(config().code));}
export function crewAccessConfigured(){try{config();return true;}catch{return false;}}
export function newCrewSessionId(){return randomUUID();}
export function crewAccessCookie(now=Date.now(),sessionId=newCrewSessionId()){
 if(!/^[a-f0-9-]{36}$/i.test(sessionId))throw Error('Invalid crew session identity');
 const payload=Buffer.from(JSON.stringify({role:'demo-crew',sessionId,expiresAt:now+7200000})).toString('base64url');
 return name+'='+payload+'.'+signature(payload).toString('base64url')+'; Path=/api/crew-dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=7200';
}
export function clearCrewAccessCookie(){return name+'=; Path=/api/crew-dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=0';}
export function crewSessionIdFrom(request,now=Date.now()){
 try{
  const pair=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
  const parts=pair?.slice(name.length+1).split('.');if(parts?.length!==2)return null;
  const given=Buffer.from(parts[1],'base64url'),expected=signature(parts[0]);
  if(given.length!==expected.length||!timingSafeEqual(given,expected))return null;
  const value=JSON.parse(Buffer.from(parts[0],'base64url'));
  return value.role==='demo-crew'&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now&&/^[a-f0-9-]{36}$/i.test(value.sessionId||'')?value.sessionId:null;
 }catch{return null;}
}
export function crewAuthorized(request,now=Date.now()){return crewSessionIdFrom(request,now)!==null;}
