# Athlete Motion Desktop — Atualização das traduções da interface (PT/EN).
#
# Fluxo:
#   1. `pylupdate6` reextrai todos os textos marcados com `tr()`/`QT_TRANSLATE_NOOP`
#      do código-fonte para os ficheiros `.ts` (fonte única de tradução).
#   2. As traduções pendentes ficam marcadas como `unfinished` e a interface usa o
#      texto fonte (PT-PT) — nunca é inventado texto.
#   3. Se existir `lrelease` no PATH, é gerado o `.qm` compilado (opcional: a
#      aplicação interpreta os `.ts` diretamente quando não há `.qm`).
#
# Uso:  cd desktopapp ; ./scripts/update_translations.ps1

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$pylupdate = Join-Path $projectRoot ".venv\Scripts\pylupdate6.exe"

if (-not (Test-Path $pylupdate)) {
    $pylupdateCommand = Get-Command pylupdate6 -ErrorAction SilentlyContinue
    if ($null -eq $pylupdateCommand) {
        Write-Error "pylupdate6 não encontrado. Ative o ambiente (uv pip install -e .[dev]) antes de correr este script."
        exit 1
    }
    $pylupdate = $pylupdateCommand.Source
}

$sourceDirectory = Join-Path $projectRoot "src\athletemotion_desktop"
$translationsDirectory = Join-Path $sourceDirectory "ui\i18n"

foreach ($language in @("pt_PT", "en")) {
    $tsFile = Join-Path $translationsDirectory "$language.ts"
    Write-Host "A extrair textos para $tsFile ..." -ForegroundColor Cyan
    & $pylupdate --ts $tsFile $sourceDirectory
    if ($LASTEXITCODE -ne 0) {
        Write-Error "pylupdate6 falhou para $tsFile (código $LASTEXITCODE)."
        exit $LASTEXITCODE
    }
}

$lrelease = Get-Command lrelease -ErrorAction SilentlyContinue
if ($null -eq $lrelease) {
    Write-Host ""
    Write-Host "lrelease não está no PATH: os .qm não foram (re)compilados." -ForegroundColor Yellow
    Write-Host "Isso é esperado — o PyQt6 distribui apenas o pylupdate6. A aplicação" -ForegroundColor Yellow
    Write-Host "interpreta os ficheiros .ts diretamente (ver ui/i18n/translator.py)." -ForegroundColor Yellow
    exit 0
}

foreach ($language in @("pt_PT", "en")) {
    $tsFile = Join-Path $translationsDirectory "$language.ts"
    Write-Host "A compilar $tsFile ..." -ForegroundColor Cyan
    & $lrelease $tsFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "lrelease falhou para $tsFile (código $LASTEXITCODE)."
        exit $LASTEXITCODE
    }
}

Write-Host "Traduções atualizadas." -ForegroundColor Green
