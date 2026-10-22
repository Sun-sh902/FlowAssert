"""TEST ONLY — ID-addressability remediation-03 E2E backend entry.

Runs the backend's OWN unmodified test-only alias launcher
(.phase3a-lookup-runtime/FlowAssert-Phase3A-Service/docs/phase3a/id-addressability-remediation-03/evidence/http_server.py,
byte-identical to the handoff copy) on the genuine composed app (app.history_api.create_history_app) at
127.0.0.1:8765. That launcher registers identity-only aliases: run.identity.id is the ONLY mutation of one of the
five evaluator-backed cases; verdicts, records and evidence are unchanged and never shipped product data.

The frontend suite adds exactly two labelled aliases to the backend's 17 (corpus.ALIASES), for identifiers the
Owner's matrix names that the backend corpus does not contain. They use the same mechanism and are equally
test-only. Nothing else is changed. Usage (from scripts/phase3a/lookup-alias-service.sh):
    .venv/bin/python -B lookup_alias_entry.py OUT_DIR STATE_DIR
"""
import os
import runpy
import sys
from pathlib import Path

RT = Path.cwd().resolve()
EV = RT / "docs/phase3a/id-addressability-remediation-03/evidence"
FRONTEND_ADDED_ALIASES = [
    ("fe-emoji-single", "\U0001F9EA", "SPEC-002"),
    ("fe-bmp128", "中文" * 64, "SPEC-005"),
]
sys.dont_write_bytecode = True
sys.path.insert(0, str(EV))
import corpus  # noqa: E402  (the backend's corpus, imported first so its list can be extended in place)

assert all(identity not in {a[1] for a in corpus.ALIASES} for _, identity, _ in FRONTEND_ADDED_ALIASES)
corpus.ALIASES.extend(FRONTEND_ADDED_ALIASES)
sys.argv = [str(EV / "http_server.py"), sys.argv[1], sys.argv[2]]
runpy.run_path(str(EV / "http_server.py"), run_name="__main__")
