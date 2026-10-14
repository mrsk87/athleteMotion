"""Módulo de gestão de hardware e otimização para Intel Xeon AVX2 e AMD DirectML.

O objetivo deste módulo é retirar da sessão ONNX todos os custos que NÃO são
inferência: memória pré-alocada, threads a mais, primeira passagem do grafo.
Tudo o que aqui se decide é medido por `scripts/benchmark_inference.py`.

Regras que não são opinião, estão documentadas pelo ONNX Runtime:
- DirectML exige `enable_mem_pattern = False` e `ORT_SEQUENTIAL`; chamadas
  concorrentes ao mesmo `Run()` não são suportadas (por isso uma sessão por motor).
- A primeira inferência de DirectML compila/otimiza o grafo — tem de ser
  descartada do tempo sentido pelo utilizador (ver `warmup_session`).
- `intra_op_num_threads` só afecta trabalho em CPU; mais threads do que núcleos
  físicos aumenta a latência por contenda.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np
import onnxruntime as ort

logger = logging.getLogger("athlete_motion.hardware")


def _detect_physical_cores(logical_cores: int) -> int:
    """Núcleos FÍSICOS (sem hiper-thread).

    Só a contagem lógica está sempre disponível em Python puro; quando não há
    melhor informação assume-se 1 físico por 2 lógicos.
    """
    try:
        import psutil  # opcional

        detected = psutil.cpu_count(logical=False)
        if detected:
            return int(detected)
    except (ImportError, Exception):
        pass
    return max(1, logical_cores // 2)


class HardwareManager:
    """Gere os provedores de execução e parâmetros de sessão para CPU/GPU."""

    def __init__(self, prefer_gpu: bool = True):
        self.prefer_gpu = prefer_gpu
        self.available_providers = ort.get_available_providers()
        self.has_directml = "DmlExecutionProvider" in self.available_providers
        self.logical_cores = os.cpu_count() or 4
        self.physical_cores = _detect_physical_cores(self.logical_cores)
        # Real-time: paralelismo por operador nos núcleos físicos, fila de nós a 1
        # (um único fluxo sobre os dados evita a espera entre operadores).
        self.intra_op_threads = self.physical_cores
        self.inter_op_threads = 1
        logger.info("ONNX Runtime Providers disponíveis: %s", self.available_providers)
        logger.info(
            "CPU: %d núcleos físicos / %d lógicos → intra_op=%d, inter_op=%d",
            self.physical_cores,
            self.logical_cores,
            self.intra_op_threads,
            self.inter_op_threads,
        )

    # ------------------------------------------------------------------ providers
    def get_execution_providers(
        self,
        gpu: bool | None = None,
        device_id: int = 0,
        disable_metacommands: bool = False,
    ) -> list[Any]:
        """Lista priorizada de execution providers.

        `device_id` escolhe o adaptador DirectML (0 = GPU principal). Nos adaptadores
        integrados DirectML pode ser mais rápido, mas só se mede — por omissão 0.
        """
        use_gpu = self.prefer_gpu if gpu is None else bool(gpu)
        providers: list[Any] = []

        if use_gpu and self.has_directml:
            options: dict[str, Any] = {"device_id": int(device_id)}
            if disable_metacommands:
                options["disable_metacommands"] = "true"
            providers.append(("DmlExecutionProvider", options))
            logger.info("DirectML ativado na GPU (device_id=%d).", device_id)

        # Fallback de CPU com instruções AVX2
        providers.append("CPUExecutionProvider")
        return providers

    # ------------------------------------------------------------ session options
    def create_session_options(self, gpu: bool | None = None) -> ort.SessionOptions:
        """Sessão afinada para latência mínima por fotograma.

        `gpu` decide as opções que o DirectML exige (mem_pattern off). Sem argumento,
        segue a preferência global do gestor.
        """
        use_gpu = self.prefer_gpu if gpu is None else bool(gpu)
        use_gpu = use_gpu and self.has_directml

        options = ort.SessionOptions()

        # Fusões e constant folding: o DirectML tem o seu próprio caminho de fusão e
        # o nível ALL não interfere — medido sem regressão.
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        if use_gpu:
            # Requisito documentado do DirectML: sem memory pattern.
            options.enable_mem_pattern = False

        # Um único fluxo sobre os dados: menos latência, e obrigatório para DirectML.
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.intra_op_num_threads = self.intra_op_threads
        options.inter_op_num_threads = self.inter_op_threads
        options.enable_profiling = False

        # Sem "spinning": as threads não ficam a rodar à espera do próximo operador,
        # o que reduz o pico de latência entre fotogramas (p95).
        try:
            options.add_session_config_entry("session.intra_op.allow_spinning", "0")
            options.add_session_config_entry("session.inter_op.allow_spinning", "0")
        except Exception:  # pragma: no cover - só depende da versão de ORT
            pass

        return options

    # ------------------------------------------------------------------- warmup
    def warmup_session(
        self,
        session: ort.InferenceSession,
        runs: int = 1,
        input_name: str | None = None,
    ) -> float:
        """Executa inferência a zeros para pagar o custo de arranque UMA vez.

        Devolve o tempo do primeiro `run` em milissegundos (o que o utilizador
        deixaria de sentir no primeiro fotograma real).
        """
        import time

        try:
            inputs = session.get_inputs()
            if not inputs:
                return 0.0
            target = input_name or inputs[0].name
            shape = [dim if isinstance(dim, int) and dim > 0 else 1 for dim in inputs[0].shape]
            dummy = np.zeros(shape, dtype=np.float32)

            start = time.perf_counter()
            for _ in range(max(1, runs)):
                session.run(None, {target: dummy})
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            logger.info(
                "Aquecimento de %s: %.1f ms (descartado do tempo de regime estável).",
                session.get_modelmeta().description or "sessão ONNX",
                elapsed_ms,
            )
            return elapsed_ms
        except Exception as err:  # pragma: no cover - aquecimento é best-effort
            logger.warning("Aquecimento falhou (inofensivo): %s", err)
            return 0.0


hardware_manager = HardwareManager()
