import test from 'node:test';import assert from 'node:assert/strict';
import {findKnowledge,readKnowledgeDocument} from './knowledge.mjs';
import {checkRetrievedSources} from './retrieval-evaluation.mjs';
test('live source scoring verifies real references and served content',async()=>{
 const found=await findKnowledge('Travelling with medication'),source=found.source;
 const result={knowledgeSources:[source],reply:'Sources (unreviewed drafts): ['+source.citationId+']'};
 const checks=await checkRetrievedSources({sourceIds:[source.citationId]},result,{readPage:async()=>readKnowledgeDocument(source.id)});assert.ok(Object.values(checks).every(Boolean));
 const forged=await checkRetrievedSources({sourceIds:[source.citationId]},{...result,knowledgeSources:[{...source,lineStart:999}]});assert.equal(forged.authentic,false);
 const wrongPage=await checkRetrievedSources({sourceIds:[source.citationId]},result,{readPage:async()=> 'wrong file'});assert.equal(wrongPage.served,false);
});
test('live source scoring rejects missing/invented citations and unsafe source paths without fetching them',async()=>{
 const absent=await checkRetrievedSources({sourceIds:['baggage:3']},{reply:'No citation.'});assert.equal(absent.expectedSources,false);
 const invented=await checkRetrievedSources({sourceIds:[]},{reply:'See [baggage:999].'});assert.equal(invented.noInventedCitations,false);
 const unsafe=await checkRetrievedSources({sourceIds:[]},{reply:'Fake source',knowledgeSources:[{id:'../secret',url:'/knowledge/../secret.md'}]},{readPage:async()=>assert.fail('Unsafe source must not be fetched')});assert.equal(unsafe.authentic,false);
});
