import {readKnowledgeDocument,parseKnowledgeDocument} from './knowledge.mjs';
export async function checkRetrievedSources(turn,result,{readPage=async()=>null}={}) {
 const sources=Array.isArray(result.knowledgeSources)?result.knowledgeSources:[],expected=turn.sourceIds;
 const checks={expectedSources:expected.every(id=>sources.some(s=>s.citationId===id)),boundedSources:sources.length<=6,
  noUnexpectedSourcesWhenNoneExpected:expected.length>0||sources.length===0,cited: sources.every(s=>result.reply?.includes('['+s.citationId+']')),
  authentic:true,served:true,draftLabel:!sources.length||/unreviewed drafts/i.test(result.reply)};
 for(const source of sources){
  if(typeof source.id!=='string'||source.url!=='/knowledge/'+source.id+'.md'){checks.authentic=false;checks.served=false;continue;}
  try{
   const markdown=await readKnowledgeDocument(source.id);
   if(!markdown){checks.authentic=false;checks.served=false;continue;}
   const passage=parseKnowledgeDocument(source.id,markdown).find(p=>p.source.citationId===source.citationId);
   checks.authentic&&=Boolean(passage&&['id','title','version','review','status','url','section','lineStart','lineEnd','citationId','contentHash','documentHash'].every(key=>source[key]===passage.source[key]));
   // Fetch only after the allowlisted ID has been resolved locally.
   const served=await readPage(source.url);checks.served&&=served===null||served===markdown;
  }catch{checks.authentic=false;checks.served=false;}
 }
 const ids=new Set(sources.map(s=>s.citationId));
 checks.noInventedCitations=[...(result.reply||'').matchAll(/\[([a-z-]+:\d+)\]/g)].every(match=>ids.has(match[1]));
 return checks;
}
