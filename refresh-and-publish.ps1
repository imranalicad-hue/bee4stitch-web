<#
.SYNOPSIS
  Re-extracts a machine's next2.db into this site's data folder, then
  publishes the update (git push, or Vercel CLI deploy — whichever this
  project is set up to use).

.DESCRIPTION
  This is the "I updated the data on my system, now put it online" step for
  Cutter Performance. It does not touch next2.db itself — it only reads it
  (via extract-next2.py) and rewrites the JSON file the web page loads.

.PARAMETER Next2DbPath
  Full path to the machine's next2.db (under its xt2cache folder).

.PARAMETER MachineId
  Must exactly match an id in the MACHINES list in public/cutterPerformance.js,
  e.g. "kay-emms-1". This is the key the web page looks up, separate from the
  display label.

.PARAMETER MachineLabel
  Display name shown in the web app's machine picker, e.g. "Kay & Emms – Cutter #1".

.PARAMETER OutFile
  Path (relative to this script) to write the extracted data file to — a
  .js file, not .json (see extract-next2.py's docstring for why). Must
  match that same entry's `url` in the MACHINES list in public/cutterPerformance.js.

.PARAMETER Since
  Only include rows on/after this date (YYYY-MM-DD). Omit to extract
  everything (can be large for machines with years of history).

.PARAMETER Deploy
  After extracting, also publish: pushes to git if this folder is a git repo
  with a remote, otherwise runs `vercel --prod` if the Vercel CLI is
  installed and logged in. Without this switch, the script only refreshes
  the local data file — nothing is published.

.EXAMPLE
  .\refresh-and-publish.ps1 `
    -Next2DbPath "D:\Documents\Data Jezseem Traders\ERP Development\Morgan Cutter\Kay & Emms\Next 2 90 (Cutter # 1)\xt2cache\next2.db" `
    -MachineId "kay-emms-1" `
    -MachineLabel "Kay & Emms – Cutter #1" `
    -OutFile "public\data\next2-kay-emms-cutter1.js" `
    -Since 2026-06-01 `
    -Deploy
#>
param(
    [Parameter(Mandatory = $true)][string]$Next2DbPath,
    [Parameter(Mandatory = $true)][string]$MachineId,
    [Parameter(Mandatory = $true)][string]$MachineLabel,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$Since = "",
    [switch]$Deploy
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path $Next2DbPath)) {
    Write-Error "next2.db not found at: $Next2DbPath"
    exit 1
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Error "Python 3 wasn't found on PATH. Install it (python.org) and re-run — extract-next2.py needs it " + `
                "for sqlite3, which is part of the Python standard library (no pip install required)."
    exit 1
}

Write-Host "Extracting from: $Next2DbPath"
$extractArgs = @($Next2DbPath, $MachineId, $MachineLabel, $OutFile)
if ($Since) { $extractArgs += @("--since", $Since) }
& $python.Path "extract-next2.py" @extractArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "extract-next2.py failed (exit code $LASTEXITCODE)."
    exit 1
}

Write-Host "`nData refreshed: $OutFile"

if (-not $Deploy) {
    Write-Host "Local file updated only (no -Deploy flag) — nothing was published."
    exit 0
}

$isGitRepo = Test-Path ".git"
$vercelCli = Get-Command vercel -ErrorAction SilentlyContinue

if ($isGitRepo) {
    $hasRemote = (git remote) -ne $null -and (git remote).Length -gt 0
    if ($hasRemote) {
        Write-Host "`nPublishing via git push (Vercel's GitHub integration will redeploy automatically)..."
        git add $OutFile
        git commit -m "Refresh $MachineLabel cutter performance data"
        git push
        Write-Host "Pushed. Check your Vercel dashboard for the new deployment."
        exit 0
    }
}

if ($vercelCli) {
    Write-Host "`nNo git remote found — publishing directly with the Vercel CLI..."
    vercel --prod
    exit 0
}

Write-Host "`nData refreshed locally, but nothing was published automatically:"
Write-Host "  - This folder isn't a git repo with a remote, and"
Write-Host "  - The Vercel CLI ('vercel') isn't installed."
Write-Host "`nEither push this project to GitHub (Vercel will redeploy on push), or install the Vercel CLI"
Write-Host "(npm i -g vercel) and re-run this script with -Deploy, or run 'vercel --prod' yourself."
