"""Create the Phase 3A frontend test archives through the reviewed backend seed pipeline.

    /usr/bin/python3 -I -B scripts/phase3a/seed_states.py

Every state lives inside the isolated runtime copy (.phase3a-runtime/FlowAssert-Phase3A-Service/.runtime/<name>),
because the backend confines private state to its own checkout (app/history_security.state_directory).
All writes go through the unchanged CLI (archive_cli.py, wrapped by the backend's own test-only socket
audit scripts/guarded_entry.py). No input file, fixture or evidence is imported; the CLI has no import.

  ui-main          seed, repeat seed (must reuse the same five IDs, 0 evaluations), seed --reevaluate
                   (a second genuine five-case batch) → 10 archive entries; then check.
  ui-empty         init only → a valid, empty archive (list returns items=[], total=0).
  ui-corrupt       seed, then ONE deliberate test-only damage: the SPEC-002 archive's first stored evidence
                   BLOB is replaced by valid canonical JSON with different content (digest no longer matches).
  ui-unverifiable  seed, then ONE deliberate test-only damage: the SPEC-003 archive's second stored evidence
                   BLOB (an available reference) is set to NULL (expected content missing).
The two damaged stores are negative fixtures for integrity-failure tests; they are never used as the main store.
Refuses to reuse an existing state. Writes command records to docs/phase3a/evidence/seed/.
"""
import json, os, sqlite3, subprocess, sys, time

UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.join(UI, ".phase3a-runtime/FlowAssert-Phase3A-Service")
RUNTIME = os.path.join(ROOT, ".runtime")
OUT = os.path.join(UI, "docs/phase3a/evidence/seed")
PY = os.path.join(ROOT, ".venv/bin/python")


def private_dir(path):
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)


def cli(label, state, *args):
    net = os.path.join(RUNTIME, "net", f"{label}.json")
    env = {"PATH": "/usr/bin:/bin", "HOME": os.environ.get("HOME", ""), "PYTHONDONTWRITEBYTECODE": "1", "LC_ALL": "C",
           "TMPDIR": os.path.join(RUNTIME, "tmp"), "FLOWASSERT_NETWORK_AUDIT": net}
    argv = [PY, "-B", "scripts/guarded_entry.py", "archive_cli.py", "--state", os.path.join(RUNTIME, state), *args]
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    p = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True, text=True)
    record = {"label": label, "argv": argv, "cwd": ROOT, "started_at": started, "exit": p.returncode, "stdout": p.stdout, "stderr": p.stderr,
              "network_audit": json.load(open(net)) if os.path.exists(net) else None}
    with open(os.path.join(OUT, f"{label}.json"), "w") as f:
        json.dump(record, f, indent=1)
    if p.returncode != 0:
        sys.exit(f"{label} failed ({p.returncode}): {p.stderr}")
    return json.loads(p.stdout)


def damage(state, verification_id, position, mode, label):
    db = os.path.join(RUNTIME, state, "history.sqlite3")
    before = os.stat(db)
    c = sqlite3.connect(db, isolation_level=None)
    try:
        c.execute("PRAGMA journal_mode=DELETE")
        hid, ref_id, payload = c.execute(
            "SELECT e.history_id, e.reference_id, e.payload FROM evidence e JOIN archives a ON a.history_id=e.history_id "
            "WHERE a.verification_id=? AND e.position=? ORDER BY a.sequence LIMIT 1", (verification_id, position)).fetchone()
        if mode == "different-content":
            value = json.loads(payload)
            value["phase3a_test_damage"] = "content replaced after archival"
            new = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()
        else:
            new = None
        # Same method as the backend's own reviewed negative probe (scripts/runtime_probe.py): the
        # immutability trigger is dropped, one BLOB is changed, and the identical trigger is restored, so
        # the schema signature still matches and only stored content differs.
        trigger = c.execute("SELECT sql FROM sqlite_master WHERE name='evidence_no_update'").fetchone()[0]
        c.execute("BEGIN IMMEDIATE")
        c.execute("DROP TRIGGER evidence_no_update")
        c.execute("UPDATE evidence SET payload=? WHERE history_id=? AND position=?", (new, hid, position))
        c.execute(trigger)
        c.commit()
    finally:
        c.close()
    after = os.stat(db)
    record = {"label": label, "state": state, "history_id": hid, "verification_id": verification_id, "position": position, "reference_id": ref_id,
              "mode": mode, "old_payload_sha256": __import__("hashlib").sha256(payload).hexdigest(),
              "new_payload_sha256": None if new is None else __import__("hashlib").sha256(new).hexdigest(),
              "db_mode_before": oct(before.st_mode & 0o777), "db_mode_after": oct(after.st_mode & 0o777), "nlink": after.st_nlink,
              "side_files": [s for s in ("-journal", "-wal", "-shm") if os.path.exists(db + s)]}
    with open(os.path.join(OUT, f"{label}.json"), "w") as f:
        json.dump(record, f, indent=1)
    return record


def main():
    os.makedirs(OUT, exist_ok=True)
    for d in (RUNTIME, os.path.join(RUNTIME, "tmp"), os.path.join(RUNTIME, "net")):
        private_dir(d)
    for s in ("ui-main", "ui-empty", "ui-corrupt", "ui-unverifiable"):
        if os.path.exists(os.path.join(RUNTIME, s)):
            sys.exit(f"refusing to reuse existing state {s}")
    summary = {}
    a = cli("ui-main-seed-initial", "ui-main", "seed")
    b = cli("ui-main-seed-repeat", "ui-main", "seed")
    assert a["history_ids"] == b["history_ids"] and b["reused"] is True and b["evaluations"] == 0, "repeat seed must reuse IDs"
    c = cli("ui-main-seed-reevaluate", "ui-main", "seed", "--reevaluate")
    assert not set(a["history_ids"]) & set(c["history_ids"]), "reevaluation must create distinct identities"
    chk = cli("ui-main-check", "ui-main", "check")
    assert chk["validated_archives"] == 10, chk
    summary["ui-main"] = {"initial": a["history_ids"], "reevaluated": c["history_ids"], "source_set_sha256": a["source_set_sha256"], "check": chk}
    cli("ui-empty-init", "ui-empty", "init")
    summary["ui-empty"] = {"check": cli("ui-empty-check", "ui-empty", "check")}
    s = cli("ui-corrupt-seed", "ui-corrupt", "seed")
    summary["ui-corrupt"] = {"history_ids": s["history_ids"], "damage": damage("ui-corrupt", "SPEC-002", 0, "different-content", "ui-corrupt-damage")}
    s = cli("ui-unverifiable-seed", "ui-unverifiable", "seed")
    summary["ui-unverifiable"] = {"history_ids": s["history_ids"], "damage": damage("ui-unverifiable", "SPEC-003", 1, "null-payload", "ui-unverifiable-damage")}
    with open(os.path.join(OUT, "states.json"), "w") as f:
        json.dump(summary, f, indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
