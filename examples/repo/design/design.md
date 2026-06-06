# Collaborative Review Protocol for Markdown in Git

Status: Draft · Gloss

## 1. Problem

AI tools produce design docs, specs, and plans as markdown, and that markdown
lives in git like any other source. But markdown in git has no native review
surface: when a doc is sent around for feedback, there is nowhere to leave a
comment anchored to a specific sentence.

We want the Word review experience for markdown that lives in a git repo,
without moving the document out of git and without locking the comments inside
a proprietary database. Comments should be **portable by default**, readable by
any conforming tool.

## 2. Architecture

The design follows Delta Lake's model, adapted for git. The markdown is
immutable data; comments are an append-only action log stored beside it.
Current state is derived by replaying the log, never stored as mutable state.

The key git adaptation is **ULID-per-file** instead of Delta's sequential
filenames. Each action is its own uniquely named file, so two reviewers
committing at once never touch the same path.

## 3. Concurrency

All reviewers work on the same branch. A comment action commits directly to it
through a silent pull-rebase-push retry loop, never a conflict prompt. The
trade-off is that **every comment is a real commit on the working branch**,
kept under `.gloss/` so it stays out of the document's own diff.

This serializes ref updates per branch — fine at review pace, but not built for
hundreds of writes per second, and it shouldn't be.

## 4. Anchoring

Anchors are captured against rendered text, not markdown source, using a quote
plus a short prefix and suffix — the W3C Web Annotation TextQuoteSelector. On
load the client fuzzy-matches to re-locate each span; anything that no longer
matches is flagged as orphaned rather than silently dropped.

> Try it: select any sentence above to leave a comment.
