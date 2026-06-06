// actions.js
//
// Every comment operation is an immutable action — one JSON object, written to
// one file under .gloss/<doc>/_log/<id>.json. Nothing is ever mutated in place;
// edits and deletes are themselves actions (supersede / tombstone). This is what
// gives us a deterministic reducer and a free audit trail.
//
// All actions share an envelope:
//   { v, id, type, actor, ts }
// plus a per-type payload. `id` is the ULID and also the filename. `ts` is the
// authoritative ordering key; ties break on `id`.

export const PROTOCOL_VERSION = 1;

export const ActionType = Object.freeze({
  CREATE_THREAD: "create_thread",
  ADD_COMMENT: "add_comment",
  EDIT_COMMENT: "edit_comment",
  DELETE_COMMENT: "delete_comment",
  RESOLVE_THREAD: "resolve_thread",
  REOPEN_THREAD: "reopen_thread",
});

function envelope(type, id, actor, ts) {
  if (!id) throw new Error("action requires an id (ULID)");
  if (!actor || !actor.id) throw new Error("action requires actor.id");
  if (!ts) throw new Error("action requires ts (ISO timestamp)");
  return { v: PROTOCOL_VERSION, id, type, actor, ts };
}

/**
 * Mint a thread and seed its first comment in a single action (one commit).
 * The anchor binds the thread to a span of rendered text at a specific commit.
 */
export function createThread({ id, actor, ts, anchor, body }) {
  if (!anchor || !anchor.quote) throw new Error("create_thread requires an anchor with a quote");
  return {
    ...envelope(ActionType.CREATE_THREAD, id, actor, ts),
    thread_id: id, // the thread's id is the create action's id
    anchor,
    body,
  };
}

/** Reply to a thread. The comment's id is this action's id. */
export function addComment({ id, actor, ts, thread_id, body, reply_to = null }) {
  if (!thread_id) throw new Error("add_comment requires thread_id");
  return { ...envelope(ActionType.ADD_COMMENT, id, actor, ts), thread_id, body, reply_to };
}

/** Supersede a comment's body. Never mutates; the reducer resolves by (ts, id). */
export function editComment({ id, actor, ts, target, body }) {
  if (!target) throw new Error("edit_comment requires target (comment id)");
  return { ...envelope(ActionType.EDIT_COMMENT, id, actor, ts), target, body };
}

/** Tombstone a comment. */
export function deleteComment({ id, actor, ts, target }) {
  if (!target) throw new Error("delete_comment requires target (comment id)");
  return { ...envelope(ActionType.DELETE_COMMENT, id, actor, ts), target };
}

export function resolveThread({ id, actor, ts, thread_id }) {
  if (!thread_id) throw new Error("resolve_thread requires thread_id");
  return { ...envelope(ActionType.RESOLVE_THREAD, id, actor, ts), thread_id };
}

export function reopenThread({ id, actor, ts, thread_id }) {
  if (!thread_id) throw new Error("reopen_thread requires thread_id");
  return { ...envelope(ActionType.REOPEN_THREAD, id, actor, ts), thread_id };
}

/**
 * Total order over actions: by ts, then by id. Both are chosen so that a plain
 * lexical string compare equals chronological order (ISO-8601 ts, ULID id).
 * Returns negative if a precedes b.
 */
export function compareActions(a, b) {
  if (a.ts < b.ts) return -1;
  if (a.ts > b.ts) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Compare two {ts, id} stamps — used by the reducer for last-writer-wins. */
export function compareStamps(a, b) {
  if (a.ts < b.ts) return -1;
  if (a.ts > b.ts) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
