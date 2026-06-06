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

if (-not $env:GITHUB_TOKEN -or $env:GITHUB_TOKEN -eq "PASTE_YOUR_NEW_PAT_HERE") {
  Write-Error "GITHUB_TOKEN not set in .env. Edit .env and paste your PAT, then re-run."
  exit 1
}

Write-Host "Starting @gloss/server (live) -> $($env:GLOSS_OWNER)/$($env:GLOSS_REPO) on :8787" -ForegroundColor Green
node packages/server/src/index.js
