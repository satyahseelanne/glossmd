# Security Policy

## Reporting a vulnerability

Please report security issues privately. **Do not open a public issue for a
suspected vulnerability.**

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  on this repository (Security tab → *Report a vulnerability*), or
- Email the maintainers at the address listed on the repository's profile.

Please include enough detail to reproduce: affected version/commit, steps, and
the impact you observed. We aim to acknowledge reports within a few business days.

## Scope

Gloss stores review comments append-only in a `.gloss/` directory in a git
repository, and an optional backend performs GitHub authentication and commits on
a reviewer's behalf. Areas of particular interest:

- Authentication and session handling in `@gloss/server` (OAuth, PAT, dev modes).
- Any path that could write outside a document's `.gloss/` directory.
- Handling of untrusted markdown/comment content in the web app.

## Handling of secrets

- No secrets belong in this repository. Configuration is supplied at runtime via
  environment variables; see `.env.example`. `.env` and `.azure/` are gitignored.
- The OAuth client secret is provided to the deployed app as a platform secret
  (an Azure Container Apps secret) and is never baked into the image or committed.
- If you believe a secret has been committed, treat it as compromised: rotate it
  immediately and report it via the process above.
