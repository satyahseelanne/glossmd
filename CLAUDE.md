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
packages/server  @gloss/server backend: OAuth/PAT/dev modes; serves the built SPA     RUNS + DEPLOYS
apps/web         @gloss/web    React reviewer app (WYSIWYG edit, tree, comments)      RUNS
infra/           Bicep for Azure Container Apps (deploy via azd)                       DEPLOYS
examples/repo    sample docs repo with a seeded .gloss/ log
docs/protocol.md full design doc (all the reasoning)
docs/mockup.html interactive UI mockup (the target experience)
```

## State of play — what's real vs. not

- `core`, `anchor`, `git` are real and unit-tested. The git tests prove the
  no-lost-update guarantee under concurrent commits using an in-memory host.
  These do **not** need a network.
- `server` is a real zero-dependency Node server. It picks a mode at boot: `--dev`
  (in-memory host, no token), PAT (`GITHUB_TOKEN`, single-user), or OAuth
  (`GLOSS_OAUTH_CLIENT_ID`/`SECRET`, multi-user). It also serves the built web
  app. Routes cover auth, repo/branch/tree/file reads, file write + delete, and
  review actions + compaction.
- `web` is a working React app: WYSIWYG markdown editing (TipTap), a file tree
  with document/folder create + delete, select-to-comment threading, and
  shareable deep links. Runs via Vite against the dev server.
- `GitHubHost` (packages/git/src/github.js) backs the OAuth flow and has been
  exercised against the live GitHub API. The commit loop is the same engine the
  in-memory tests cover.
- Deployment: `infra/` Bicep provisions Azure Container Apps (+ ACR, Log
  Analytics); the app deploys with `azd up` / `azd deploy`. The OAuth client
  secret lives as a Container Apps secret, never in the repo or image.

## How to run

```bash
npm install            # wires workspace deps; pulls React/Vite for the web app
npm test               # tests across core, anchor, git
npm run demo           # multi-reviewer session + compaction + stale-edit self-heal
npm run server:dev     # backend on :8787 over an in-memory host
# then, in another shell:
cd apps/web && npm run dev   # vite dev server; proxies API to :8787
```

`packages/core` tests run with zero install (relative imports). Everything else
needs `npm install` first. For real GitHub, copy `.env.example` to `.env` and
fill in a PAT or OAuth credentials; `.env` is gitignored.

## Good next steps

1. Per-branch write serialization in the server so concurrent requests to the
   same head queue instead of racing (the in-memory retry loop handles git-level
   collisions; this is about our own replicas).
2. Durable, shared sessions so the app can scale past a single replica without
   logging reviewers out on restart.
3. Flesh out the web UI toward `docs/mockup.html` fidelity; add real-time refresh.
4. A background compaction job + checkpoint GC.
5. A `@gloss/vscode` extension implementing the same protocol against local git.

## Conventions

- ESM JavaScript with JSDoc types throughout; no build step. Node >= 20.
- npm workspaces. Scoped packages `@gloss/*`. Product name is "Gloss".
- Comments in the code explain the load-bearing logic — keep them accurate if you
  change behaviour.
