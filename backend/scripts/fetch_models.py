"""Utilitário CLI para descarregar, descompactar e verificar a integridade de modelos de IA."""

from __future__ import annotations

import argparse
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

# Adiciona backend/src ao path se necessário
ROOT_DIR = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from athletemotion.config.paths import MODELS_DIR
from athletemotion.domain.inference.model_zoo import (
    load_manifest,
    verify_file_integrity,
    verify_model,
)


def download_with_progress(url: str) -> bytes:
    """Descarrega um ficheiro via HTTP/HTTPS exibindo progresso em bytes."""
    req = urllib.request.Request(url, headers={"User-Agent": "AthleteMotion-Fetch/1.0"})  # noqa: S310
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        total_size = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        chunks = []
        block_size = 1024 * 1024  # 1MB
        while True:
            chunk = resp.read(block_size)
            if not chunk:
                break
            chunks.append(chunk)
            downloaded += len(chunk)
            if total_size > 0:
                pct = (downloaded / total_size) * 100
                mb_down = downloaded / (1024 * 1024)
                mb_tot = total_size / (1024 * 1024)
                sys.stdout.write(f"\r  Progresso: {mb_down:.1f}/{mb_tot:.1f} MB ({pct:.1f}%)")
            else:
                mb_down = downloaded / (1024 * 1024)
                sys.stdout.write(f"\r  Descarregados: {mb_down:.1f} MB")
            sys.stdout.flush()
        sys.stdout.write("\n")
        return b"".join(chunks)


def fetch_model(model_id: str, force: bool = False) -> bool:
    """Descarrega e instala um modelo específico do manifesto."""
    manifest = load_manifest()
    meta = manifest.get(model_id)
    if not meta:
        print(f"[-] Modelo '{model_id}' não existe no manifesto.")
        return False

    dest_file = MODELS_DIR / meta.filename
    if dest_file.exists() and not force:
        valid, _hash_val, _ = verify_file_integrity(dest_file, meta.sha256, meta.size_bytes)
        if valid:
            print(f"[OK] Modelo '{model_id}' já instalado e verificado: {dest_file}")
            return True
        print(f"[!] Ficheiro existente '{meta.filename}' tem hash diferente. A recarregar...")

    if not meta.urls:
        print(f"[-] Modelo '{model_id}' não possui URLs de descarga no manifesto.")
        return False

    download_url = meta.urls[0]
    print(f"[*] A descarregar '{model_id}' de {download_url}...")
    try:
        content = download_with_progress(download_url)
    except Exception as err:
        print(f"[-] Falha na descarga de {download_url}: {err}")
        return False

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    if meta.archive_type == "zip":
        print(f"[*] A extrair ficheiro '{meta.filename}' do arquivo zip...")
        pattern = meta.archive_member_pattern or meta.filename
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                matching_members = [m for m in zf.namelist() if m.endswith(pattern)]
                if not matching_members:
                    print(f"[-] Padrão '{pattern}' não encontrado dentro do zip.")
                    return False
                member_name = matching_members[0]
                extracted_bytes = zf.read(member_name)
                dest_file.write_bytes(extracted_bytes)
        except Exception as err:
            print(f"[-] Erro ao processar arquivo zip: {err}")
            return False
    else:
        dest_file.write_bytes(content)

    # Verificar hash final gravado
    valid, actual_hash, actual_size = verify_file_integrity(
        dest_file, meta.sha256, meta.size_bytes
    )
    if not valid:
        print(
            f"[-] Falha de verificação SHA-256 após descarga! Esperado: {meta.sha256}, Obtido: {actual_hash}"
        )
        return False

    print(
        f"[OK] Modelo '{model_id}' gravado e validado com sucesso ({actual_size} bytes, sha256={actual_hash[:16]}...)."
    )
    return True


def run_verification() -> bool:
    """Verifica todos os modelos registados no manifesto e apresenta uma tabela resumo."""
    manifest = load_manifest()
    print("=== VERIFICAÇÃO DE MODELOS DO MANIFESTO (AthleteMotion) ===")
    print(f"{'ID':<22} | {'Ficheiro':<24} | {'Status':<12} | {'Licença':<10} | {'Detalhes'}")
    print("-" * 90)

    all_ok = True
    for m_id, meta in manifest.items():
        is_valid, reason = verify_model(m_id)
        status_str = "OK" if is_valid else "FALHA/AUSENTE"
        if not is_valid:
            all_ok = False
        lic_str = f"{meta.license} {'(!)' if meta.license_risk else ''}"
        print(f"{m_id:<22} | {meta.filename:<24} | {status_str:<12} | {lic_str:<10} | {reason}")

    print("-" * 90)
    return all_ok


def main() -> None:
    parser = argparse.ArgumentParser(
        description="AthleteMotion Model Zoo Fetcher & Verification Tool"
    )
    parser.add_argument("--verify", action="store_true", help="Verifica integridade dos modelos")
    parser.add_argument("--model", type=str, help="ID do modelo específico a descarregar")
    parser.add_argument("--all", action="store_true", help="Descarrega todos os modelos em falta")
    parser.add_argument("--force", action="store_true", help="Força nova descarga mesmo se existir")

    args = parser.parse_args()

    if args.verify:
        success = run_verification()
        sys.exit(0 if success else 1)

    if args.model:
        ok = fetch_model(args.model, force=args.force)
        sys.exit(0 if ok else 1)

    if args.all:
        manifest = load_manifest()
        success = True
        for m_id, meta in manifest.items():
            target_path = MODELS_DIR / meta.filename
            if (not target_path.exists() or args.force) and meta.urls:
                ok = fetch_model(m_id, force=args.force)
                if not ok:
                    success = False
        run_verification()
        sys.exit(0 if success else 1)

    # Por defeito, corre verificação
    run_verification()


if __name__ == "__main__":
    main()
