"""Microbenchmark comparativo do pós-processamento YOLO (Antes vs Depois de R13)."""

import time

import cv2
import numpy as np

from athletemotion.domain.inference.target_selector import DetectionCandidate, TargetSelector


def old_postprocess(raw_preds: np.ndarray, min_conf: float = 0.25):
    """Abordagem antiga: transpõe a matriz completa [56, 8400] -> [8400, 56] e faz argmax ingénuo."""
    preds = raw_preds.transpose((1, 0))  # Transpõe 8400 linhas
    best_index = int(np.argmax(preds[:, 4]))
    best = preds[best_index]
    if float(best[4]) < min_conf:
        return None
    # Converte caixa
    cx, cy, bw, bh = best[:4]
    x1, y1, x2, y2 = cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2
    return best, (x1, y1, x2, y2)


def new_postprocess(raw_preds: np.ndarray, target_selector: TargetSelector, min_conf: float = 0.25):
    """Abordagem R13: filtra por confiança antes da transposição, NMS e TargetSelector."""
    confidences = raw_preds[4, :]
    mask = confidences >= min_conf
    if not np.any(mask):
        return None

    filtered = raw_preds[:, mask].T  # Transpõe apenas K candidatos
    if filtered.shape[0] == 1:
        cx, cy, bw, bh = (float(v) for v in filtered[0, :4])
        box = (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
        candidates = [DetectionCandidate(box=box, confidence=float(filtered[0, 4]), keypoints=filtered[0])]
    else:
        cx = filtered[:, 0]
        cy = filtered[:, 1]
        bw = filtered[:, 2]
        bh = filtered[:, 3]
        x1 = cx - bw / 2.0
        y1 = cy - bh / 2.0
        boxes = np.stack([x1, y1, bw, bh], axis=1).astype(int).tolist()
        scores = filtered[:, 4].tolist()
        indices = cv2.dnn.NMSBoxes(boxes, scores, score_threshold=min_conf, nms_threshold=0.45)
        candidates = []
        if len(indices) > 0:
            indices_flat = np.array(indices).flatten()
            for idx in indices_flat:
                box = (float(x1[idx]), float(y1[idx]), float(x1[idx] + bw[idx]), float(y1[idx] + bh[idx]))
                candidates.append(DetectionCandidate(box=box, confidence=scores[idx], keypoints=filtered[idx]))

    if not candidates:
        return None
    selected = target_selector.select_target(candidates)
    if selected is None:
        return None
    return selected.keypoints, selected.box


def run_benchmark(iterations: int = 2000):
    np.random.seed(42)
    # Simula saída típica do YOLO11-pose: [56, 8400]
    # Maioria das caixas com conf < 0.1, 5 caixas com conf entre 0.6 e 0.95
    simulated_outputs = np.random.uniform(0.01, 0.08, size=(56, 8400)).astype(np.float32)
    # Adiciona 5 candidatos reais
    high_conf_indices = [120, 450, 1800, 3400, 7200]
    for idx, c_idx in enumerate(high_conf_indices):
        simulated_outputs[4, c_idx] = 0.70 + idx * 0.05
        simulated_outputs[0:4, c_idx] = [320 + idx * 10, 240 + idx * 5, 120, 280]

    # Warmup
    selector = TargetSelector()
    for _ in range(50):
        old_postprocess(simulated_outputs)
        new_postprocess(simulated_outputs, selector)

    # Mede abordagem antiga
    t0 = time.perf_counter()
    for _ in range(iterations):
        old_postprocess(simulated_outputs)
    time_old = (time.perf_counter() - t0) * 1000.0  # ms

    # Mede abordagem nova R13
    selector.reset()
    t1 = time.perf_counter()
    for _ in range(iterations):
        new_postprocess(simulated_outputs, selector)
    time_new = (time.perf_counter() - t1) * 1000.0  # ms

    ms_per_op_old = time_old / iterations
    ms_per_op_new = time_new / iterations
    speedup = (ms_per_op_old - ms_per_op_new) / ms_per_op_old * 100.0

    print("=== MICROBENCHMARK PÓS-PROCESSAMENTO YOLO (R13) ===")
    print(f"Iterações: {iterations}")
    print(f"Abordagem Antiga (Transpose [8400, 56] + Argmax): {ms_per_op_old:.4f} ms/frame")
    print(f"Abordagem Nova R13 (Filtro prévio + NMS + TargetSelector): {ms_per_op_new:.4f} ms/frame")
    print(f"Redução de tempo CPU: {speedup:.1f}%")
    return speedup


if __name__ == "__main__":
    run_benchmark()
