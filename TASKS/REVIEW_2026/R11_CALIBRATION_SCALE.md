# R11 — Calibração e escala: ArUco, pedivela, lente, roll da câmara

> **ID:** R11 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R02 · **Bloqueia:** R12 · **Branch:** `feat/r11-calibration` · **PR:** —
> **Referência:** CODE_REVIEW §4.2 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- Hoje `kops_offset` e `saddle_drop` chegam como parâmetros do cliente **sem calibração** (pixels não convertidos em mm no backend).
- Frontend tem protótipos: `services/spatialCalibrator.js`, `LiveCameraCapture/modules/wheelCalibratorHandler.js`.
- `BikeModel.crank_length_mm` existe (referência física conhecida).
- Dependência `opencv-python` (≥ 4.8) inclui `cv2.aruco`.

## 2. Objetivo
Converter pixels → milímetros com **incerteza declarada**, corrigir distorção de lente e inclinação (*roll*) da câmara, avisar quando a câmara não está perpendicular ao plano sagital. Tudo em domínio/serviço Python reutilizável pelo desktop.

## 3. Âmbito
**Cria:** `athletemotion/domain/calibration/{types.py,aruco.py,crank.py,wheel.py,lens.py,roll.py,scale.py}`, `athletemotion/services/calibration_service.py`, `athletemotion/api/v1/calibration.py`, `schemas/calibration.py`, `docs/calibration.md` (inclui PDF imprimível do marcador).
**Altera:** `infrastructure` (tabela `camera_profiles`, migração via R07), `domain/biomechanics/alignment.py` (aceitar mm reais).
**Não mexe:** UI (R16/D08), cálculo de ciclos (R10).

## 4. Subtarefas
- [ ] **1. Tipos:** `ScaleCalibration(mm_per_px, method, uncertainty_mm_per_px, plane_roll_deg, valid_until, source_frame_hash)`, `LensProfile(camera_matrix, dist_coeffs, rms_error_px, resolution)`.
- [ ] **2. ArUco/AprilTag:** detetar marcador de lado conhecido (100 mm por defeito, `DICT_4X4_50`), calcular `mm_per_px` pela média dos 4 lados corrigida de perspetiva, estimar *roll* e *yaw* do plano do marcador (`solvePnP`); exigir marcador > 3 % da largura da imagem e nitidez mínima (variância do Laplaciano). Teste com imagens sintéticas geradas (`cv2.aruco.generateImageMarker`) a várias escalas/rotações.
- [ ] **3. Calibração por pedivela:** a partir de landmarks do pé em 2 fases (3h/9h) com comprimento de pedivela conhecido → `mm_per_px` aproximado (método auxiliar; incerteza maior). Teste sintético com trajetória circular.
- [ ] **4. Calibração por roda:** detetar elipse/círculo da roda (Hough/`fitEllipse` com ROI) com diâmetro externo conhecido (700c ≈ 670-700 mm — tabela por modalidade/pneu configurável) → escala + **razão de aspeto da elipse como medida de yaw** (aviso se > 8°).
- [ ] **5. Lente:** `calibrate_lens(images)` com tabuleiro de xadrez (OpenCV), guardar `camera_profile` (por câmara/resolução); `undistort_points(landmarks, profile)` (aplicar a pontos, não a imagens, para poupar CPU). Teste com distorção sintética conhecida: erro residual < 0.5 px.
- [ ] **6. Roll/perpendicularidade:** `estimate_roll(horizon_or_ground_line | imu_roll_deg)` e `correct_roll(points, roll)`; avisos estruturados `CalibrationWarning(code, severity, message_pt, message_en)` para `|roll|>3°`, `|yaw|>8°`, escala sem marcador, perfil de lente ausente.
- [ ] **7. Serviço + API:** `POST /calibration/scale` (imagem + parâmetros → `ScaleCalibration`), `POST /calibration/lens`, `GET /calibration/profiles`; reutilizar validação de imagem (R05). `alignment.py`: `evaluate_kops_alignment` aceita `offset_mm` calculado pelo serviço (px × mm_per_px) e devolve **incerteza**; manter assinatura antiga.
- [ ] **8. Docs e verificação cruzada:** `docs/calibration.md` com procedimento passo-a-passo (imprimir marcador a 100 % de escala e **medir com régua**), tabela de incertezas esperadas por método e limites de uso. Marcar CODE_REVIEW §4.2 `✅ Resolvido em R11`.

## 5. Critérios de aceitação
- ArUco: erro de escala < 1 % em imagens sintéticas (0–25° de rotação, 3–15 % da largura).
- Todas as medidas em mm vêm com `uncertainty_mm`; sem calibração válida **não** se emitem mm (campo `None` + aviso).
- Lente: reprojeção RMS < 0.5 px em dados sintéticos; perfil persistido e reutilizado.
- Avisos de roll/yaw disparam nos limiares definidos (testes).

## 6. Verificação
```powershell
cd backend
pytest tests/unit/calibration -q; pytest -q
python -m athletemotion.domain.calibration.selftest
```

## 7. Riscos / Fora de âmbito
- Impressão do marcador fora de escala invalida a medida: o procedimento exige medir o lado impresso e introduzir o valor real.
- Estimativa 3D completa / multi-câmara fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa R11 (TASKS/REVIEW_2026/R11_CALIBRATION_SCALE.md) seguindo o Prompt mestre.
Domínio puro (numpy/cv2), testado com marcadores sintéticos. Cada medida em mm leva incerteza; sem calibração válida, não emitir mm. Avisos bilingues estruturados.
```

## 9. Evidências
_(erros de escala, RMS lente, imagens de teste geradas)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
