# UI Phase 2 — Connections, Rules, Settings

Date: 2026-10-17. This extends Evidence Atelier v1.0. Overview, Verifications and Verification Detail
were not redesigned. Everything is frontend-only and uses synthetic data. Nothing is connected,
requested, sent or evaluated.

| | |
| --- | --- |
| Base | `main` @ `bec2f8d` (v1.0). Rollback tag `v0.2-rollback` still exists |
| Research repo | Read only. `model.py` was read to quote the rule semantics and reason strings |
| Integration planning | Read only. Consulted for the provider modes and connector phases |
| Screens | `docs/screenshots/phase2/` (20 captures) |

## A. Connections — `#/connections`

- **Custody diagram.** The logo drawn at page scale:
  - open source node (A)
  - a dashed "under test" n8n box (B)
  - a solid HubSpot node (C)
  - the indigo comparison arc and assertion tick go from A to C and bypass n8n
  - below 768px it becomes a vertical list with a bracket on the left
- **Connection register** (page aside). Shows the honest status of each party: Not connected or
  Identified only.
- **Role sheet.** For each role it shows:
  - a one-line stance
  - what FlowAssert reads and never reads
  - a permission ledger with Required / Optional / Never held
  - provider permission names flagged **"name awaits Phase 0"** where they are not confirmed, e.g.
    `crm.objects.contacts.read`
- **Configuration preview** (stamped *Demo · nothing is sent*):
  - read-only binding fields
  - a disabled **Authorise** button with the reason given
  - a disclosure listing what would be requested
  - the source role shows an **empty state**, "No source provider chosen", because that choice is an
    open owner decision
- **Workflow bindings.** The five demo workflows as A → B → C rows.

## B. Rules — `#/rules`

- **Register** grouped by provenance:
  - **Research-supported** (5): existence, uniqueness, phone exact-string, existed_by_deadline,
    workflow_execution
  - **Proposed** (1): email
  - **Demo-only drafts** (0–1): the draft saved in this browser. An **empty state** is shown when
    there is none
- **Operator marks** (= ≠ ?) show which outcomes a rule *can* produce.
- **Rule detail:**
  - assertion sentence and the expression on the operator spine
  - when the rule is required and what binds it
  - an outcomes ledger. For research rules it quotes the **evaluator reason strings verbatim**. For
    the proposed rule it is labelled *illustrative*
  - a draft shows no outcomes and a neutral operator. It is "never evaluated" and has "no approval
    record"
- **Deadline and retry policy** for `web-lead-sync-v3`:
  - a proportional axis with capture, deadline, observation and latest evaluation
  - the retry window and the post-deadline zone
  - zone explanations and the policy flags
  - labelled *"illustration … not an evaluation"*
- **Draft rule editor** (stamped *Demo · not sent to the evaluator*). The controls are: field,
  comparison (exact / ignore case / trim), deadline, max age, and the retry and settling switches.
  - Live **validation feedback** restates the `model.py` prerequisites.
  - A comparison other than exact-string fails.
  - Non-integer minutes fail; invalid fields get a coral underline and `aria-invalid`.
  - "Approval binds this version" is permanently *not satisfiable* for a draft.
  - Save/Discard write to `localStorage` only. A status line reports the outcome, including "storage
    unavailable".
  - *Submit for approval* is disabled and the reason is shown.

## C. Settings — `#/settings`

- **§1 Theme.** Three live specimens: Paper, Night ledger, and System as a split plate. They are
  rendered by re-scoping the tokens with `[data-theme]`. They share one store with the rail's theme
  switch.
- **§2 Display.**
  - density (compact ledgers, traces, run rows and record rows)
  - record cell size 8 / 10 / 12px (applies to every trace and record index)
  - UTC fixed by design
  - opening page (used only for a visit with no address inside the app)
- **§3 Accessibility.**
  - motion: follow the device / reduce
  - focus ring: standard / heavy
  - uncertainty pattern: standard / strong hatch
  - underline all links
- **§4 Demo configuration.**
  - data provider modes MOCK (active), LOCAL_RESEARCH (awaiting Phase 0) and LIVE (not implemented),
    each with what it depends on
  - demo clock, fixture check, "React never calculates a verdict"
  - **Reset local preferences**, which clears the theme, the preferences and the draft, and confirms
    in a status line
- **§5 Account & security.** A dashed "future" sheet that lists the absent features. It has **no
  controls**: no fake toggles, no credential fields.

## D. Reusable components and styles

| Piece | File |
| --- | --- |
| `PageHead`, `SectionHead`, `DemoStamp`, `ProvenanceMark`, `OpenSeal`, `Segmented` (radiogroup, arrow keys), `Switch` (`role=switch`), `PrefRow` | `src/components/ui/atelier.tsx` |
| `.fa-stamp`, `.fa-openseal`, `.fa-prov`, `.fa-seg`, `.fa-switch`, `.fa-field`, `.fa-custody`, `.fa-party`, `.fa-specimen`, `.fa-future`, preference rules | `src/styles/atelier.css` |
| Theme scoping on any element | `src/styles/tokens.css` (`[data-theme]` selectors added) |

## E. Interactions

| Control | Behaviour |
| --- | --- |
| Custody parties | Select a role. ←/→/↑/↓ move the selection and focus. Synced to `?role=` |
| Rule register | Select a rule. ↑/↓ move the selection and focus. Synced to `?rule=` |
| Draft editor | Live validation; save, discard and dirty state; localStorage only |
| Settings controls | Applied immediately and app-wide; persisted per browser |
| Reset | Restores defaults and confirms |
| Disabled controls (Authorise, Submit for approval, LOCAL_RESEARCH, LIVE) | Disabled with the reason shown next to them; never a fake success |

**States covered:**

- default, hover and focus on every control
- disabled: Authorise, Submit, provider modes, and Save when nothing has changed
- empty: no source provider; no draft
- error: invalid draft fields and failing checks; storage unavailable on save

**Loading:** no loading state was added. Nothing is fetched, and a simulated spinner would imply work
that does not happen.

## F. Provider abstraction — `src/data/provider.ts`

- `ProviderMode = "MOCK" | "LOCAL_RESEARCH" | "LIVE"`.
- `PROVIDERS` lists each mode with its status and what it depends on.
- `VerificationProvider` has only `listRuns()` and `getRun(id)`, both returning **view models**.
- `activeProvider` is the MOCK provider, backed by `store.ts`.
- **No backend URL, request or JSON shape is defined.** The Phase 0 DTO is not final.
- Existing pages still import `store.ts` directly, unchanged. Both paths serve the same data.

## H. Validation

| Check | Result |
| --- | --- |
| `npx tsc -b` | 0 errors |
| `npx oxlint src` | No output |
| `npm run build` | Success |
| Demo fixture check (dev startup) | "Demo fixtures consistent: 16 runs checked." |
| Console on fresh load | No errors |
| Horizontal overflow at 375 and 768 | None on all 6 routes (also with 12px cells) |
| Focus visibility (programmatic walk after keyboard input) | All focusables on all 6 routes show a ring or underline (Overview 16, Verifications 22, Detail 107, Connections 5, Rules 16, Settings 24) |
| Connections ←/→ | `?role=` destination → workflow → source; focus follows |
| Rules ↑/↓ | `?rule=` phone → uniqueness / existed_by_deadline → workflow_execution; focus follows |
| Draft | Invalid deadline sets `aria-invalid` and fails its check; Save adds the register entry, selects `?rule=draft` and persists; Save is disabled while nothing has changed; Discard restores the empty state |
| Settings | Every control sets its attribute on `<html>` and persists; the rail and specimen theme stay in sync; opening page redirects a bare `/`; Reset restores all |
| Existing pages | Mismatch filter shows 4 rows; Detail ↓ moves LEAD-1038 → LEAD-1052; Overview and Detail regression captures match v1.0 |

**Defects found and fixed during review:**

| Defect | Fix |
| --- | --- |
| Custody arc collapsed (an absolute-positioned SVG does not stretch) | Explicit width |
| Policy axis labels overlapped the C marker | Relabelled, bracket right-aligned, short label below 640px |
| Specimen "System" plates cramped | Compact plate content |
| Theme state duplicated per hook instance (rail and Settings could disagree) | Shared external store |
| Arrow keys moved selection but sometimes not focus (`requestAnimationFrame` raced the commit) | Focus in an effect after the change |
| **Pre-existing (v1.0):** default buttons (`.surface`) lost the focus ring because the shadow utility overrode `:focus-visible` | `.surface:focus-visible` restores the ring |
| A draft's expression used the green "holds" operator | Neutral operator for drafts |

**Not performed:** no screen-reader pass, no Safari or Firefox pass, and no automated axe audit.
Captures use headless Chrome. Interactions were driven in the built-in Chromium browser pane.

## I. Known limitations

- Density covers ledgers, traces, run rows, record rows and the rule list. Other panels keep
  comfortable spacing.
- Strong hatch adjusts the shared hatch tokens. Inside the Settings specimens it follows the page
  theme, not the plate theme.
- Only one draft can exist per browser.
- Draft checks restate a subset of the evaluator prerequisites, for display only.
- The opening-page preference only applies when the URL has no hash.
- The `crm.objects.contacts.read` scope and the source permissions are proposals until Phase 0
  confirms them. They are marked as such in the UI.
- No automated accessibility or visual-regression tests.

## J. Integration dependencies awaiting Codex Phase 0

1. **LOCAL_RESEARCH Detail DTO.** Once it is reviewed, implement a `VerificationProvider` that maps it
   to `RunView`, preserving the evaluator state verbatim. Switch Verification Detail first.
2. **Evaluator, version and policy binding in the DTO.** The Rules page policy preview and the "Bound
   by" field would read real policy fields instead of `DEMO_POLICY`.
3. **Rule register source.** Research rules are currently restated from `model.py`. A served rule
   catalogue, if Phase 0 defines one, should replace `RULES`.
4. **Provider error semantics.** How "operational error" is distinguished from Unverified decides how
   the UI shows a failed LOCAL_RESEARCH read. Not designed yet, on purpose.
5. **Connector and authorisation decisions** (source provider, HubSpot scopes, tenancy and auth).
   These gate LIVE, the Authorise button and §5 Account & security.
