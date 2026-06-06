# scripts/serve-live.ps1
#
# Start @gloss/server against a real GitHub repo (Phase 2 live mode).
#
# Reads config from a gitignored .env file so the PAT never goes through an
# interactive prompt, shell history, or command arguments. The token is set as
# a process env var for the server only — it is never echoed.
#
# Usage:
#   1. Put your fresh PAT in .env  (GITHUB_TOKEN=github_pat_...)
#   2. pwsh -File scripts/serve-live.ps1

$envPath = Resolve-Path (Join-Path $PSScriptRoot ".." ".env")
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $k, $v = $line -split '=', 2
  Set-Item -Path "Env:$($k.Trim())" -Value $v.Trim()
}

$hasPat = $env:GITHUB_TOKEN -and $env:GITHUB_TOKEN -ne "PASTE_YOUR_NEW_PAT_HERE"
$hasOAuth = $env:GLOSS_OAUTH_CLIENT_ID -and $env:GLOSS_OAUTH_CLIENT_SECRET -and $env:GLOSS_OAUTH_CLIENT_SECRET -ne "PASTE_CLIENT_SECRET_HERE"
if (-not $hasPat -and -not $hasOAuth) {
  Write-Error "No auth configured in .env. Set GITHUB_TOKEN (PAT mode) or GLOSS_OAUTH_CLIENT_ID/SECRET (OAuth mode)."
  exit 1
}

$mode = if ($hasOAuth) { "OAuth (multi-user)" } else { "PAT (single-user)" }
Write-Host "Starting @gloss/server [$mode] -> $($env:GLOSS_OWNER)/$($env:GLOSS_REPO) on :8787" -ForegroundColor Green
node packages/server/src/index.js
