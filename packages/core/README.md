# @gloss/core

The protocol core for **Gloss** — Word-style review comments for markdown that
lives in git. Comments are stored append-only in a `.gloss/` directory beside the
document; this package is the pure, zero-dependency logic that turns those files
into review state and back.

It is deliberately the *first* thing built: it has no network or git dependency,
it is the part everything else (backend, frontend, a future VS Code extension)
relies on, and it is where correctness is hardest. Run the tests to see the two
guarantees that matter proven directly.

## What's here

- `src/ulid.js` — time-sortable, collision-free ids. One per action file, so two
  reviewers committing at the same instant never collide, and a plain string sort
  recovers commit order.
- `src/actions.js` — the wire format: the shared envelope plus the six action
  types (`create_thread`, `add_comment`, `edit_comment`, `delete_comment`,
  `resolve_thread`, `reopen_thread`). Nothing is ever mutated; edits and deletes
  are themselves actions.
- `src/reducer.js` — folds a set of actions into review state. Deterministic and
  order-independent, via `*_decided_by` last-writer-wins on every contested field.
- `src/checkpoint.js` — materialize state into a checkpoint and the load model
  (`load(checkpoint, logTail)`), plus `compact()`.

## The two guarantees (see `test/reducer.test.js`)

1. **Determinism** — the same set of actions yields the same state on any
   machine, regardless of the order files arrived in git.
2. **Checkpoint idempotence + late-arrival self-heal** — folding the log tail
   onto a checkpoint equals replaying everything from zero, even when a stale
   action (older timestamp) merges in *after* a newer one was already
   checkpointed. The stale action cannot clobber the newer value.

## Try it

```bash
node --test     # 11 tests, no install needed (Node >= 20)
node demo.js    # a multi-reviewer session + compaction + a stale late edit
```

## Not yet built (next steps)

- `@gloss/git` — the read/write layer: list `_log/`, fetch checkpoints, and the
  pull-rebase-push commit loop against the host API.
- `@gloss/web` — the React reviewer app (the mockup shows the target experience).
- Anchoring runtime — capture quote+prefix+suffix from the rendered DOM and fuzzy
  re-locate on load, flagging orphans.
