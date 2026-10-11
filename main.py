"""Athlete Motion - Ponto de Entrada Principal e Utilitário de Linha de Comando (CLI).

Fornece comandos ergonómicos para iniciar o servidor backend, executar testes,
verificar a integridade do sistema e gerir versões SemVer.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
VERSION_FILE = ROOT_DIR / "VERSION"


def get_version() -> str:
    if VERSION_FILE.exists():
        return VERSION_FILE.read_text(encoding="utf-8").strip()
    return "0.2.0"


def print_banner() -> None:
    version = get_version()
    print("=" * 68)
    print(f"ATHLETE MOTION - Analise Biomecanica de Postura Ciclistica v{version}")
    print("   Lingua-Mae: Portugues (PT) | Clean Architecture & Persistencia ACID")
    print("=" * 68)


def cmd_server(args: argparse.Namespace) -> None:
    """Inicia o servidor backend FastAPI."""
    print(f"[Iniciando] Servidor FastAPI na porta {args.port} (Host: {args.host})...")
    import uvicorn
    uvicorn.run("server:app", host=args.host, port=args.port, reload=args.reload)


def cmd_test(args: argparse.Namespace) -> None:
    """Executa a suite completa de testes automatizados com pytest."""
    print("[Executando] Suite de testes unitários e de integração (Pytest)...")
    cmd = [sys.executable, "-m", "pytest", "tests/"]
    if args.verbose:
        cmd.append("-v")
    res = subprocess.run(cmd, cwd=ROOT_DIR)
    sys.exit(res.returncode)


def cmd_check(args: argparse.Namespace) -> None:
    """Verifica a integridade operacional do ambiente, banco de dados e testes."""
    print("[Verificando] Integridade do sistema Athlete Motion...")
    print(f" - Versão SemVer: v{get_version()}")
    print(f" - Diretório do Projeto: {ROOT_DIR}")
    
    # 1. Testar importação e banco de dados
    try:
        from src.infrastructure.database import init_db, DATABASE_PATH
        init_db()
        print(f" - Base de dados SQLite (WAL): OK ({DATABASE_PATH.name})")
    except Exception as e:
        print(f" - [ERRO] Base de dados: {e}")
        sys.exit(1)

    # 2. Executar testes rápidos
    print(" - Executando testes unitários rápidos...")
    res = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q"], cwd=ROOT_DIR)
    if res.returncode == 0:
        print(" - Todos os testes unitarios e de integracao passaram com 100% de sucesso! [OK]")
    else:
        print(" - [AVISO] Alguns testes falharam. [FALHA]")
        sys.exit(res.returncode)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Athlete Motion - CLI de Gestão e Inicialização",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Comandos disponíveis")

    # Comando: server
    p_server = subparsers.add_parser("server", help="Inicia o servidor backend FastAPI")
    p_server.add_argument("--host", default="0.0.0.0", help="Endereço de rede (Padrão: 0.0.0.0)")
    p_server.add_argument("--port", type=int, default=8000, help="Porta TCP (Padrão: 8000)")
    p_server.add_argument("--reload", action="store_true", default=True, help="Ativa hot-reload para desenvolvimento")
    p_server.set_defaults(func=cmd_server)

    # Comando: test
    p_test = subparsers.add_parser("test", help="Executa testes automatizados com Pytest")
    p_test.add_argument("-v", "--verbose", action="store_true", help="Saída detalhada")
    p_test.set_defaults(func=cmd_test)

    # Comando: check
    p_check = subparsers.add_parser("check", help="Verifica integridade do banco de dados e testes")
    p_check.set_defaults(func=cmd_check)

    args = parser.parse_args()
    print_banner()

    if not args.command:
        parser.print_help()
        print("\nExemplo de uso:")
        print("  python main.py server   # Iniciar API FastAPI")
        print("  python main.py test     # Executar suite de testes")
        print("  python main.py check    # Verificar integridade geral")
        return

    args.func(args)


if __name__ == "__main__":
    main()