# add-card.ps1 — create a card on the preventli-dashboard build board.
#
# Reads INTERNAL_API_KEY + INTERNAL_DASHBOARD_URL from the nearest .env (CWD or
# repo root). INTERNAL_DASHBOARD_URL defaults to http://localhost:3000 for dev.
#
# Usage:
#   .\add-card.ps1 -Title "Fix login redirect" [-Description "..."] [-Type bug] [-Priority 80]
#
# Exits 0 on success, prints the new card id; non-zero on failure.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Title,
  [string] $Description = "",
  [ValidateSet("idea","bug","feature","chore","question")] [string] $Type = "idea",
  [int] $Priority = 50,
  [string] $ParentId = ""
)

$ErrorActionPreference = "Stop"

function Get-EnvValue {
  param([string] $Name)
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($value) { return $value }
  $candidates = @(
    (Join-Path (Get-Location) ".env"),
    (Join-Path $PSScriptRoot "..\..\.env"),
    "D:\dev\preventli\.env"
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) {
      foreach ($line in Get-Content $path) {
        if ($line -match "^\s*$Name\s*=\s*(.+?)\s*$") { return $Matches[1].Trim('"') }
      }
    }
  }
  return $null
}

$apiKey = Get-EnvValue -Name "INTERNAL_API_KEY"
$dashboardUrl = Get-EnvValue -Name "INTERNAL_DASHBOARD_URL"
if (-not $dashboardUrl) { $dashboardUrl = "http://localhost:3000" }

if (-not $apiKey) {
  Write-Error "INTERNAL_API_KEY not set (env or .env). Cannot authenticate to dashboard."
  exit 1
}

$body = @{
  title       = $Title
  description = $Description
  type        = $Type
  priority    = $Priority
}
if ($ParentId) { $body.parentId = $ParentId }

$json = $body | ConvertTo-Json -Compress

try {
  $response = Invoke-RestMethod -Method POST `
    -Uri "$dashboardUrl/api/cards" `
    -Headers @{ "Authorization" = "Bearer $apiKey"; "Content-Type" = "application/json" } `
    -Body $json
} catch {
  Write-Error "POST /api/cards failed: $($_.Exception.Message)"
  exit 1
}

if (-not $response.ok) {
  Write-Error "Dashboard rejected card: $($response.error)"
  exit 1
}

Write-Host "Created card: $($response.id)"
Write-Host "  Title:    $Title"
Write-Host "  Type:     $Type"
Write-Host "  Priority: $Priority"
exit 0
