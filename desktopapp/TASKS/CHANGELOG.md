# CHANGELOG — Desktop App

> **Status:** 🟢 ATIVO · **Última atualização:** 2026-10-13
> **Regra:** toda a alteração ao `desktopapp/` (e a documentos que a descrevem) acrescenta uma linha **no topo**. Ver [protocolo base §3.4](../../TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md).

| 2026-10-13 | Buffy (Codebuff) | D01 | progress | `desktopapp/.venv`, `TASKS/D01_SCAFFOLD_ENV.md`, `TASKS/STATUS_BOARD.md` | Retoma da D01: ambiente reprodutível criado (`uv` + CPython 3.11.17, `uv pip install -e .[dev]`), dependência R01 registada como diferida (backend ausente) e bloqueios ativos documentados no board |
| 2026-10-13 | Antigravity (Gemini) | D01 | progress | `desktopapp/src/*`, `desktopapp/pyproject.toml`, `tests/*` | Criação do esqueleto e estrutura de pastas da app desktop, configurações ACID, MainWindow PyQt6 e testes unitários |
| 2026-10-13 | Antigravity (Gemini) | D17 | deleted | `desktopapp/TASKS/D17_DOCKER_CONTAINER.md` | Remoção do D17 a pedido do utilizador: foco total em bare-metal nativo Windows host para máxima performance (DirectShow/MediaFoundation, DirectML na RX 580, OpenVINO AVX2, zero-copy shared memory) |
| 2026-10-13 | Antigravity (Gemini) | D17 | created | `desktopapp/TASKS/D17_DOCKER_CONTAINER.md` | Criação da tarefa de dockerização para desktop (WSLg/Linux) |
| 2026-10-13 | Antigravity (Claude) | — | created | `desktopapp/TASKS/*` | Criação das tarefas D01–D16 a partir de `README_PLAN.md` |
