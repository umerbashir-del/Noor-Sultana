import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, copyFileSync, constants, writeFileSync, statSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

export const databaseFiles={usage:'usage.sqlite',email:'email.sqlite',traces:'agent-traces.sqlite'};
export function inspectDatabase(path) {
 const db=new DatabaseSync(path,{readOnly:true});
 try {
  const checks=db.prepare('PRAGMA integrity_check').all();
  if(checks.length!==1||Object.values(checks[0])[0]!=='ok')throw new Error('Database integrity check failed.');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const rows=Object.fromEntries(tables.map(({name})=>[name,db.prepare('SELECT COUNT(*) AS count FROM "'+name.replaceAll('"','""')+'"').get().count]));
  const version=db.prepare('PRAGMA user_version').get().user_version;
  const migrations=rows.noor_schema_migrations===undefined?[]:db.prepare('SELECT kind,version,name,checksum FROM noor_schema_migrations ORDER BY version').all();
  return {version,rows,migrations};
 }finally{db.close();}
}
export function snapshotDatabase(db,destination) {
 const target=resolve(destination);
 if(existsSync(target))throw new Error('Backup destination already exists.');
 mkdirSync(dirname(target),{recursive:true,mode:0o700});
 // VACUUM INTO takes a SQLite snapshot, including committed WAL data.
 db.exec("VACUUM INTO '"+target.replaceAll("'","''")+"'");
 chmodSync(target,0o600);
 return inspectDatabase(target);
}
export function backupDatabases(sources,backupRoot) {
 for(const path of Object.values(sources))if(!statSync(path).isFile())throw new Error('Missing database source.');
 const directory=join(resolve(backupRoot),new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
 mkdirSync(directory,{recursive:true,mode:0o700});
 const manifest={format:1,createdAt:new Date().toISOString(),databases:[]};
 for(const [kind,name]of Object.entries(databaseFiles)){
  const source=sources[kind];if(!source)throw new Error('All three database sources are required.');
  const db=new DatabaseSync(source,{readOnly:true});
  try{
   const target=join(directory,name),inspection=snapshotDatabase(db,target);
   manifest.databases.push({kind,file:name,sha256:createHash('sha256').update(readFileSync(target)).digest('hex'),...inspection});
  }finally{db.close();}
 }
 writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return {directory,manifest};
}
export function verifyBackup(directory) {
 const root=resolve(directory),manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
 if(manifest.format!==1||!Array.isArray(manifest.databases)||manifest.databases.length!==3)throw new Error('Invalid backup manifest.');
 const seen=new Set();
 for(const entry of manifest.databases){
  if(!Object.hasOwn(databaseFiles,entry.kind)||databaseFiles[entry.kind]!==entry.file||seen.has(entry.kind))throw new Error('Invalid database entry.');
  seen.add(entry.kind);
  const path=join(root,entry.file);
  if(createHash('sha256').update(readFileSync(path)).digest('hex')!==entry.sha256)throw new Error('Backup checksum mismatch.');
  const inspected=inspectDatabase(path);
  if(JSON.stringify(inspected)!==JSON.stringify({version:entry.version,rows:entry.rows,migrations:entry.migrations}))throw new Error('Backup metadata mismatch.');
 }
 return manifest;
}
export function restoreBackup(directory,targetDirectory) {
 const manifest=verifyBackup(directory),target=resolve(targetDirectory);
 if(existsSync(target))throw new Error('Restore requires a new directory; existing data is never overwritten.');
 mkdirSync(target,{recursive:true,mode:0o700});
 for(const entry of manifest.databases){
  const destination=join(target,entry.file);
  copyFileSync(join(resolve(directory),entry.file),destination,constants.COPYFILE_EXCL);
  chmodSync(destination,0o600);
  inspectDatabase(destination);
 }
 return {directory:target,databases:manifest.databases.map(e=>({kind:e.kind,version:e.version,rows:e.rows}))};
}
