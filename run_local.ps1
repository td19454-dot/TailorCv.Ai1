$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = "C:\Users\TRISHA\Desktop\cv\.venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "Python virtual environment not found at $venvPython" -ForegroundColor Red
    exit 1
}

Set-Location $projectRoot

# These proxy values break OpenAI calls in this environment.
$env:HTTP_PROXY = $null
$env:HTTPS_PROXY = $null
$env:ALL_PROXY = $null
$env:GIT_HTTP_PROXY = $null
$env:GIT_HTTPS_PROXY = $null

$env:PYTHONUTF8 = "1"
$env:ENABLE_RELOAD = "false"

# Free port 8000 if another local process is already using it.
$existingPids = @()
try {
    $existingPids = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction Stop |
        Select-Object -ExpandProperty OwningProcess -Unique
} catch {
    $existingPids = @()
}

foreach ($existingPid in $existingPids) {
    if ($existingPid -and $existingPid -ne $PID) {
        try {
            Stop-Process -Id $existingPid -Force -ErrorAction Stop
            Write-Host "Stopped process on port 8000 (PID $existingPid)" -ForegroundColor Yellow
        } catch {
            Write-Host "Could not stop process on port 8000 (PID $existingPid). You may need to run PowerShell as Administrator." -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "Starting TailorCV local server..." -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
Write-Host "App URL: http://127.0.0.1:8000/" -ForegroundColor Green
Write-Host "Solutions: http://127.0.0.1:8000/solutions" -ForegroundColor Green
Write-Host ""

& $venvPython "main.py"
