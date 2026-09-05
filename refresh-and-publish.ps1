<#
.SYNOPSIS
  Re-extracts a machine's next2.db and publishes it straight to the live
  site's cloud database — no git push, no Vercel redeploy needed.

.DESCRIPTION
  This is the "I updated the data on my system, now put it online" step for
  Cutter Performance. It does not touch next2.db itself — it only reads it
  (via extract-next2.py) and, with -PublishUrl/-PublishKey, POSTs the
  extracted rows to the live site's /api/publish-machine endpoint, which
  saves them into the project's Postgres database. Anyone who opens the
  site sees the update immediately.

.PARAMETER Next2DbPath
  Full path to the machine's next2.db (under its xt2cache folder).

.PARAMETER MachineId
  The key the web page looks up — reuse an existing id (see the machine
  picker on the live site) to update that machine, or invent a new short
  lowercase-hyphenated one to add a customer.

.PARAMETER MachineLabel
  Display name shown in the web app's machine picker, e.g. "Kay & Emms – Cutter #1".

.PARAMETER OutFile
  Path (relative to this script) to write a local backup/preview data file
  to (a .js file — see extract-next2.py's docstring). Useful for offline
  viewing; not how data reaches the live site.

.PARAMETER Since
  Only include rows on/after this date (YYYY-MM-DD). Omit to extract
  everything (can be large for machines with years of history).

.PARAMETER PublishUrl
  The live site's base URL, e.g. "https://bee4stitch.vercel.app". When
  given (with -PublishKey), also publishes straight to the cloud database —
  the same effect as clicking Publish in the browser.

.PARAMETER PublishKey
  The site's PUBLISH_SECRET (see the README's "Setting up the cloud
  database"). Required if -PublishUrl is given.

.EXAMPLE
  .\refresh-and-publish.ps1 `
    -Next2DbPath "D:\Documents\Data Jezseem Traders\ERP Development\Morgan Cutter\Kay & Emms\Next 2 90 (Cutter # 1)\xt2cache\next2.db" `
    -MachineId "kay-emms-1" `
    -MachineLabel "Kay & Emms – Cutter #1" `
    -OutFile "public\data\next2-kay-emms-cutter1.js" `
    -Since 2026-06-01 `
    -PublishUrl "https://bee4stitch.vercel.app" `
    -PublishKey "your-publish-secret"
#>
param(
    [Parameter(Mandatory = $true)][string]$Next2DbPath,
    [Parameter(Mandatory = $true)][string]$MachineId,
    [Parameter(Mandatory = $true)][string]$MachineLabel,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$Since = "",
    [string]$PublishUrl = "",
    [string]$PublishKey = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path $Next2DbPath)) {
    Write-Error "next2.db not found at: $Next2DbPath"
    exit 1
}

if ($PublishUrl -and -not $PublishKey) {
    Write-Error "-PublishUrl was given without -PublishKey — both are required to publish."
    exit 1
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Error ("Python 3 wasn't found on PATH. Install it (python.org) and re-run — extract-next2.py needs it " +
                 "for sqlite3, which is part of the Python standard library (no pip install required).")
    exit 1
}

Write-Host "Extracting from: $Next2DbPath"
$extractArgs = @($Next2DbPath, $MachineId, $MachineLabel, $OutFile)
if ($Since) { $extractArgs += @("--since", $Since) }
if ($PublishUrl) { $extractArgs += @("--publish-url", $PublishUrl, "--publish-key", $PublishKey) }
& $python.Path "extract-next2.py" @extractArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "extract-next2.py failed (exit code $LASTEXITCODE)."
    exit 1
}

Write-Host "`nData refreshed: $OutFile"
if (-not $PublishUrl) {
    Write-Host "Local file updated only (no -PublishUrl given) — nothing was published to the live site."
}
