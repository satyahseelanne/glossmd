# Gloss — Collaborative Review Protocol for Markdown in Git

**Status:** Draft · **Last updated:** 2026-06-05

> **Gloss** brings Word-style review to markdown that lives in git. A comment is
> a *gloss* on the text — an annotation in the margin — stored append-only in a
> `.gloss/` directory beside the document. Name is settled; technical handles are
> scoped (`@gloss/*` on npm, qualified GitHub org).

---

## 1. Problem

AI tools produce design docs, specs, and plans as markdown, and that markdown
lives in git like any other source. But markdown in git has no native review
surface: when a doc is sent around for feedback, there is nowhere to leave a
comment anchored to a specific sentence, no threaded back-and-forth, and no
shared place reviewers can see each other's notes. Review happens in side
channels — chat, email, meetings — disconnected from the document and lost
afterward.

We want the Microsoft Word review experience (select text, comment, reply,
resolve) for markdown that lives in a git repo, **without** moving the document
out of git and **without** locking the comments inside a proprietary database.

## 2. Goals

- Reviewers open a tool, point it at a repo and branch, browse markdown, and
  read it fully rendered.
- They select rendered text and leave threaded comments, Word-style, in a
  sidebar. Replies, edits, resolve/reopen all inline.
- Comments are **portable by default**: they live in the repo, in an open
  format, readable and writable by any tool that implements the protocol. No
  central database is the source of truth.
- Multiple reviewers work on the same branch concurrently without ever seeing a
  merge conflict.
- The full review history is preserved as an audit trail.

## 3. Non-goals

- Real-time character-level co-editing of the *document* itself. We review
  markdown; we don't replace the editor that produces it.
- CRDT-grade merging of concurrent edits to the *same comment*. Last-writer-wins
  is sufficient for review comments (see §11).
- Supporting arbitrary git hosts on day one. v1 targets a hosted provider
  (GitHub or GitLab) via its API.

---

## 4. The experience

A reviewer opens a URL and authenticates to the git host. They point the tool at
a repo and branch, browse the file tree, and open a markdown file. The file
renders fully — no syntax noise. To comment, they select text in the rendered
view and type. Threads appear in a sidebar beside the text they anchor to.
Replies, edits, and resolve/reopen happen inline.

Under the hood, each comment action commits straight to the same branch. There
is no branching, no pull request, no merge step for the reviewer to think about.
Another reviewer's comments simply appear. There is no database to trust and no
central server that owns the data — the comments live in the repo itself.

---

## 5. Architecture at a glance

The design follows **Delta Lake's** model, adapted for git:

- The markdown is **immutable data**.
- Comments are an **append-only action log** stored beside the markdown.
- Current review state is **derived by replaying the log**, never stored as
  mutable state.
- The log is periodically **compacted into a checkpoint** so replay stays cheap.

Three properties carry the whole design:

1. **ULID-per-file** instead of Delta's sequential filenames — the adaptation
   that makes git merges conflict-free (§9).
2. **Everything is an action; nothing is mutated** — which makes the reducer
   deterministic and gives a free audit trail (§7).
3. **Anchoring against rendered text** via quote + context, plus the commit SHA
   the comment was made against (§8).

A thin backend exists only to authenticate to the host and write files to the
branch. It never interprets a comment. The reducer, anchoring, and rendering all
live client-side, which is what lets a future VS Code extension implement the
same protocol against local git with no backend at all.

---

## 6. Repository layout

Comments for a document live alongside it, namespaced by the document's path, so
they never pollute the document's own diff:

```
design.md
.gloss/design.md/
  _log/                          # only un-checkpointed actions
    01JA7K…create_thread.json
    01JA7M…add_comment.json
    01JA8P…resolve_thread.json
  _checkpoints/
    01JB8P…checkpoint.json        # ULID-named; loader takes the max id
```

Every file in `_log/` and `_checkpoints/` is named by a **ULID** — a
collision-free, time-sortable identifier. The ULID is both the filename and the
action's `id`, and its embedded timestamp lets us recover ordering without a
sequential counter.

There is deliberately **no mutable pointer file** (Delta's `_last_checkpoint`).
A single mutable file is exactly the merge-conflict trap the protocol avoids.

---

## 7. The action log

### 7.1 Shared envelope

Every action is one JSON file sharing this envelope:

```json
{
  "v": 1,
  "id": "01JA7KQ2…",
  "type": "add_comment",
  "actor": { "id": "u_42", "name": "Asha", "email": "asha@co.com" },
  "ts": "2026-06-05T14:22:09.881Z"
}
```

- `id` — the ULID; also the filename.
- `ts` — authoritative ordering key. Ties break on `id`.
- `v` — format version, so readers can evolve without breaking old logs.

### 7.2 Action types

Everything is an action, including deletions. Nothing is ever mutated in place.

**`create_thread`** — mints a thread *and* carries its first comment, so a new
thread is a single commit:

```json
{
  "thread_id": "01JA7KQ2…",
  "anchor": {
    "commit": "9f3c1ab",
    "file": "design.md",
    "quote": "the exact visible text the reviewer selected",
    "prefix": " …~30 chars before… ",
    "suffix": " …~30 chars after… ",
    "text_position": { "start": 1234, "end": 1290 }
  },
  "body": "Should this be configurable?"
}
```

**`add_comment`** — a reply. The comment's id is the action's `id`:

```json
{ "thread_id": "…", "body": "…", "reply_to": "<comment id, optional>" }
```

**`edit_comment`** — a supersede, never an in-place change:

```json
{ "target": "<comment id>", "body": "…" }
```

**`delete_comment`** — a tombstone:

```json
{ "target": "<comment id>" }
```

**`resolve_thread`** / **`reopen_thread`**:

```json
{ "thread_id": "…" }
```

### 7.3 The reducer

A pure function turns the log into current state:

1. Read every file in `_log/`.
2. Sort by `(ts, id)`.
3. Fold:
   - `create_thread` opens a thread and seeds comment #1.
   - `add_comment` appends a comment.
   - `edit_comment` replaces a comment's body, matched by `target`.
   - `delete_comment` marks a comment removed.
   - `resolve_thread` / `reopen_thread` flips thread status.

Same log → same view on every machine. That determinism is what makes the
comments portable: any conforming tool reconstructs identical state from the same
files.

---

## 8. Anchoring

The canonical file in git is markdown with syntax the reviewer never sees, but
the reviewer selects text in the *rendered* view. So anchors are captured
against rendered text, not source.

When a reviewer highlights a span, the client uses the browser Range API to
capture:

- `quote` — the visible selected text.
- `prefix` / `suffix` — roughly 30 characters of surrounding context.
- `text_position` — character offsets, as a fast-path hint only.
- `commit` — the SHA the comment was made against.

This is the W3C Web Annotation Data Model's **TextQuoteSelector** approach. On
load, the client searches the rendered plaintext to re-locate the span by fuzzy
match on quote + context, then wraps it in a highlight. If quote and
`text_position` disagree, the quote wins.

When the document later changes, anchors are fuzzy re-located against the new
text. Anything that can no longer be matched is flagged as **orphaned** and shown
separately — never silently dropped. Recording `commit` lets the tool show
reviewers which version a comment was made against.

Renderer note: pin the markdown renderer's configuration (markdown-it or remark)
so rendering is deterministic. Unstable rendering shifts offsets and breaks
re-anchoring.

---

## 9. Concurrency model

All reviewers work on the **same branch**. A comment action commits directly to
it; there is no per-reviewer branch and no merge step.

The naming scheme makes this safe. Because each action is its own ULID-named
file, two reviewers committing at the same time never touch the same path. The
flow is a silent **pull-rebase-push retry loop**, never a conflict prompt:

```
1. Read current branch head SHA.
2. Create the action file under .gloss/<doc>/_log/<ulid>.json.
3. Build a tree on top of head; build a commit pointing at head.
4. Update the branch ref — only if it still points at the SHA from step 1.
5. If the ref moved (someone committed first): refetch head, retry from 2.
```

Step 4 gives optimistic concurrency for free: the host rejects the update if the
branch advanced (a non-fast-forward), and because the new file is uniquely named,
the retry rebuilds on the new head and pushes cleanly. Retries are bounded and
hit a fast, side-effect-free operation — never a merge resolution.

**Trade-off:** every comment is a real commit on the working branch. Keeping
actions under `.gloss/` keeps them out of the document's diff, but they do
appear in `git log`. For most teams that's acceptable — it's the audit trail —
and it's the cost of true portability.

**Throughput:** this serializes ref updates per branch, which is fine at
review pace (a comment every few seconds) but is not built for hundreds of writes
per second, and shouldn't be. The backend should hold a per-branch serialization
point (an in-process queue or lock) so its *own* concurrent requests don't
collide on the same head and waste retries against the host's rate limit.

---

## 10. Checkpointing

A checkpoint is a materialized snapshot of the reducer's output, written beside
the log so a loader reads one file plus a short tail instead of thousands of
action files.

### 10.1 Load model

Compaction folds the log into a snapshot **and physically removes the folded
action files in the same commit**. Because removal and checkpoint write are one
atomic commit, `_log/` only ever holds un-folded actions. Loading is therefore:

1. List `_checkpoints/`, take the max ULID — that's the latest checkpoint.
2. Fold every file currently in `_log/` on top of it.

No bookkeeping about which files are already folded: if it's in `_log/`, it
isn't folded yet. Folded actions remain in git history, consistent with "git is
the database."

### 10.2 Checkpoint format

```json
{
  "v": 1,
  "id": "01JB8P…",
  "ts": "2026-06-05T15:00:00Z",
  "watermark": "01JB7Z…",
  "supersedes": "01JA9C…",
  "threads": [
    {
      "thread_id": "01JA7K…",
      "status": "open",
      "status_decided_by": { "ts": "…", "id": "…" },
      "anchor": {
        "commit": "9f3c1ab", "file": "design.md",
        "quote": "…", "prefix": "…", "suffix": "…"
      },
      "comments": [
        {
          "id": "01JA7K…",
          "actor": { "id": "u_42", "name": "Asha" },
          "ts": "…",
          "body": "Should this be configurable?",
          "edited": false,
          "body_decided_by": { "ts": "…", "id": "…" },
          "deleted": false,
          "reply_to": null
        }
      ]
    }
  ]
}
```

### 10.3 The load-bearing field: `*_decided_by`

`body_decided_by` and `status_decided_by` record the `(ts, id)` that last decided
a contested field. This is what makes folding onto a checkpoint **correct**, not
just approximately correct.

The hazard is late arrival, the same family as the orphan problem. A reviewer
edits a comment offline; their `edit_comment` carries an old timestamp but merges
into the branch *after* a newer edit was already checkpointed. If folding applied
it blindly, the stale edit would clobber the newer one. Instead, the reducer
applies an incoming edit only if its `(ts, id)` is greater than the recorded
`*_decided_by`. Folding becomes idempotent and order-independent: a late action
self-heals to the right answer whether replayed from zero or folded onto a
checkpoint. Without this field, checkpoints become a quiet source of divergence
between machines — which would break the portability that is the entire point.

### 10.4 Concurrency, GC, and policy

- **No pointer file.** Checkpoints are ULID-named; the loader takes the max.
  Two simultaneous compactions produce two checkpoints; the loader picks the
  latest and the other is harmless.
- **Full snapshots, not incremental.** Comments are tiny and only the latest
  checkpoint is ever needed, so a delta-chain would add fragility for no real
  saving.
- **`watermark`** (highest folded action id) is informational under the
  delete-on-compact model; load doesn't depend on it.
- **`supersedes`** chains checkpoints so a GC job can keep the latest plus maybe
  one prior and walk the chain.
- **When to compact** is policy, not protocol: any client compacts
  opportunistically when `_log/` crosses a threshold (~200 files), or the backend
  runs it on a timer. It's advisory; concurrent compactions are safe.

### 10.5 Decided fork: delete folded files on compact

We **delete** folded action files on compaction. `_log/` stays small, loads stay
cheap, and git history still holds every action for audit.

The alternative — never removing log files — makes the working tree fully
self-contained (the data never leans on git history) but lets `_log/` grow
without bound *and* requires the watermark to know what to skip, which
reintroduces the late-arrival skip bug for any action older than the watermark.
Delete-on-compact avoids that entirely. Take the alternative only if there's a
hard requirement that a checkout alone, with no git history, must contain every
comment.

---

## 11. Deferred: concurrent edits to the same comment

Append-only keeps both `edit_comment` actions when two reviewers edit the same
comment offline and merge, so nothing is lost. We resolve deterministically by
**last-writer-wins on (ts, actor)** via the `*_decided_by` mechanism. This is
fine for comments, which are mostly create-and-reply and rarely concurrently
edited. True merging of concurrent edits would be CRDT territory — overkill here,
explicitly deferred.

---

## 12. Backend surface

The backend is the hands that write to git, nothing more. It never understands a
comment; it moves files. This separation is what keeps the protocol portable.

Roughly six routes:

**Auth** — the OAuth dance with the host.
- `GET /auth/login` → redirect to GitHub/GitLab.
- `GET /auth/callback` → exchange code, store the token **server-side** (never
  sent to the browser). All routes below act *as the reviewer*, so repo
  permissions are the host's problem.

**Read** — thin proxies over the host API.
- `GET /tree?repo&branch` → file browser.
- `GET /file?repo&branch&path` → markdown plus its resolved commit SHA (the
  client needs the SHA to stamp anchors).
- `GET /reviews?repo&branch&path` → latest checkpoint plus the current `_log/`
  tail. The client folds these into state itself.

**Write** — the one hard route.
- `POST /reviews/actions` with `{ repo, branch, path, action }` → runs the
  pull-rebase-push loop from §9 against the host API. Bounded retries on a
  ref-update that fails fast on non-fast-forward; never a merge resolution.

**Compaction**, if backend-driven, is the same write path writing a checkpoint
and deleting folded log files in one commit — no new route, just an internal job
hitting the same loop.

---

## 13. v1 stack

- **Frontend:** React; a deterministic markdown renderer (markdown-it or remark)
  with pinned config; the Range API for selection capture.
- **Backend:** thin service holding the OAuth token and implementing the six
  routes; per-branch serialization lock.
- **Repo access:** GitHub (or GitLab) host API. No cloning.
- **Source of truth:** the repo. No application database for comments.

A VS Code extension can be added later implementing the same protocol against
local git — same `.gloss/` log, fully interoperable, no backend needed.

---

## 14. Why web app over VS Code extension (v1)

Reviewers of AI-generated design docs include PMs, designers, writers, and other
non-engineers. A URL has zero install cost; asking a non-engineer to install an
editor and an extension to leave a comment is the friction that kills review
tools.

VS Code would win on repo access (the repo, branch, and git are already on disk,
so the write loop is just shelling out to git) and on its native comment-threads
API. If every reviewer were already an engineer living in the editor, that would
flip the decision. Because design-doc review almost always includes non-engineer
reviewers, the web app wins — at the cost of the thin backend in §12, which is
the one place the otherwise-serverless protocol needs a server.

---

## 15. Suggested build order

The thinnest slice that proves the whole thing end to end, in order:

1. **Render one file.** Host-API read of a single markdown file → deterministic
   render. No comments yet.
2. **Select-to-comment, local only.** Range API capture → anchor → in-memory
   thread in the sidebar. Proves the anchoring UX.
3. **Write one action to git.** `POST /reviews/actions` → single `create_thread`
   committed under `.gloss/`. Proves the write loop.
4. **Read back and reduce.** `GET /reviews` → fold log → render threads from the
   repo, not memory. Proves the round trip.
5. **Replies, edit, delete, resolve.** Complete the action types and the reducer.
6. **Concurrency.** Two reviewers, retry loop, confirm conflict-free merges.
7. **Re-anchoring + orphans.** Change the doc; fuzzy re-locate; flag orphans.
8. **Checkpointing.** Compaction job, `*_decided_by` enforcement, GC.

Real-time sync and CRDT-style edit merging stay out of v1 entirely.
