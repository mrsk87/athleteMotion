# Athlete Motion Desktop — Configuração do ambiente de desenvolvimento.
#
# Cria/reutiliza um ambiente virtual com Python 3.11 ou 3.12 (o projeto suporta
# `>=3.11,<3.13`), instala o pacote em modo editável com as dependências de
# desenvolvimento e atualiza os ficheiros de tradução.
#
# Uso:  cd desktopapp ; ./scripts/dev_setup.ps1

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "=== Configuração do Ambiente Athlete Motion Desktop ===" -ForegroundColor Cyan

$uvCommand = Get-Command uv -ErrorAction SilentlyContinue

if ($null -ne $uvCommand) {
    Write-Host "A criar/atualizar o ambiente virtual (uv + Python 3.11)..." -ForegroundColor Green
    uv venv --python 3.11
    uv pip install -e ".[dev]"
} else {
    Write-Host "uv não detetado: a usar o Python do PATH e 'pip'." -ForegroundColor Yellow
    Write-Host "Nota: é necessário Python 3.11 ou 3.12 (o projeto não suporta 3.13+)." -ForegroundColor Yellow
    python -m venv .venv
    & (Join-Path $projectRoot ".venv\Scripts\python.exe") -m pip install --upgrade pip
    & (Join-Path $projectRoot ".venv\Scripts\python.exe") -m pip install -e ".[dev]"
}

$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Error "Ambiente virtual não criado em $python."
    exit 1
}

Write-Host "`n=== Verificação de versão e componentes ===" -ForegroundColor Cyan
& $python -c @"
import sys
from pathlib import Path
import PyQt6, psutil, pydantic, athletemotion_desktop
import athletemotion_desktop.config.settings  # noqa: F401  (confirma o pacote instalado)

if not ((3, 11) <= sys.version_info[:2] < (3, 13)):
    raise SystemExit(f'Python {sys.version_info.major}.{sys.version_info.minor} não suportado (>=3.11,<3.13).')

print(f'Python {sys.version.split()[0]} OK')
print('PyQt6, psutil, pydantic e athletemotion_desktop OK')
print(f'PyQt6 vem de {Path(PyQt6.__file__).parent}')
"@

Write-Host "`n=== Traduções (PT/EN) ===" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "update_translations.ps1")

Write-Host "`nAmbiente configurado com sucesso. Comandos úteis:" -ForegroundColor Green
Write-Host "  .venv\Scripts\python.exe -m athletemotion_desktop   # abrir a aplicação"
Write-Host "  `$env:QT_QPA_PLATFORM=`"offscreen`"; .venv\Scripts\python.exe -m pytest -q   # testes"
Write-Host "  .venv\Scripts\ruff.exe check . ; .venv\Scripts\mypy.exe src/athletemotion_desktop/runtime"
