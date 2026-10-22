# Round 02 — known limitations and unresolved blockers

## Unresolved blockers (for a separate Round 02 hardening task — not fixed in this round)

An independent audit reported reproducibility and regression-integrity issues. **Its findings were not provided in
this working session**, so they are not reproduced here and none is marked resolved. The items below are the issues
observed directly during Round 02; they must be reconciled with the audit's list in the hardening task.

| # | Blocker | Evidence |
| --- | --- | --- |
| B1 | **Regression not green.** e2e-lookup and e2e-local each fail one Chrome test with the F15 capture-after-close mechanism; 7 e2e-local tests did not run. The round-02 mitigation is insufficient. | REGRESSION_RESULTS.md |
| B2 | **F15 harness defect now reachable in Chrome**, not only Firefox. Root fix (capture helpers settling or awaiting before close) is a harness change the accepted register says needs its own scope. | `e2e-*/support.ts` capture helpers |
| B3 | **Fresh-clone reproducibility is machine-bound.** The bootstrap needs the npm/PyPI indexes (the offline uv cache lacked the wheels); the `--harness` stage and several unit-test fakes read accepted sources by absolute path under `/Users/zhangshenghe/Documents`; on another machine those suites are skipped (`describe.skipIf`) or fail. | bootstrap.sh, `test/local/fake*.ts` |
| B4 | **Restored protected-integrity test needs `FLOWASSERT_PROTECTED_PARENT`** whenever the checkout is not a sibling of the protected roots (default `ROOT.parent` fails loudly). | service/scripts/protected_integrity.py |
| B5 | **One unexplained e2e-history F14 failure** during development (no retained log); later 15/15 and 4 full green runs. Flakiness not bounded statistically. | REGRESSION_RESULTS.md |
| B6 | **Evidence consistency:** `screenshots/after/` were captured before the final 375 px label fix; the fresh-clone set `screenshots/after-fresh-clone/` reflects commit `86bec55`. Only one full regression after the commit (fresh clone); none in the main workspace. | screenshots/ |
| B7 | `rules-cls-probe` gate stops its preview with `pkill -f 'vite preview --port 4184'`, which would also stop an unrelated process with that command line. | scripts/dev/regression.sh |
| B8 | Synthetic archive identities and timestamps are not deterministic across seeds (inputs, evaluator results and comparisons are). | scripts/dev/seed.sh |

## Product limitations (by design in this round)

- Live list = the five reviewed handoff IDs, one Detail read each (≤ 2 in flight); never a source population. No list endpoint was added.
- Comparison identity = verification ID, workspace, input evidence digest, evaluator model + source commit, contract (pinned pair `0.1.1-proposed` ↔ `0688d55d…`). The catalog snapshot is shown but cannot be an identity key: the Service derives it from the catalog including execution timestamps, so it changes on every Service start.
- The seeded `dev-main` archive holds two evaluations of each identical input; the Detail therefore reports "2 archived evaluations match this exact input — none is chosen". A single navigable match is shown with `dev-single`.
- Overview/Verifications compare result summaries; the full byte-level result comparison is done on the Detail (canonical JSON; "not checkable" where the browser cannot reproduce Python bytes).
- Service status reflects only the newest read's outcome plus an explicit Check; it says nothing about capture, admission, n8n or HubSpot. "Stale" after 120 s without a read.
- Capture and Evidence Admission remain **not implemented**; no capture action exists. Demo pages remain MOCK under `#/demo`.
- `ui/scripts/phase3a/prepare_runtime.py` (accepted harness) still checks the pre-remediation manifest and exits 1; the workspace uses `scripts/dev/prepare_harness_runtime.py` instead. The accepted script is unchanged.
- Firefox not run (F15). P3A-AUD-001 remains OPEN.
