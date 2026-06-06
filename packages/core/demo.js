// demo.js — a runnable walkthrough of the protocol with real ULIDs.
// Run: node demo.js
import {
  ulid, createThread, addComment, editComment, resolveThread,
  reduce, load, compact,
} from "./src/index.js";

const now = () => new Date().toISOString();
const asha = { id: "u_a", name: "Asha" };
const dev = { id: "u_b", name: "Dev" };

// --- a review session: each action is one file that would land in .gloss/ ---
const log = [];
const t1 = ulid();
log.push(createThread({
  id: t1, actor: asha, ts: now(),
  anchor: { commit: "9f3c1ab", file: "design.md", quote: "portable by default", prefix: "be ", suffix: ", readable" },
  body: "Can we spell out what portable buys us vs GitHub PR comments?",
}));
log.push(addComment({ id: ulid(), actor: dev, ts: now(), thread_id: t1, body: "Means comments live in the repo, any tool can read them. Adding a line." }));
const firstCommentId = t1; // the seed comment shares the thread's id
log.push(editComment({ id: ulid(), actor: asha, ts: now(), target: firstCommentId, body: "Can we spell out what 'portable' buys us, concretely?" }));
log.push(resolveThread({ id: ulid(), actor: asha, ts: now(), thread_id: t1 }));

// --- load the way a client would: replay the log ---
const state = reduce(log);
const thread = state.threads[t1];
console.log("THREAD", t1.slice(0, 12), "·", thread.status);
console.log("  anchor:", JSON.stringify(thread.anchor.quote));
for (const c of thread.comments) {
  console.log(`  - ${c.actor.name}: ${c.body}${c.edited ? "  (edited)" : ""}`);
}

// --- compaction: fold the log into a checkpoint, then a late edit arrives ---
const { checkpoint, folded } = compact(ulid, now(), log);
console.log(`\nCheckpoint ${checkpoint.id.slice(0, 12)} folded ${folded.length} actions; _log/ is now empty.`);

const lateEdit = editComment({
  id: ulid(), actor: dev, ts: "2000-01-01T00:00:00.000Z", // deliberately ancient
  target: firstCommentId, body: "STALE — should be ignored",
});
const afterLate = load(checkpoint, [lateEdit]);
console.log("After a stale late edit folds onto the checkpoint, body is still:");
console.log("  ", JSON.stringify(afterLate.threads[t1].comments[0].body));
console.log(afterLate.threads[t1].comments[0].body.startsWith("STALE") ? "  ✗ clobbered" : "  ✓ self-healed");
