"""Interface de linha de comando (CLI) operacional para Athlete Motion."""

from __future__ import annotations

import argparse
import sys

from athletemotion.services.retention import purge_expired_data


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="athlete-motion",
        description="Ferramentas operacionais de manutenção e conformidade de Athlete Motion",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcomando 'purge'
    purge_parser = subparsers.add_parser(
        "purge",
        help="Executa a purga de retenção de dados expirados e soft-deletes pendentes",
    )
    purge_parser.add_argument(
        "--retention-months",
        type=int,
        default=24,
        help="Período máximo de conservação de sessões em meses (padrão: 24)",
    )

    # Subcomando 'autotune'
    autotune_parser = subparsers.add_parser(
        "autotune",
        help="Executa a calibração automática de hardware e gera o perfil de inferência ótimo",
    )
    autotune_parser.add_argument(
        "--force",
        action="store_true",
        help="Força re-execução do autotune mesmo que exista perfil em cache",
    )
    autotune_parser.add_argument(
        "--frames",
        type=int,
        default=40,
        help="Número de fotogramas por modelo/backend no autotune (padrão: 40)",
    )

    args = parser.parse_args()

    if args.command == "purge":
        print(f"Iniciando purga de dados expirados (retenção: {args.retention_months} meses)...")
        results = purge_expired_data(retention_months=args.retention_months)
        print(
            f"Purga concluída com sucesso: {results['purged_athletes']} atletas e "
            f"{results['purged_sessions']} sessões expurgadas."
        )
        sys.exit(0)

    elif args.command == "autotune":
        from athletemotion.infrastructure.autotune import run_autotune

        print("Iniciando calibração automática de hardware (autotune)...")
        profile = run_autotune(force=args.force, max_frames=args.frames)
        hw = profile["hardware"]
        print("=" * 60)
        print("HARDWARE DETETADO:")
        print(f"  CPU: {hw['cpu_name']} ({hw['physical_cores']}C/{hw['logical_cores']}T)")
        print(f"  GPU / DirectML: {hw['gpu_name']} (DirectML={hw['has_directml']})")
        print(f"  Runtimes: ORT={hw['ort_version']}, OpenVINO={hw['openvino_version']}")
        print("=" * 60)
        print("PERFIS RECOMENDADOS:")
        for name, p in profile["profiles"].items():
            print(f"  [{name.upper()}]: Modelo={p['model']} | Backend={p['backend']} | p95={p['expected_p95_ms']}ms | FPS={p['expected_fps']}")
        print("=" * 60)
        sys.exit(0)


if __name__ == "__main__":
    main()
