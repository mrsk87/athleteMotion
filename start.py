"""Orquestrador de inicializacao unificada para Athlete Motion (Backend + Frontend).

Inicia o backend FastAPI e o frontend Vue simultaneamente com um unico comando:
    python start.py

Abre o navegador automaticamente em http://localhost:8081 e encerra ambos os servicos de forma graciosa ao pressionar Ctrl+C.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
import webbrowser

# Garante compatibilidade de encoding no terminal Windows (CMD/PowerShell)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend", "mediapipe")


def free_port(port: int) -> None:
    """Liberta a porta se houver algum processo orfao anterior a escuta-la."""
    try:
        if sys.platform == "win32":
            cmd = (
                f'powershell -Command "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue '
                f'| Select-Object -ExpandProperty OwningProcess"'
            )
            output = subprocess.check_output(cmd, shell=True, text=True).strip()
            if output:
                for line in output.splitlines():
                    pid_str = line.strip()
                    if pid_str and pid_str.isdigit() and int(pid_str) != os.getpid():
                        print(f"[*] A libertar porta {port} (a terminar processo anterior PID {pid_str})...")
                        subprocess.run(f"taskkill /F /PID {pid_str}", shell=True, capture_output=True)
                        time.sleep(1)
    except Exception:
        pass


def wait_for_url(url: str, timeout: float = 25.0) -> bool:
    """Aguarda ate que o servico HTTP esteja acessivel."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AthleteMotionLauncher"})
            with urllib.request.urlopen(req, timeout=1.0) as res:
                if res.status in (200, 304, 404):
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> None:
    print("=" * 65)
    print("       >>> INICIANDO ATHLETE MOTION (BikeFit AI System) <<<")
    print("=" * 65)
    print()

    # Garantir que as portas 8000 e 8081 estao desimpedidas
    free_port(8000)
    free_port(8081)

    # 1. Iniciar Backend (FastAPI na porta 8000)
    print("[*] [1/2] A iniciar Backend API (FastAPI na porta 8000)...")
    backend_proc = subprocess.Popen(
        [sys.executable, "server.py"],
        cwd=ROOT_DIR,
    )

    # 2. Iniciar Frontend (Vue 3 CLI na porta 8081, conforme vue.config.js)
    print("[*] [2/2] A iniciar Frontend (Vue 3 na porta 8081)...")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_proc = subprocess.Popen(
        [npm_cmd, "run", "serve"],
        cwd=FRONTEND_DIR,
    )

    print()
    print("=" * 65)
    print("[+] Servicos em execucao:")
    print("   -> Frontend (Interface Web):   http://localhost:8081")
    print("   -> Backend API (Documentacao): http://localhost:8000/docs")
    print("   -> Integridade da API:         http://localhost:8000/health")
    print("=" * 65)
    print("[!] Pressione [Ctrl + C] para encerrar todos os servicos.")
    print("[*] A aguardar compilacao do frontend antes de abrir o navegador...")
    print()

    # Aguardar ate que o frontend esteja ativo em http://localhost:8081
    if wait_for_url("http://localhost:8081", timeout=30.0):
        print("[+] Frontend pronto! A abrir http://localhost:8081 no navegador...")
        try:
            webbrowser.open("http://localhost:8081")
        except Exception:
            pass
    else:
        try:
            webbrowser.open("http://localhost:8081")
        except Exception:
            pass

    try:
        while True:
            b_poll = backend_proc.poll()
            f_poll = frontend_proc.poll()
            if b_poll is not None:
                print(f"\n[!] Backend encerrou com codigo {b_poll}")
                break
            if f_poll is not None:
                print(f"\n[!] Frontend encerrou com codigo {f_poll}")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[!] A encerrar todos os servicos...")
    finally:
        for proc, name in [(backend_proc, "Backend"), (frontend_proc, "Frontend")]:
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=3)
                except Exception:
                    proc.kill()
        print("[+] Todos os servicos encerrados com sucesso.")


if __name__ == "__main__":
    main()
