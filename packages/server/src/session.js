// @gloss/server — src/session.js
//
// Dependency-free session + OAuth-state plumbing for the multi-user GitHub flow.
// Sessions hold a reviewer's access token *server-side only* — the token never
// goes to the browser. The browser gets an opaque HttpOnly cookie that maps to
// the session. State tokens guard the OAuth round trip against CSRF.
//
// This is an in-memory store: fine for a single-process demo/self-host, lost on
// restart (users just sign in again). A multi-instance deployment would swap in
// a shared store (Redis, a signed cookie, etc.) behind the same interface.

import { randomBytes } from "node:crypto";

const COOKIE = "gloss_sid";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const STATE_TTL_MS = 1000 * 60 * 10; // 10m to complete the OAuth round trip

const rid = () => randomBytes(24).toString("base64url");

export function createSessionStore() {
  /** @type {Map<string, { token: string, user: object, expires: number }>} */
  const sessions = new Map();
  /** @type {Map<string, { redirect: string, expires: number }>} */
  const states = new Map();

  function sweep() {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expires <= now) sessions.delete(k);
    for (const [k, v] of states) if (v.expires <= now) states.delete(k);
  }

  return {
    /** Mint a CSRF state token for the authorize redirect. */
    newState(redirect = "/") {
      sweep();
      const state = rid();
      states.set(state, { redirect, expires: Date.now() + STATE_TTL_MS });
      return state;
    },
    /** Validate + consume a state token (single use). Returns its redirect or null. */
    consumeState(state) {
      const s = states.get(state);
      if (!s) return null;
      states.delete(state);
      if (s.expires <= Date.now()) return null;
      return s.redirect || "/";
    },
    /** Create a session for a reviewer; returns the cookie id. */
    create(token, user) {
      sweep();
      const sid = rid();
      sessions.set(sid, { token, user, expires: Date.now() + SESSION_TTL_MS });
      return sid;
    },
    /** Look up a live session by cookie id. */
    get(sid) {
      if (!sid) return null;
      const s = sessions.get(sid);
      if (!s) return null;
      if (s.expires <= Date.now()) { sessions.delete(sid); return null; }
      return s;
    },
    destroy(sid) {
      if (sid) sessions.delete(sid);
    },
  };
}

// --- cookie helpers (no deps) ----------------------------------------------

/** Parse a Cookie header into a plain object. */
export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** The session cookie id from a request, or null. */
export function sidFromReq(req) {
  return parseCookies(req.headers.cookie || "")[COOKIE] || null;
}

/** Build a Set-Cookie value. `secure` only when behind https. */
export function setCookie(sid, { secure = false, maxAgeMs = SESSION_TTL_MS } = {}) {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(sid)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** A Set-Cookie value that clears the session cookie. */
export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export const COOKIE_NAME = COOKIE;
