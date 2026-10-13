# TAREFA 01: AMBIENTE BACKEND & ACELERAÇÃO AMD DIRECTML

> **Identificador:** `TASK_01_BACKEND_DIRECTML_ENVIRONMENT`  
> **Prioridade:** P0 (Bloqueador de Infraestrutura)  
> **Responsabilidade:** Configurar dependências Python para inferência acelerada em AMD RX 580 8 GB via DirectML e otimizar CPU Intel Xeon E5-1660 v3 (AVX2).

---

## 1. OBJETIVO DA TAREFA
Configurar o ambiente de execução Python para que o backend consiga carregar modelos de Pose Estimation (MediaPipe, YOLOv8/YOLO11 e RTMPose) utilizando **DirectML** através do `onnxruntime-directml`. Isto desbloqueia a aceleração por hardware na GPU **AMD Radeon RX 580 8 GB** em Windows (DirectX 12), mantendo suporte completo de fallback para CPU com aceleração de instruções AVX2.

---

## 2. FICHEIROS A CRIAR / ATUALIZAR

1. `requirements.txt` (Atualização com versões compatíveis)
2. `src/infrastructure/hardware.py` (Módulo de deteção e configuração de hardware)
3. `scripts/verify_directml_hardware.py` (Script de verificação de sanidade operacional)
4. `scripts/download_models.py` (Script para descarregar/exportar os modelos ONNX)

---

## 3. ESPECIFICAÇÃO DE DEPENDÊNCIAS (`requirements.txt`)

O ficheiro `requirements.txt` deve conter rigorosamente:

```txt
# Core Framework & Servidor
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-multipart>=0.0.9
pydantic>=2.7.0
sqlalchemy>=2.0.0
websockets>=12.0

# Processamento Numérico e Imagem
numpy>=1.26.0,<2.0.0
opencv-python>=4.9.0.80
pillow>=10.3.0
scipy>=1.12.0

# Inferência IA & Aceleração DirectML (AMD Radeon RX 580)
onnxruntime-directml>=1.17.0
mediapipe>=0.10.14

# Relatórios & Testes
reportlab>=4.1.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
httpx>=0.27.0
```

> **Nota Técnica Crítica:**  
> `onnxruntime-directml` substitui o pacote genérico `onnxruntime`. Nunca instalar `onnxruntime` e `onnxruntime-directml` em simultâneo no mesmo ambiente virtual, pois causam conflito de namespaces DLL.

---

## 4. DETEÇÃO E CONFIGURAÇÃO DE HARDWARE (`src/infrastructure/hardware.py`)

Cria o ficheiro `src/infrastructure/hardware.py` para abstrair as sessões ONNX e alocação de threads:

```python
"""Módulo de gestão de hardware e otimização para Intel Xeon AVX2 e AMD DirectML."""
from __future__ import annotations

import logging
import os
from typing import Any, List
import onnxruntime as ort

logger = logging.getLogger("athlete_motion.hardware")


class HardwareManager:
    """Gere os provedores de execução e parâmetros de sessão para CPU/GPU."""

    def __init__(self, prefer_gpu: bool = True):
        self.prefer_gpu = prefer_gpu
        self.available_providers = ort.get_available_providers()
        self.has_directml = "DmlExecutionProvider" in self.available_providers
        logger.info("ONNX Runtime Providers disponíveis: %s", self.available_providers)

    def get_execution_providers(self) -> List[Any]:
        """Retorna lista priorizada de execution providers."""
        providers: List[Any] = []
        if self.prefer_gpu and self.has_directml:
            # Device ID 0 corresponde à primeira GPU discreta (AMD RX 580)
            providers.append(("DmlExecutionProvider", {"device_id": 0}))
            logger.info("DirectML ativado na GPU (Device ID 0).")
        
        # Fallback de CPU com instruções AVX2
        providers.append("CPUExecutionProvider")
        return providers

    def create_session_options(self) -> ort.SessionOptions:
        """Configura a sessão ONNX para otimizar o Intel Xeon E5-1660 v3 (8C/16T)."""
        options = ort.SessionOptions()
        
        # Otimização de grafo (Fusions, Constant Folding)
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        # O Xeon E5-1660 v3 possui 8 núcleos físicos e 16 lógicos com suporte AVX2.
        # intra_op_num_threads = 8 garante paralelismo completo por operador sem hiper-thread overhead.
        options.intra_op_num_threads = 8
        options.inter_op_num_threads = 2
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        
        # Desativa telemetria para reduzir latência
        options.enable_profiling = False
        return options


hardware_manager = HardwareManager()
```

---

## 5. SCRIPT DE VALIDAÇÃO DE HARDWARE (`scripts/verify_directml_hardware.py`)

Cria `scripts/verify_directml_hardware.py` para ser executado no terminal e assegurar conformidade do sistema:

```python
"""Script de teste que valida a aceleração DirectML e a geração de tensores."""
import sys
import time
import numpy as np
import onnxruntime as ort
from src.infrastructure.hardware import hardware_manager


def main():
    print("=" * 60)
    print("TESTE DE HARDWARE: INTEL XEON AVX2 + AMD RADEON DIRECTML")
    print("=" * 60)

    providers = hardware_manager.get_execution_providers()
    print(f"Provedores configurados: {providers}")

    if not hardware_manager.has_directml:
        print("[AVISO] 'DmlExecutionProvider' não foi encontrado!")
        print("Certifique-se de que instalou: pip install onnxruntime-directml")
    else:
        print("[SUCESSO] DirectML detetado com sucesso para a GPU AMD!")

    # Criar modelo dummy ONNX em memória para testar execução
    # Matmul: Y = A * B
    import onnx
    from onnx import helper, TensorProto

    X = helper.make_tensor_value_info("X", TensorProto.FLOAT, [1, 640, 640, 3])
    Y = helper.make_tensor_value_info("Y", TensorProto.FLOAT, [1, 640, 640, 3])
    node = helper.make_node("Identity", ["X"], ["Y"])
    graph = helper.make_graph([node], "TestGraph", [X], [Y])
    model = helper.make_model(graph)

    session_opts = hardware_manager.create_session_options()
    try:
        sess = ort.InferenceSession(
            model.SerializeToString(),
            sess_options=session_opts,
            providers=providers,
        )
        dummy_input = np.random.randn(1, 640, 640, 3).astype(np.float32)
        
        # Medir latência
        t0 = time.perf_counter()
        for _ in range(10):
            _ = sess.run(None, {"X": dummy_input})
        elapsed = (time.perf_counter() - t0) / 10 * 1000

        print(f"[OK] Teste de inferência concluído. Latência média: {elapsed:.2f} ms")
        print("Hardware aprovado para execução do pipeline!")
    except Exception as e:
        print(f"[FALHA] Erro na sessão ONNX: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
```

---

## 6. INSTRUÇÕES DE EXECUÇÃO PARA O AGENTE

1. Atualizar o ficheiro `requirements.txt`.
2. Criar `src/infrastructure/hardware.py`.
3. Criar `scripts/verify_directml_hardware.py`.
4. Executar:
   ```bash
   pip install -r requirements.txt
   python scripts/verify_directml_hardware.py
   ```
5. **Critério de Saída:** O script deve imprimir `[SUCESSO] DirectML detetado com sucesso para a GPU AMD!` e terminar com código `0`.
