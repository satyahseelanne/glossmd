# Gloss — Azure Deployment Plan

**Status:** Validated

## 1. Overview

Deploy **Gloss** — Word-style review comments for markdown in git — as a single
publicly reachable web application on **Azure Container Apps (ACA)**.

Gloss is two pieces that ship as **one container**:
- `apps/web` — a static React/Vite SPA (built to `dist/`).
- `packages/server` — a zero-dependency Node HTTP server that does GitHub OAuth
  and commits review actions/edits to the user's repos via the GitHub REST API.

In production the Node server also serves the built SPA, so the frontend and API
share one origin (no CORS; the `gloss_sid` session cookie just works).

## 2. Architecture

```
Browser ──HTTPS──► Azure Container App (single replica)
                   └─ Node server (:8787)
                        ├─ serves apps/web/dist  (SPA)
                        ├─ /auth/*   GitHub OAuth round trip
                        └─ /file /reviews /tree … → GitHub REST API (as the user)
```

- **Compute:** Azure Container Apps, 1 container.
- **Scale:** min 1 / max 1 replica for v1 (sessions are in-memory — see Risks).
- **Registry:** Azure Container Registry (built + pushed by `azd`).
- **Secrets:** GitHub OAuth client secret in **Azure Key Vault**; the Container App
  references it via a Key Vault secret reference, read at runtime through the
  app's user-assigned managed identity (Key Vault Secrets User).
- **Ingress:** external, HTTPS, target port 8787.
- **No database, no storage** — Gloss is stateless; all data lives in the user's git repo.

## 3. Components → Azure services

| Component | Azure service |
|---|---|
| Node server + static SPA (one image) | Azure Container Apps |
| Container image | Azure Container Registry |
| OAuth secret | Azure Key Vault (ACA Key Vault reference via managed identity) |
| Logs/metrics | Log Analytics + Container Apps Environment |

## 4. Required code/config changes

1. **Serve the SPA from the Node server** in production (one origin). ✅ done —
   `packages/server/src/index.js` serves `apps/web/dist` with SPA fallback when
   the build is present; OAuth mode no longer requires a pinned repo.
2. **Dockerfile** — multi-stage: build the web app, then run the Node server. ✅
3. **azure.yaml + infra/** — AZD with Bicep for the ACA + ACR + environment. ✅
   (`azure.yaml`, `infra/main.bicep`, `infra/resources.bicep`,
   `infra/main.parameters.json`, `.dockerignore`)
4. **GitHub OAuth app** — add the production callback URL; set `GLOSS_BASE_URL`.
   ⏳ done during deploy (two-step below).
5. Secrets supplied as env at deploy time, never committed. ✅ (ACA secret)

Local production smoke test passed: server serves `/` as HTML, falls back to
`index.html` for client routes, and still returns API JSON.

## 5. Configuration (env)

| Var | Purpose |
|---|---|
| `GLOSS_OAUTH_CLIENT_ID` | GitHub OAuth app client id (secret) |
| `GLOSS_OAUTH_CLIENT_SECRET` | GitHub OAuth app client secret (secret) |
| `GLOSS_BASE_URL` | Public https URL of the app (sets OAuth callback + Secure cookie) |
| `GLOSS_OAUTH_SCOPE` | `repo` |
| `PORT` | 8787 |

## 6. Decisions (confirmed)

- **Azure subscription:** `d954ec03-225b-4de7-9fe8-3f7436254f8a`
- **Region/location:** West US 2 (`westus2`)
- **Recipe:** AZD + Bicep (default)
- **Custom domain:** none for now — use the default `*.azurecontainerapps.io` URL
- **OAuth app:** reuse the existing GitHub OAuth app; add the production callback URL
- **AZD environment name:** `gloss` (resource group `rg-gloss`)

### Two-step OAuth note (chicken-and-egg)

The ACA public FQDN isn't known until the first deploy. So:
1. First `azd up` creates the app and prints its `https://<app>.westus2.azurecontainerapps.io` URL.
2. Set `GLOSS_BASE_URL` to that URL and add `<url>/auth/callback` to the GitHub OAuth app.
3. Re-apply env (quick `azd deploy`/update) so the callback + Secure cookie match.

## 7. Risks / follow-ups
- **In-memory sessions** → single replica only (min=1, max=1). Users re-sign-in on
  restart. Follow-up: move sessions to Azure Cache for Redis to scale out.
- OAuth callback must match `GLOSS_BASE_URL` exactly or sign-in fails (handled by
  the two-step above).
- Secrets (`GLOSS_OAUTH_CLIENT_SECRET`) stored in **Azure Key Vault**; the app
  reads it via an ACA Key Vault reference using its managed identity. The value
  is set once via `azd env set` (user's terminal), written to KV by Bicep, and
  never committed. Rotate later directly in KV with no redeploy.

## 8. Validation proof

| Check | Command | Result |
|---|---|---|
| Web build | `npm run build --workspace @gloss/web` | ✅ built |
| Prod static serve | server `--dev` with `dist` present | ✅ `/` → HTML, deep link → index.html fallback, `/auth/me` → JSON |
| Bicep compiles | `az bicep build --file infra/main.bicep` | ✅ (1 benign BCP334 length warning) |
| Unit tests | `node --test packages/*/test/*.test.js` | ✅ 31/31 |
| Tooling | `az`, `docker` present; `azd 1.25.5` installed | ✅ |

## Workflow

azure-prepare → azure-validate → azure-deploy