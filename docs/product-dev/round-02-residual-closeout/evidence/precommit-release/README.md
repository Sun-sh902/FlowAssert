Pre-commit release-profile run in the development tree (uncommitted implementation on top of `1caef22`), kept for the
record. 24 PASS, 2 FAIL:
- `protected-custody` FAIL: ten Finder `.DS_Store` files appeared in four protected roots at 11:29:31 and 11:39:03 local
  time (see ../../REMAINING_LIMITATIONS.md). Not caused by this work; the gate is right to fail.
- `tracked-evidence` FAIL: the five closeout reports were being written under `docs/` during the run
  (`tracked-evidence.log`: only `??` lines; all 613 tracked hashes equal). A live positive control of the gate.
Not the release evidence; see ../clean-clone-release/.
