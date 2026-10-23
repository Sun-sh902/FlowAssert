# FIX04 remaining limitations

**Acceptance**

- Independent FIX04 acceptance is pending. Implementation-side verification, including the exact-commit clean clone,
  is not an independent approval.

**Scope and environment**

- Local synthetic research only. No n8n/HubSpot connection, credential, external deployment or Phase 3B-1 acquisition
  was attempted. Capture and admission remain not implemented.
- Off-device backup is BLOCKED pending an approved destination and a verified copy. Local bundles on the same disk do not
  protect against disk or folder loss.
- The harness and browser gates are machine-bound. They read the accepted historical sources under
  `/Users/zhangshenghe/Documents` and use fixed ports 4183/4184/5183/8765. Protected-custody PASS covers the six
  genuine roots on this Mac today, not another machine. Chrome is the self-updating stable channel (156.0.8078.47
  recorded), not a pinned binary.

**Coverage not run**

- Firefox suites and physical VoiceOver/NVDA sessions are NOT RUN. Chrome/WebKit keyboard behaviour, DOM accessible
  names and axe are bounded evidence, not an assistive-technology or general accessibility certification.
- Responsive results come from resized desktop browser viewports, not physical phones or tablets.
- The supplemental 200-cell matrix proves its checked properties for today's synthetic content. Longer IDs, more
  cases or new copy could wrap or overflow differently.

**Typography and wrapping**

- Mono identifiers in narrow columns (notably the 1024px Verifications case table) wrap at hyphens and after the
  truncation ellipsis, e.g. `fixture E-row-verified-` / `cohort-unverified`, `hist_7d621c0c…` / `d6fe`. Every character
  stays visible and in order, so this is recorded rather than failed. Forcing `nowrap` would widen the table and hide
  the Comparison column at 1024. Switching that range to the stacked case list would be a layout decision for the Owner.
- `break-all` remains in `Integrity.tsx:135` (archive integrity facts) and `VerificationDetail.tsx:514` (evidence
  values). With today's content no forced split appears there in any cell, so they were left unchanged. If a short
  word ever splits there, the `AccessStates` change (`break-words`) is the template.
- The Evidence Atelier keeps compact mono metadata at 10.5–11px (10px for the capture/admission labels). It passes
  axe contrast and was judged legible in the inspected screenshots; it was left unchanged as an accepted design
  decision. A user study or larger-text preference was not part of FIX04.
- The aria-hidden `[data-ornament]` numerals remain excluded from automated contrast checks, as in every accepted
  suite (FIX03 R-N4). No exemption exists for functional text.

**Latent and accepted items**

- Future optional-rule `pass`/`fail` would show the raw status word in the observed column (FIX03 R-N1). The pinned
  Evaluator emits only `unknown` for these rules. Revisit the wording only if the Evaluator contract changes; FIX04
  adds no semantics for outputs that do not exist.
- `ArchiveIndex.unexpected` (asserted by a unit test) and the unrendered INCONCLUSIVE `meaning` copy (FIX03 R-03,
  R-04) are retained. Neither is proven-unused logic.
- The product JavaScript is one ≈636 kB chunk (≈181 kB gzip); Vite warns about it. This was already true at
  baseline, split across shared chunks. Code-splitting is an architecture change outside FIX04.
- Retained accepted caveats from FIX01/FIX02:
  - the bootstrap harness checks its completion marker and directory, not deep runtime integrity
  - the pytest inventory is count-based
  - a capture read interrupted after a test's final settle is annotated rather than failed (2 annotations in e2e-static
    here, accepted design)
  - historical missing Round 02 traces are not recreated

**Housekeeping and harness facts**

- Untracked empty `FIX0n/final-audit-01/` folders at the repository root (FIX03 R-N8) are Owner housekeeping.
  `FIX04/final-audit-01/` predates this work; FIX04 neither created nor removed it.
- Playwright's history/local/lookup web servers run `npm run build`. Any ad-hoc probe run after a suite measures that
  suite's build, not necessarily the source on disk. This explains session 1's contradictory WebKit probes. Session 2
  rebuilt before each measurement and records the build it measured.
