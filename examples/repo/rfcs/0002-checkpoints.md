# RFC 0002 — Checkpoints

A checkpoint is a materialised snapshot of a document's review state written
beside the action log. The loader reads the latest checkpoint plus the
un-folded log tail, instead of folding thousands of action files from scratch.

## Compaction

Compaction folds every action currently in `_log/` into a fresh checkpoint and
deletes those action files in the **same** commit. After compaction, `_log/`
only ever holds un-folded actions, so the loader needs no bookkeeping about
what has already been folded.

## `*_decided_by`

Each contested field — a comment's body, a thread's status — records the
`(ts, id)` stamp that last decided it. An action only wins if its stamp is
greater. This is what lets a stale action merging in *after* a checkpoint
self-heal to the correct value instead of clobbering a newer one.

## Supersession

Each checkpoint records the id of the prior checkpoint it supersedes. A GC
walker can follow that chain backwards to delete old checkpoints once their
ref is no longer reachable.
