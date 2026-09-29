# ============================================================================
#  G.O.C Academy Hub — start the server
#  ---------------------------------------------------------------------------
#  Right-click this file and choose "Run with PowerShell".
#  It starts the app, then opens it in your browser. Press Ctrl+C to stop.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host ''
Write-Host '  G.O.C Academy Hub' -ForegroundColor Red
Write-Host '  Building Purpose-Driven Independent Scholars'
Write-Host ''

# --- is Node installed? -----------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '  Node.js is not installed on this computer.' -ForegroundColor Yellow
  Write-Host '  Download it (the "LTS" version) from https://nodejs.org'
  Write-Host '  then run this file again.'
  Write-Host ''
  Write-Host '  In the meantime you can still open GOC-Web-App\index.html'
  Write-Host '  by double-clicking it — that runs the demo without a server.'
  Write-Host ''
  Read-Host '  Press Enter to close'
  exit 1
}

# --- optional: your own console passcode ------------------------------------
# Uncomment the next line and change 2027 to set a different passcode.
# $env:GOC_PASSCODE = '2027'

# --- before real students use it --------------------------------------------
# The two console passwords in the readme are published, so they are not
# secrets. Uncomment these two lines and set your own BEFORE the first run:
# they are only read while server\data.json is being created. After that,
# change them from the console instead (Founder only).
# $env:GOC_FOUNDER_PW = 'something-only-you-know'
# $env:GOC_ACADDIR_PW = 'something-only-she-knows'

# --- the create-account code -------------------------------------------------
# Nobody can create an account without this. It ships as GOC-2027, which is
# printed in the readme, so CHANGE IT BEFORE YOU TELL A COHORT TO REGISTER.
# Set it here before the first run, or from the console afterwards — Founder
# and Academic Director may both change it (Access & firewall).
# $env:GOC_SIGNUP_CODE = 'whatever-you-told-the-cohort'

Write-Host ('  Node ' + (node --version) + ' found. Starting...')
Write-Host ''

# Give the server a moment to bind, then open the browser.
Start-Job -ScriptBlock {
  Start-Sleep -Seconds 2
  Start-Process 'http://localhost:8080'
} | Out-Null

node "server\server.js"

Write-Host ''
Write-Host '  Server stopped.'
Read-Host '  Press Enter to close'
