# Auth Flow

The backend exists only to do OAuth and to commit on behalf of the reviewer.
It never interprets a comment. The reducer and anchoring live client-side.

## OAuth handoff

1. Reviewer clicks "Sign in with GitHub" in the web app.
2. Backend redirects to GitHub's OAuth authorize endpoint with the `repo`
   scope and a state token.
3. GitHub redirects back to `/auth/callback`; backend exchanges the code for
   a token, encrypts it, and stores it in a session cookie.

## Token usage

Each `POST /reviews/actions` call constructs a `GitHubHost` from the session's
stored token and runs the commit loop. The token never leaves the backend.

## Personal access tokens

In single-user mode (e.g. running Gloss locally against a private repo) a
`GITHUB_TOKEN` environment variable substitutes for the OAuth flow. The
remaining surface is identical.
