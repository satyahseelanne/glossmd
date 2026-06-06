// reducer.js
//
// Folds an action log into current review state. Two properties are the whole
// point and the tests below pin them down:
//
//   * Deterministic — same set of actions always yields the same state, on any
//     machine, regardless of the order the files happened to arrive in git.
//
//   * Idempotent under checkpointing — folding the log tail onto a checkpoint's
//     materialized state gives exactly the same result as replaying every action
//     from zero. This is what lets us compact safely.
//
// The mechanism that buys both is `*_decided_by`: every contested field (a
// comment's body, a thread's status) records the (ts, id) stamp that last
// decided it. An incoming action only wins if its stamp is greater. So a late
// action — one with an older timestamp that merges into the branch *after* a
// newer one was already folded into a checkpoint — self-heals to the correct
// answer instead of clobbering the newer value.

import { ActionType, compareStamps } from "./actions.js";

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const stamp = (a) => ({ ts: a.ts, id: a.id });

function emptyState() {
  return { v: 1, threads: {}, orphans: [] };
}

function seedComment(thread, { id, actor, ts, body, reply_to }) {
  thread.comments.push({
    id,
    actor,
    ts,
    body: body ?? "",
    reply_to: reply_to ?? null,
    edited: false,
    body_decided_by: { ts, id }, // creation stamp
    deleted: false,
    deleted_by: null,
  });
}

function findComment(state, targetId) {
  for (const t of Object.values(state.threads)) {
    const c = t.comments.find((c) => c.id === targetId);
    if (c) return c;
  }
  return null;
}

/**
 * @param {object[]} actions - any subset of the log (need not be pre-sorted)
 * @param {object} [initialState] - e.g. a checkpoint's materialized state; the
 *   log tail is folded on top of it. Defaults to empty.
 * @returns {object} materialized review state
 */
export function reduce(actions, initialState) {
  const state = initialState ? clone(initialState) : emptyState();
  if (!state.orphans) state.orphans = [];

  // Phase the batch by type so structure-creating actions land before the
  // actions that reference them. Within each phase, order is irrelevant: thread
  // creation is per-distinct-id, and every mutation is guarded by (ts, id), so
  // the fold is commutative. We still sort the mutation phase for tidiness.
  const creates = [];
  const adds = [];
  const mutations = [];
  for (const a of actions) {
    if (a.type === ActionType.CREATE_THREAD) creates.push(a);
    else if (a.type === ActionType.ADD_COMMENT) adds.push(a);
    else mutations.push(a);
  }
  mutations.sort(compareStamps);

  // 1. Threads (+ seed comment)
  for (const a of creates) {
    if (state.threads[a.thread_id]) continue; // ULID-unique; ignore re-create
    const thread = {
      thread_id: a.thread_id,
      status: "open",
      status_decided_by: stamp(a),
      anchor: a.anchor,
      created_by: stamp(a),
      comments: [],
    };
    seedComment(thread, a);
    state.threads[a.thread_id] = thread;
  }

  // 2. Replies
  for (const a of adds) {
    const thread = state.threads[a.thread_id];
    if (!thread) {
      state.orphans.push({ reason: "missing_thread", action: a });
      continue;
    }
    if (thread.comments.some((c) => c.id === a.id)) continue; // idempotent
    seedComment(thread, a);
  }

  // 3. Mutations — each guarded by last-writer-wins
  for (const a of mutations) {
    switch (a.type) {
      case ActionType.EDIT_COMMENT: {
        const c = findComment(state, a.target);
        if (!c) { state.orphans.push({ reason: "missing_target", action: a }); break; }
        if (compareStamps(stamp(a), c.body_decided_by) > 0) {
          c.body = a.body ?? "";
          c.edited = true;
          c.body_decided_by = stamp(a);
        }
        break;
      }
      case ActionType.DELETE_COMMENT: {
        const c = findComment(state, a.target);
        if (!c) { state.orphans.push({ reason: "missing_target", action: a }); break; }
        if (!c.deleted_by || compareStamps(stamp(a), c.deleted_by) > 0) {
          c.deleted = true;
          c.deleted_by = stamp(a);
        }
        break;
      }
      case ActionType.RESOLVE_THREAD:
      case ActionType.REOPEN_THREAD: {
        const t = state.threads[a.thread_id];
        if (!t) { state.orphans.push({ reason: "missing_thread", action: a }); break; }
        if (compareStamps(stamp(a), t.status_decided_by) > 0) {
          t.status = a.type === ActionType.RESOLVE_THREAD ? "resolved" : "open";
          t.status_decided_by = stamp(a);
        }
        break;
      }
      default:
        state.orphans.push({ reason: "unknown_type", action: a });
    }
  }

  // Canonicalize: comments within each thread sorted by creation stamp (ts, id).
  // Guarantees a late-arriving *new* comment lands in the right position, so the
  // materialized state is independent of fold boundaries.
  for (const t of Object.values(state.threads)) {
    t.comments.sort(compareStamps);
  }

  return state;
}

/** Convenience: a stable, comparable view for assertions and snapshots. */
export function canonical(state) {
  return {
    v: state.v,
    threads: Object.keys(state.threads)
      .sort()
      .map((k) => state.threads[k]),
    orphans: (state.orphans ?? [])
      .slice()
      .sort((a, b) => (a.action.id < b.action.id ? -1 : a.action.id > b.action.id ? 1 : 0)),
  };
}
