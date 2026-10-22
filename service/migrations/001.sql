CREATE TABLE archive_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), database_id TEXT NOT NULL UNIQUE);
CREATE TABLE archives (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 history_id TEXT NOT NULL UNIQUE CHECK(length(history_id)=69),
 archive_id TEXT NOT NULL UNIQUE,
 snapshot_id TEXT NOT NULL UNIQUE,
 verification_id TEXT NOT NULL,
 original_snapshot_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 candidate BLOB NOT NULL CHECK(typeof(candidate)='blob'),
 candidate_sha256 TEXT NOT NULL CHECK(length(candidate_sha256)=64),
 seal TEXT NOT NULL CHECK(length(seal)=64),
 state TEXT NOT NULL CHECK(state IN ('BUILDING','PUBLISHED'))
);
CREATE INDEX history_verification_sequence ON archives(verification_id, sequence DESC);
CREATE TABLE records (
 history_id TEXT NOT NULL REFERENCES archives(history_id),
 position INTEGER NOT NULL CHECK(position>=0),
 record BLOB NOT NULL CHECK(typeof(record)='blob'),
 PRIMARY KEY(history_id, position)
);
CREATE TABLE evidence (
 history_id TEXT NOT NULL REFERENCES archives(history_id),
 position INTEGER NOT NULL CHECK(position>=0),
 reference_id TEXT NOT NULL,
 original_snapshot_id TEXT NOT NULL,
 reference BLOB NOT NULL CHECK(typeof(reference)='blob'),
 payload BLOB,
 payload_reason TEXT,
 expected_sha256 TEXT,
 PRIMARY KEY(history_id, position),
 UNIQUE(history_id, reference_id),
 CHECK(payload IS NULL OR typeof(payload)='blob')
);
CREATE TABLE seed_sets (
 identity TEXT PRIMARY KEY,
 history_ids BLOB NOT NULL CHECK(typeof(history_ids)='blob')
);
CREATE TRIGGER archive_no_update BEFORE UPDATE ON archives WHEN OLD.state='PUBLISHED'
BEGIN SELECT RAISE(ABORT, 'published archive immutable'); END;
CREATE TRIGGER archive_no_delete BEFORE DELETE ON archives
BEGIN SELECT RAISE(ABORT, 'archive deletion forbidden'); END;
CREATE TRIGGER records_no_update BEFORE UPDATE ON records
BEGIN SELECT RAISE(ABORT, 'records immutable'); END;
CREATE TRIGGER records_no_delete BEFORE DELETE ON records
BEGIN SELECT RAISE(ABORT, 'records immutable'); END;
CREATE TRIGGER records_no_late_insert BEFORE INSERT ON records
WHEN (SELECT state FROM archives WHERE history_id=NEW.history_id)='PUBLISHED'
BEGIN SELECT RAISE(ABORT, 'published archive immutable'); END;
CREATE TRIGGER evidence_no_update BEFORE UPDATE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence immutable'); END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence immutable'); END;
CREATE TRIGGER evidence_no_late_insert BEFORE INSERT ON evidence
WHEN (SELECT state FROM archives WHERE history_id=NEW.history_id)='PUBLISHED'
BEGIN SELECT RAISE(ABORT, 'published archive immutable'); END;
CREATE TRIGGER seed_no_update BEFORE UPDATE ON seed_sets
BEGIN SELECT RAISE(ABORT, 'seed identity immutable'); END;
CREATE TRIGGER seed_no_delete BEFORE DELETE ON seed_sets
BEGIN SELECT RAISE(ABORT, 'seed identity immutable'); END;
