"""Instalador de Git Hooks para o repositório Athlete Motion.

Configura o hook 'pre-push' para garantir conformidade de versão e opcionalmente
autoincrementar o SemVer antes do envio para o repositório remoto.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GIT_HOOKS_DIR = ROOT / ".git" / "hooks"
PRE_PUSH_HOOK = GIT_HOOKS_DIR / "pre-push"

HOOK_CONTENT = """#!/bin/sh
# Hook de pré-push do Athlete Motion para validação e autoincremento SemVer
echo "[Git Hook] Verificando integridade e versionamento do Athlete Motion..."

# Verificar se o Python está disponível
if ! command -v python >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
    echo "[Git Hook - Aviso] Python não encontrado. Ignorando verificação automática de versão."
    exit 0
fi

PYTHON_CMD="python"
if ! command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python3"
fi

# Verificar sincronização entre VERSION e package.json
$PYTHON_CMD -c "
import json
from pathlib import Path
root = Path('.').resolve()
v_file = (root / 'backend' / 'VERSION').read_text(encoding='utf-8').strip()
p_json = json.loads((root / 'frontend' / 'web' / 'package.json').read_text(encoding='utf-8'))
if v_file != p_json.get('version'):
    print(f'[Git Hook - ERRO] Inconsistência de versão! VERSION ({v_file}) != package.json ({p_json.get(\"version\")})')
    print('Execute: python backend/scripts/bump_version.py [patch|minor|major]')
    exit(1)
print(f'[Git Hook] Versão SemVer sincronizada: v{v_file}')
"

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo "[Git Hook] Push cancelado devido a erro de versão."
    exit 1
fi

echo "[Git Hook] Verificação concluída com sucesso. Prosseguindo com o push."
exit 0
"""


def install_hooks() -> None:
    if not (ROOT / ".git").exists():
        print(f"[Erro] Diretório .git não encontrado em {ROOT}. O repositório foi clonado?")
        return

    GIT_HOOKS_DIR.mkdir(parents=True, exist_ok=True)
    PRE_PUSH_HOOK.write_text(HOOK_CONTENT, encoding="utf-8")

    # Tornar executável (Linux / macOS / Git Bash)
    try:
        current_stat = os.stat(PRE_PUSH_HOOK)
        os.chmod(PRE_PUSH_HOOK, current_stat.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    except Exception:
        pass

    print(f"[Sucesso] Git hook 'pre-push' instalado em: {PRE_PUSH_HOOK}")
    print("Agora qualquer push efetuado validará a sincronização da versão SemVer.")


if __name__ == "__main__":
    install_hooks()

