import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../prototype/',import.meta.url));
const path=resolve(process.env.NOOR_DATA_DIR||resolve(root,'data'),'agent-traces.sqlite');
let db;
try {
 db=new DatabaseSync(path,{readOnly:true});
 const limit=50;
 const rows=db.prepare('SELECT trace_id AS traceId,at_ms AS atMs,event,metadata FROM agent_events ORDER BY seq DESC LIMIT ?').all(limit);
 for(const row of rows.reverse())console.log(JSON.stringify({...row,at:new Date(row.atMs).toISOString(),metadata:JSON.parse(row.metadata)}));
 if(!rows.length)console.log('No agent traces recorded yet.');
}catch{console.error('No readable local agent trace database. Start Noor and use a demo prompt first.');process.exitCode=1;}
finally{db?.close();}
