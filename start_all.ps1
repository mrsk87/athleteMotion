# Iniciar simultaneamente o Backend e o Frontend Web em janelas PowerShell dedicadas
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$backendDir = Join-Path $PSScriptRoot "backend"
$frontendDir = Join-Path $PSScriptRoot "frontend\web"
$venvPython = Join-Path $PSScriptRoot "backend\.venv\Scripts\python.exe"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  A iniciar Athlete Motion: Backend + Frontend Web" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Backend
if (Test-Path $venvPython) {
    Write-Host "1. A arrancar Backend com $venvPython..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendDir'; & '$venvPython' -m athletemotion.api"
} else {
    Write-Host "1. A arrancar Backend com Python do sistema..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendDir'; python -m athletemotion.api"
}

# 2. Configurar Token de API no Frontend
$tokenFile = Join-Path $env:APPDATA "AthleteMotion\api_token"
if (Test-Path $tokenFile) {
    $token = (Get-Content $tokenFile).Trim()
    $envLocalPath = Join-Path $frontendDir ".env.local"
    "VUE_APP_API_TOKEN=$token`nVUE_APP_API_URL=http://localhost:8000`nVUE_APP_WS_URL=ws://localhost:8000" | Set-Content -Path $envLocalPath -Encoding utf8
    Write-Host "   Token de API injetado em $envLocalPath" -ForegroundColor DarkGray
}

# 3. Frontend
Write-Host "2. A arrancar Frontend Web (npm run serve)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npm run serve"

Write-Host ""
Write-Host "Serviços iniciados:" -ForegroundColor Cyan
Write-Host "  - Backend API:  http://127.0.0.1:8000/docs"
Write-Host "  - Frontend Web: http://localhost:8080"
Write-Host "========================================================" -ForegroundColor Cyan
