# Iniciar Athlete Motion API com o ambiente virtual dedicado
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$venvPython = Join-Path $PSScriptRoot "backend\.venv\Scripts\python.exe"

if (Test-Path $venvPython) {
    Write-Host "[AthleteMotion] A iniciar backend com o ambiente virtual backend\.venv ..." -ForegroundColor Cyan
    & $venvPython -m athletemotion.api
} else {
    Write-Host "[AthleteMotion] backend\.venv nao encontrado. A tentar Python do sistema ..." -ForegroundColor Yellow
    python -m athletemotion.api
}
