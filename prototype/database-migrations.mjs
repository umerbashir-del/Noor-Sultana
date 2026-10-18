import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { snapshotDatabase } from './database-backup.mjs';
export const localMigrations=JSON.parse(readFileSync(new URL('./migrations/local-schema.json',import.meta.url),'utf8'));
function validateBaseline(db,kind) {
 for(const match of localMigrations[kind][0].sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+) \(([\s\S]*?)\);/gi)){
  const columns=new Map(db.prepare('PRAGMA table_info("'+match[1]+'")').all().map(c=>[c.name,c.type]));
  for(const declaration of match[2].split(',')){
   const column=declaration.trim().match(/^([a-z_]+)\s+(TEXT|INTEGER)\b/i);
   if(column&&columns.get(column[1])!==column[2].toUpperCase())throw new Error('Database baseline schema is incompatible.');
  }
 }
}
export function migrateDatabase(db,kind,{dbPath=':memory:',migrations=localMigrations[kind]}={}) {
 if(!Array.isArray(migrations)||!migrations.length)throw new Error('Unknown database migration family.');
 for(const [index,migration]of migrations.entries())if(migration.version!==index+1||typeof migration.sql!=='string'||!migration.name)throw new Error('Migration versions must be consecutive.');
 const version=db.prepare('PRAGMA user_version').get().user_version;
 const hasLedger=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='noor_schema_migrations'").get();
 const applied=hasLedger?db.prepare('SELECT kind,version,name,checksum FROM noor_schema_migrations ORDER BY version').all():[];
 if(version>migrations.length||applied.length!==version)throw new Error('Unsupported database version or migration history.');
 for(const row of applied){
  const migration=migrations[row.version-1];
  if(row.kind!==kind||row.name!==migration?.name||row.checksum!==createHash('sha256').update(migration.sql).digest('hex'))throw new Error('Migration history mismatch.');
 }
 if(version===migrations.length){validateBaseline(db,kind);return {version,applied:0};}
 const hasData=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
 let backup;
 if(dbPath!==':memory:'&&existsSync(dbPath)&&hasData){
  backup=join(dirname(dbPath),'backups','migrations',kind+'-v'+version+'-'+randomUUID()+'.sqlite');
  snapshotDatabase(db,backup);
 }
 db.exec('BEGIN IMMEDIATE');
 try{
  // Recheck after obtaining the writer lock; another startup must not migrate concurrently.
  if(db.prepare('PRAGMA user_version').get().user_version!==version)throw new Error('Database version changed during migration; retry startup.');
  db.exec('CREATE TABLE IF NOT EXISTS noor_schema_migrations (version INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  for(const migration of migrations.slice(version)){
   db.exec(migration.sql);
   db.prepare('INSERT INTO noor_schema_migrations(version,kind,name,checksum,applied_at) VALUES(?,?,?,?,?)').run(migration.version,kind,migration.name,createHash('sha256').update(migration.sql).digest('hex'),Date.now());
   db.exec('PRAGMA user_version='+migration.version);
  }
  validateBaseline(db,kind);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {version:migrations.length,applied:migrations.length-version,backup};
}
