# complete-card.ps1 — mark a build-board card as complete (or move it elsewhere).
#
# Usage:
#   .\complete-card.ps1 -Id <card-id>                 # → status = complete
#   .\complete-card.ps1 -Id <card-id> -Status active  # → status = active

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Id,
  [ValidateSet("open","active","complete","dev_request")] [string] $Status = "complete"
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

$body = @{ status = $Status } | ConvertTo-Json -Compress

try {
  $response = Invoke-RestMethod -Method PATCH `
    -Uri "$dashboardUrl/api/cards?id=$([uri]::EscapeDataString($Id))" `
    -Headers @{ "Authorization" = "Bearer $apiKey"; "Content-Type" = "application/json" } `
    -Body $body
} catch {
  Write-Error "PATCH /api/cards failed: $($_.Exception.Message)"
  exit 1
}

if (-not $response.ok) {
  Write-Error "Dashboard rejected update: $($response.error)"
  exit 1
}

Write-Host "Card $Id → $Status"
exit 0
