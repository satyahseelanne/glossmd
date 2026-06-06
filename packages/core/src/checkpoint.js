// checkpoint.js
//
// A checkpoint is the reducer's output, frozen and written beside the log so a
// loader reads one file plus the un-folded tail instead of thousands of action
// files. The load model:
//
//   1. Take the latest checkpoint (max ULID in _checkpoints/), or empty state.
//   2. Fold every action still in _log/ on top of it.
//
// Because compaction removes the folded action files in the *same* commit it
// writes the checkpoint, _log/ only ever holds un-folded actions — so the loader
// needs no bookkeeping about what's already folded.

import { reduce } from "./reducer.js";

/**
 * Build a checkpoint object from a materialized state.
 * @param {object} state - output of reduce()
 * @param {object} meta - { id, ts, watermark?, supersedes? }
 */
export function buildCheckpoint(state, { id, ts, watermark = null, supersedes = null }) {
  if (!id) throw new Error("checkpoint requires an id (ULID)");
  if (!ts) throw new Error("checkpoint requires ts");
  return {
    v: 1,
    id,
    ts,
    watermark,   // highest folded action id (informational under delete-on-compact)
    supersedes,  // prior checkpoint id, for GC chain-walking
    threads: Object.values(state.threads).map((t) => ({ ...t })),
  };
}

/** Turn a checkpoint back into the reducer's initialState shape. */
export function checkpointToState(checkpoint) {
  const threads = {};
  for (const t of checkpoint?.threads ?? []) threads[t.thread_id] = t;
  return { v: 1, threads, orphans: [] };
}

/**
 * The load model. Replays the log tail on top of the latest checkpoint.
 * @param {object|null} checkpoint - latest checkpoint, or null/undefined
 * @param {object[]} logTail - un-folded actions remaining in _log/
 */
export function load(checkpoint, logTail) {
  const initial = checkpoint ? checkpointToState(checkpoint) : undefined;
  return reduce(logTail, initial);
}

/**
 * Compact: fold the whole log into a fresh checkpoint and report which action
 * files are now safe to delete (all of them — they're folded and still live in
 * git history). Mirrors what the backend's compaction job commits atomically.
 *
 * @param {object} ulidGen - a ULID generator () => string
 * @param {string} ts - checkpoint timestamp (ISO)
 * @param {object[]} fullLog - every action currently in _log/
 * @param {object|null} priorCheckpoint
 * @returns {{ checkpoint: object, folded: object[] }}
 */
export function compact(ulidGen, ts, fullLog, priorCheckpoint = null) {
  const state = load(priorCheckpoint, fullLog);
  const sorted = [...fullLog].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const watermark = sorted.length ? sorted[sorted.length - 1].id : priorCheckpoint?.watermark ?? null;
  const checkpoint = buildCheckpoint(state, {
    id: ulidGen(),
    ts,
    watermark,
    supersedes: priorCheckpoint?.id ?? null,
  });
  return { checkpoint, folded: fullLog };
}
