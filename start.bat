@echo off
cd /d "%~dp0"

if exist "backend\.venv\Scripts\python.exe" (
    echo [AthleteMotion] A iniciar backend com o ambiente virtual backend\.venv ...
    "backend\.venv\Scripts\python.exe" -m athletemotion.api
) else (
    echo [AthleteMotion] backend\.venv nao encontrado. A tentar Python do sistema ...
    python -m athletemotion.api
)

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] Ocorreu um problema ao iniciar o backend.
    echo Verifique se o ambiente virtual existe e se as dependencias estao instaladas.
)
pause
