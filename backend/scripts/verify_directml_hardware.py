"""Script de teste que valida a aceleração DirectML e a geração de tensores."""
from __future__ import annotations

from pathlib import Path
import sys

# Garantir que a raiz do projeto está no sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

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
    from onnx import helper, TensorProto

    X = helper.make_tensor_value_info("X", TensorProto.FLOAT, [1, 640, 640, 3])
    Y = helper.make_tensor_value_info("Y", TensorProto.FLOAT, [1, 640, 640, 3])
    node = helper.make_node("Identity", ["X"], ["Y"])
    graph = helper.make_graph([node], "TestGraph", [X], [Y])
    opset = helper.make_opsetid("", 17)
    model = helper.make_model(graph, opset_imports=[opset], ir_version=9)

    session_opts = hardware_manager.create_session_options()
    try:
        sess = ort.InferenceSession(
            model.SerializeToString(),
            sess_options=session_opts,
            providers=providers,
        )
        dummy_input = np.random.randn(1, 640, 640, 3).astype(np.float32)

        # Aquecimento (warmup)
        for _ in range(3):
            _ = sess.run(None, {"X": dummy_input})

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
