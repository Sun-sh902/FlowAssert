# FIX01 — remaining risks and blocked checks

| # | Item | Status | Note |
| --- | --- | --- | --- |
| R1 | Off-device backup | **BLOCKED** | Needs an Owner-approved destination (BACKUP_AND_RECOVERY.md). Bundles are local only. |
| R2 | The Owner's two independent audit reports | **BLOCKED** | Not available locally; findings could not be reconciled item by item. The reviewer should map each audit item to F01–F19 or report it as open. |
| R3 | Protected-source custody off this machine | BLOCKED by design | Needs the genuine roots; reported BLOCKED (exit 77) and the regression exits 3. Verified PASS here. |
| R4 | `bootstrap.sh --harness` and every browser gate are machine-bound | Open (declared) | The accepted harness scripts (unchanged) read sources at fixed `/Users/zhangshenghe/Documents/…` paths. Now pre-checked and BLOCKED (exit 30) with a list. Making them portable means changing accepted harness scripts — needs its own scope. |
| R5 | Browser regression not green (B1, B2: F15 capture-after-close in Chrome; B5) | **OUT OF SCOPE — FIX02** | Not run as a verdict in FIX01. The Round 02 regression is not declared green. |
| R6 | Existing workspaces must rebuild harness runtimes once | Expected effect | Runtimes created before F11's completion record have none; `--harness` exits 31 asking to remove and rebuild them. The main workspace's existing `ui/.phase3a-runtime`, `.phase3a-lookup-runtime`, `.phase2-runtime` are affected. |
| R7 | Main workspace: regression from the main workspace | Not run | Verification was done in recovered clones only (by design: independent run directories). |
| R8 | Audit-mutant replay is optional | Accepted, explicit | Category B evidence outside the repository; reported NOT RUN. Vendoring it would make it portable but turns independent-audit artifacts into our own fixtures — Owner decision. |
| R9 | `FLOWASSERT_INTEGRITY_BASELINE` | Unchanged | `compare()` still honours a baseline under `service/evidence/` whose digest is pinned only for the default file. Not touched, per "do not reintroduce custom-baseline logic"; not used by any gate. |
| R10 | Sandbox simulation | Method limit | "Another machine" was simulated by denying `~/Documents` (EPERM) and by nonexistent override paths (ENOENT) on this Mac. Linux was not tested; scripts are POSIX sh but use `lsof`, `sandbox-exec` (repro only) and macOS paths. |
| R11 | B8 seed non-determinism (archive IDs, timestamps) | Unchanged | Inputs, results and counts are deterministic and now verified; IDs are not. |
| R12 | Vendored handoff bodies | Accepted (Owner-approved) | Provenance: `ui/src/test/fixtures/phase2-handoff/SOURCE.json`; drift from the accepted originals is detectable by the cross-check run (`FLOWASSERT_HANDOFF_HTTP=<original>`). |
