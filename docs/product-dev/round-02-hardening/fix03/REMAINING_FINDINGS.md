# FIX03 — Remaining findings

**Status: DRAFT.**

## Blocking the FIX03 handoff

| ID | Item | Owner action |
| --- | --- | --- |
| R-01 | FIX02 has no independent acceptance on record (review run in progress at `203f702`). FIX03 is uncommitted by Owner decision. | Complete the FIX02 review. Then: commit FIX03, run the full regression and hand the commit to the FIX03 reviewer. |
| R-02 | Browser suites (Chrome, WebKit) not run on the fixed tree; see REGRESSION_RESULTS.md. | Run after R-01. |

## Not changed in FIX03 (outside a confirmed defect, or would broaden scope)

| ID | Item | Why it was left |
| --- | --- | --- |
| R-03 | `ArchiveIndex.unexpected` is computed but never rendered, and its comment says entries are "kept visible". | The schema admits only `SPEC-001…005`, so the field is always empty (F-04c, FALSE_POSITIVE). Removing or rendering it is a clean-up, not a fix. |
| R-04 | `SideFailure.integrity` (Workspace live/archive comparison) is still a boolean. | It only chooses SERVICE_UNAVAILABLE vs INCONCLUSIVE. The Workspace notice that words the outcome (`ArchiveIntegrityFailure`) already separates FAILED from UNVERIFIABLE. |
| R-05 | `recordIssue` gives "Insufficient evidence" for a record that is Unverified only because of `existed_by_deadline` / `workflow_execution`. | True as stated. The sheet and summary now name the rule. |
| R-06 | The MOCK adapter (`adapters/researchToView.ts`) has its own `recordSummary`. | MOCK fixtures set both optional flags to `false`; the shared sheet now shows the rows if they ever appear. |
| R-07 | Touch-target report at 375px will list fewer theme buttons (roving tabindex). | Expected consequence of the radio-group pattern; the button size is unchanged. |
| R-08 | Screen-reader and Firefox testing. | Not part of this workspace's suites (README "Known limitations" 5). |

## Not a FIX03 matter

- Off-device recovery remains as FIX01 reported (Owner action).
- The empty, untracked `FIX01`–`FIX04` folders at the repository root (each holding only `.DS_Store` and an empty
  `final-audit-01/`) were left untouched.
