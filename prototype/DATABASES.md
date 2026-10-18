# Local database backups and migrations

Noor keeps usage, email, and agent traces in three separate SQLite databases. Chat sessions, crew requests and passenger reminders remain in memory. No cloud database or external backup service was added.

## Back up and verify

From the repository root:

```powershell
npm run db:backup
npm run db:verify -- "<snapshot-directory>"
```

The backup command creates a new timestamped folder under `prototype/data/backups/snapshots/` by default. It honors `NOOR_DATA_DIR`, `NOOR_USAGE_DB`, and `NOOR_EMAIL_DB`, including values in `prototype/.env.local`; process environment variables take precedence. An optional output root can be supplied with `npm run db:backup -- "<backup-root>"`.

Snapshots use SQLite VACUUM INTO, including committed WAL contents, rather than copying a database file while its WAL might hold newer data. Every file receives an integrity check. The manifest stores SHA-256 checksums, schema versions, migration records, and table counts, not row contents. The backup files themselves contain the stored data, including email information if present. Files are restricted to owner read/write where the platform supports Unix permissions; Windows access follows the folder ACL.

The three files are captured sequentially, not as a single cross-database transaction. For a coordinated recovery point, stop Noor before making a backup. Keep an additional copy on separate storage for machine-loss protection. These are manual backups plus automatic pre-migration snapshots; no recurring backup schedule or automatic deletion was added. Backup retention must be managed separately from live-record retention. `prototype/data/`, including snapshots and restore checks, remains ignored by Git and is not served by the app.

## Restore safely

```powershell
npm run db:restore -- "<snapshot-directory>" "<new-empty-path>"
```

The destination must not exist. The command verifies all three snapshots before creating it, then copies and checks the restored databases. It never overwrites the live data directory or starts workers. The checksums detect damage; they are not signatures protecting against an attacker who can replace both files and manifest.

For actual recovery, stop Noor, preserve its current database files and WAL files, restore into a new directory, review pending email delivery state, and deliberately point the server at the recovered files. Historical email state can be behind provider delivery, so reconcile outcomes before running the email worker. Old usage snapshots can also be behind current consumption; retain the current ledger where available. Restoring an old snapshot is not a spending-limit reset mechanism. The supplied restore smoke check only inspects isolated copies and sends nothing.

## Versioned upgrades

`migrations/local-schema.json` contains a separate ordered migration list for each database. Version 1 adopts the existing schema with CREATE TABLE IF NOT EXISTS; it does not recreate or empty tables. Existing baseline columns are checked for compatibility.

Each store checks migrations when it opens. Existing on-disk data gets an integrity-checked snapshot under `data/backups/migrations/` before a pending migration. The migration batch, migration history and SQLite user_version update run in one transaction. A failure rolls the batch back. A checksum history rejects edited applied migrations, a mismatched database family, or a schema version newer than this app understands. No automatic downgrade is attempted.

Append a new consecutive version to change a schema; never edit an applied migration. Add an upgrade/rollback test. Existing databases must upgrade in place and retain their records. This remains a single-server SQLite design; the migration lock is not a replacement for shared storage coordination across multiple app instances.

```powershell
npm run test:database
```

Tests cover legacy adoption, idempotency, successful upgrade, rollback, incompatible schemas, changed/newer migration history, live WAL snapshots, restoration, tamper rejection and refusal to overwrite an existing destination.
