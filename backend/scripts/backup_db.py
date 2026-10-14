"""Script de backup atómico e seguro da base de dados SQLite em modo WAL (ACID).

Utiliza a API de backup nativa do SQLite (sqlite3.Connection.backup), permitindo
realizar cópias de segurança consistentes mesmo enquanto a aplicação está em execução
e a efetuar gravações ativas.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Adicionar src ao sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from athletemotion.infrastructure.backup import perform_db_backup


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backup atómico e online da base de dados AthleteMotion."
    )
    parser.add_argument(
        "--dest", "-d", type=str, default=None, help="Caminho do ficheiro de destino do backup"
    )
    args = parser.parse_args()

    dest = Path(args.dest) if args.dest else None
    result_path = perform_db_backup(dest)
    print(f"Backup concluído com sucesso em: {result_path}")


if __name__ == "__main__":
    main()
