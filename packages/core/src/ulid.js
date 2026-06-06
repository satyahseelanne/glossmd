// ulid.js
//
// ULIDs are the single most important adaptation that makes Gloss merge-safe in
// git: each action is its own file named by a ULID, so two reviewers committing
// at the same instant never pick the same filename. Two properties matter here:
//
//   1. Collision-free  — 80 bits of randomness per id.
//   2. Lexically sortable == chronologically sortable — the 48-bit millisecond
//      timestamp is the high-order part, Crockford base32 preserves order, so a
//      plain string sort of ULIDs recovers commit order. The reducer leans on
//      this; we never need a sequential counter.
//
// Within a single millisecond we increment the random component (monotonic
// factor) so ids minted back-to-back on one machine still sort in creation
// order. Across machines, ties in (ts, id) are vanishingly unlikely and, if they
// occur, break deterministically on the id string — which is all the reducer
// needs.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 (no I,L,O,U)
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10; // 48 bits -> 10 base32 chars
const RAND_LEN = 16; // 80 bits -> 16 base32 chars

function encodeTime(now, len) {
  let str = "";
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % ENCODING_LEN;
    str = ENCODING[mod] + str;
    now = (now - mod) / ENCODING_LEN;
  }
  return str;
}

function randomChar(rng) {
  return ENCODING[Math.floor(rng() * ENCODING_LEN)];
}

function encodeRandom(len, rng) {
  let str = "";
  for (let i = 0; i < len; i++) str += randomChar(rng);
  return str;
}

// Increment a base32 string by one, with carry. Used for the monotonic factor so
// two ULIDs minted in the same millisecond still sort in mint order.
function incrementBase32(str) {
  const chars = str.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ENCODING.indexOf(chars[i]);
    if (idx < ENCODING_LEN - 1) {
      chars[i] = ENCODING[idx + 1];
      return chars.join("");
    }
    chars[i] = ENCODING[0]; // carry
  }
  throw new Error("ULID random component overflow (impossible within one ms)");
}

/**
 * Create a ULID factory. Injectable clock + rng make it fully deterministic in
 * tests; defaults use the system clock and Math.random in production.
 *
 * @param {object} [opts]
 * @param {() => number} [opts.now] - returns epoch milliseconds
 * @param {() => number} [opts.rng] - returns a float in [0, 1)
 * @returns {() => string} a monotonic ULID generator
 */
export function ulidFactory(opts = {}) {
  const now = opts.now ?? (() => Date.now());
  const rng = opts.rng ?? Math.random;
  let lastTime = -1;
  let lastRandom = "";

  return function ulid() {
    const time = now();
    if (time === lastTime) {
      lastRandom = incrementBase32(lastRandom);
    } else {
      lastTime = time;
      lastRandom = encodeRandom(RAND_LEN, rng);
    }
    return encodeTime(time, TIME_LEN) + lastRandom;
  };
}

/** Extract the epoch-millisecond timestamp encoded in a ULID. */
export function ulidTime(id) {
  const timePart = id.slice(0, TIME_LEN);
  let time = 0;
  for (const ch of timePart) {
    time = time * ENCODING_LEN + ENCODING.indexOf(ch);
  }
  return time;
}

/** Default process-wide generator. */
export const ulid = ulidFactory();
