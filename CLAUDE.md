# CLAUDE.md — Gloss

This file orients you (Claude Code) at the start of a session. It carries context
from the design conversation that produced this repo, so you don't start cold.
Read `docs/protocol.md` for the full reasoning; this is the briefing.

## What Gloss is

Word-style review comments for **markdown that lives in git**. AI tools emit
design docs as markdown into repos, but markdown in git has no review surface.
Gloss adds select-text-and-comment threading, with comments stored append-only in
a `.gloss/` directory **beside** the document — no database, no central server
owning the data. "Portable by default" is the core principle everything bends
around: any tool implementing the protocol can read and write the comments.

A comment is a *gloss* on the text — an annotation in the margin.

## The decisions that matter (and why)

These were deliberate; please don't quietly reverse them.

- **Append-only action log, modelled on Delta Lake.** The markdown is immutable
  data; comments are a log of actions (`create_thread`, `add_comment`,
  `edit_comment`, `delete_comment`, `resolve_thread`, `reopen_thread`). Current
  state is *derived by replaying the log*, never stored mutably. Nothing is ever
  mutated in place — edits and deletes are themselves actions.
- **ULID-per-file is the key git adaptation.** Each action is one file named by a
  ULID. Two reviewers committing to the same branch at once never pick the same
  filename, so git auto-merges and the client just does a pull-rebase-push retry
  loop — never a conflict prompt. This is why we use ULIDs and not Delta's
  sequential filenames.
- **Same-branch model.** Comments commit straight to the working branch under
  `.gloss/`, keeping them out of the document's own diff while leaving a `git log`
  audit trail.
- **Checkpoints with `*_decided_by`.** Compaction folds the log into a checkpoint
  and deletes the folded files in the same commit. The `body_decided_by` /
  `status_decided_by` stamps make folding idempotent and order-independent: a
  stale action (older timestamp) merging in *after* a checkpoint cannot clobber a
  newer value. This is the subtlest correctness property — see the reducer.
- **Anchoring against rendered text, not markdown source.** Comments anchor via a
  quoted span + prefix/suffix context (W3C TextQuoteSelector), re-located by fuzzy
  match on load. Unmatched anchors become "orphaned", shown separately, never
  dropped.
- **Web app + thin backend, not a VS Code extension (for v1).** Reviewers include
  non-engineers; a URL has zero install cost. The backend exists only to do OAuth
  and write to git — it never interprets a comment. A VS Code extension could
  implement the same protocol later against local git, fully interoperable.

## Repo map

```
packages/core    @gloss/core   protocol logic: ULIDs, actions, reducer, checkpoints   TESTED
packages/anchor  @gloss/anchor capture + fuzzy re-locate text anchors                 TESTED
packages/git     @gloss/git    host adapters + pull-rebase-push commit loop           TESTED
packages/server  @gloss/server thin backend: 6 routes; runs offline in --dev mode     RUNS (dev)
apps/web         @gloss/web    React reviewer app                                     SCAFFOLD (needs install)
examples/repo    sample docs repo with a seeded .gloss/ log
docs/protocol.md full design doc (all the reasoning)
docs/mockup.html interactive UI mockup (the target experience)
```

## State of play — what's real vs. not

- `core`, `anchor`, `git` are real and unit-tested (20 tests total). The git tests
  prove the no-lost-update guarantee under concurrent commits using an in-memory
  host. These do **not** need a network.
- `server` is a real zero-dependency Node server with all six routes. It boots in
  `--dev` mode over an in-memory host (no token/network) and the full read/write
  round trip was verified by hand.
- `web` is a working skeleton wired to the protocol (reduce + anchor + API) but was
  **never run** — it needs `npm install` (React/Vite/marked).
- `GitHubHost` (packages/git/src/github.js) has correct REST endpoint shapes but
  was **never exercised against the live API** — no network in the build env. It's
  driven by the same commit engine the in-memory tests cover.

## How to run

```bash
npm install            # wires workspace deps; pulls React/Vite for the web app
npm test               # 20 tests across core, anchor, git
npm run demo           # multi-reviewer session + compaction + stale-edit self-heal
npm run server:dev     # backend on :8787 over an in-memory host
# then, in another shell:
cd apps/web && npm run dev   # vite dev server; proxies API to :8787
```

`packages/core` tests run with zero install (relative imports). Everything else
needs `npm install` first.

## Good next steps (the remaining work is wiring + verification, not new design)

1. `npm install && npm test` — confirm all 20 pass in this environment.
2. Run `apps/web` against `npm run server:dev` and confirm the data path works in
   a browser: open a file, select text, comment, see it persist.
3. Build the real OAuth flow in `@gloss/server` (`/auth/login`, `/auth/callback`)
   and construct a `GitHubHost` per request from the reviewer's token.
4. Point it at a real test repo and verify the commit loop end-to-end against the
   live GitHub API (the one path never tested live).
5. Add a per-branch write lock/queue in the server so our own concurrent requests
   don't collide on the same head.
6. Then: flesh out the web UI toward `docs/mockup.html` fidelity; add a compaction
   job + checkpoint GC.

## Conventions

- ESM JavaScript with JSDoc types throughout; no build step. Node >= 20.
- npm workspaces. Scoped packages `@gloss/*`. Product name is "Gloss".
- Comments in the code explain the load-bearing logic — keep them accurate if you
  change behaviour.
