import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabases, verifyBackup, restoreBackup } from '../prototype/database-backup.mjs';
const [command,...args]=process.argv.slice(2);
try{
 const local=readFileSync(new URL('../prototype/.env.local',import.meta.url),'utf8');
 for(const line of local.split(/\r?\n/)){
  const match=line.match(/^\s*(?:export\s+)?(NOOR_DATA_DIR|NOOR_USAGE_DB|NOOR_EMAIL_DB)\s*=\s*(.*?)\s*$/);
  if(match&&!Object.hasOwn(process.env,match[1]))process.env[match[1]]=match[2].replace(/^(?:"(.*)"|'(.*)')$/,(_,a,b)=>a??b??'');
 }
}catch(error){if(error.code!=='ENOENT')throw error;}
const data=resolve(process.env.NOOR_DATA_DIR||fileURLToPath(new URL('../prototype/data/',import.meta.url)));
if(command==='backup'){
 const result=backupDatabases({usage:resolve(process.env.NOOR_USAGE_DB||resolve(data,'usage.sqlite')),email:resolve(process.env.NOOR_EMAIL_DB||resolve(data,'email.sqlite')),traces:resolve(data,'agent-traces.sqlite')},args[0]||resolve(data,'backups','snapshots'));
 console.log(JSON.stringify({backup:result.directory,databases:result.manifest.databases.map(e=>({kind:e.kind,version:e.version,rows:e.rows}))}));
}else if(command==='verify'&&args.length===1){
 const manifest=verifyBackup(args[0]);console.log(JSON.stringify({verified:true,databases:manifest.databases.map(e=>({kind:e.kind,version:e.version}))}));
}else if(command==='restore'&&args.length===2){
 console.log(JSON.stringify(restoreBackup(args[0],args[1])));
}else{
 console.error('Usage: node scripts/database.mjs backup [backup-root] | verify <snapshot-directory> | restore <snapshot-directory> <new-directory>');process.exitCode=1;
}
