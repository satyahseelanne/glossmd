// index.js — @gloss/core public API
export { ulid, ulidFactory, ulidTime } from "./ulid.js";
export {
  PROTOCOL_VERSION,
  ActionType,
  createThread,
  addComment,
  editComment,
  deleteComment,
  resolveThread,
  reopenThread,
  compareActions,
  compareStamps,
} from "./actions.js";
export { reduce, canonical } from "./reducer.js";
export {
  buildCheckpoint,
  checkpointToState,
  load,
  compact,
} from "./checkpoint.js";
