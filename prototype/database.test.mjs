import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync,readdirSync,appendFileSync,existsSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateDatabase,localMigrations} from './database-migrations.mjs';
import {backupDatabases,verifyBackup,restoreBackup,databaseFiles} from './database-backup.mjs';
function temp(t){const path=mkdtempSync(join(tmpdir(),'noor-db-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
test('legacy baseline adoption preserves records, is idempotent, and backs up before migration',t=>{
 const root=temp(t),path=join(root,'usage.sqlite'),db=new DatabaseSync(path);
 db.exec(localMigrations.usage[0].sql);
 db.prepare('INSERT INTO usage_events VALUES(?,?,?,?,?,?,?,?)').run('id','day','hash','claude','done',100,80,1);
 try{
  const result=migrateDatabase(db,'usage',{dbPath:path});assert.equal(result.version,1);assert.ok(existsSync(result.backup));
  assert.equal(db.prepare('SELECT actual_tokens FROM usage_events').get().actual_tokens,80);
  assert.equal(migrateDatabase(db,'usage',{dbPath:path}).applied,0);
  assert.equal(readdirSync(join(root,'backups','migrations')).length,1);
 }finally{db.close();}
});
test('failed migrations roll back schema, version, and migration ledger together',t=>{
 const root=temp(t),path=join(root,'usage.sqlite'),db=new DatabaseSync(path);
 try{
  migrateDatabase(db,'usage',{dbPath:path});
  assert.throws(()=>migrateDatabase(db,'usage',{dbPath:path,migrations:[...localMigrations.usage,{version:2,name:'broken',sql:'CREATE TABLE partial(id TEXT); INSERT INTO missing VALUES(1);'}]}));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM noor_schema_migrations').get().count,1);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get(),undefined);
 }finally{db.close();}
});
test('newer versions, changed migration history, and wrong database families are rejected',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  migrateDatabase(db,'usage');
  assert.throws(()=>migrateDatabase(db,'email'),/history mismatch/);
  assert.throws(()=>migrateDatabase(db,'usage',{migrations:[{...localMigrations.usage[0],sql:localMigrations.usage[0].sql+' '}]}),/history mismatch/);
  db.exec('PRAGMA user_version=99');assert.throws(()=>migrateDatabase(db,'usage'),/Unsupported/);
 }finally{db.close();}
});
test('incompatible legacy schemas are not marked as migrated',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(localMigrations.usage[0].sql.replace('actual_tokens INTEGER,',''));
  assert.throws(()=>migrateDatabase(db,'usage'),/incompatible/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='noor_schema_migrations'").get(),undefined);
 }finally{db.close();}
});
test('live WAL snapshots restore all three stores and preserve committed records',t=>{
 const root=temp(t),sources={},connections=[];
 try{
  for(const [kind,file]of Object.entries(databaseFiles)){
   sources[kind]=join(root,file);const db=new DatabaseSync(sources[kind]);connections.push(db);
   db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');migrateDatabase(db,kind,{dbPath:sources[kind]});
   db.exec('CREATE TABLE backup_probe(value TEXT); INSERT INTO backup_probe VALUES(\'committed WAL value\')');
  }
  const snapshot=backupDatabases(sources,join(root,'snapshots'));assert.equal(verifyBackup(snapshot.directory).databases.length,3);
  const target=join(root,'restored');restoreBackup(snapshot.directory,target);
  for(const name of Object.values(databaseFiles)){
   const db=new DatabaseSync(join(target,name));try{assert.equal(db.prepare('SELECT value FROM backup_probe').get().value,'committed WAL value');}finally{db.close();}
  }
  assert.throws(()=>restoreBackup(snapshot.directory,target),/new directory/);
  appendFileSync(join(snapshot.directory,'usage.sqlite'),'tampered');
  assert.throws(()=>restoreBackup(snapshot.directory,join(root,'rejected')),/checksum/);
  assert.equal(existsSync(join(root,'rejected')),false);
 }finally{for(const db of connections)db.close();}
});

test('a subsequent migration upgrades once and records its version without losing data',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  migrateDatabase(db,'usage');
  db.prepare('INSERT INTO usage_events VALUES(?,?,?,?,?,?,?,?)').run('id','day','hash','claude','done',100,80,1);
  const migrations=[...localMigrations.usage,{version:2,name:'example-upgrade',sql:'ALTER TABLE usage_events ADD COLUMN extra TEXT;'}];
  assert.equal(migrateDatabase(db,'usage',{migrations}).version,2);
  assert.equal(migrateDatabase(db,'usage',{migrations}).applied,0);
  assert.equal(db.prepare('SELECT actual_tokens,extra FROM usage_events').get().actual_tokens,80);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM noor_schema_migrations').get().count,2);
 }finally{db.close();}
});
