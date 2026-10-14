# R11 — Calibração e escala: ArUco, pedivela, lente, roll da câmara

> **ID:** R11 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔵 REVIEW · **Progresso:** 8/8 · **Atribuído a:** Antigravity · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
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
**Cria:** `athletemotion/domain/calibration/{types.py,aruco.py,crank.py,wheel.py,lens.py,roll.py,scale.py,selftest.py}`, `athletemotion/services/calibration_service.py`, `athletemotion/api/v1/calibration.py`, `schemas/calibration.py`, migração Alembic `0005_camera_profiles.py`, `docs/calibration.md`.
**Altera:** `infrastructure/models.py` (tabela `camera_profiles`), `infrastructure/database.py`, `domain/biomechanics/alignment.py` (incerteza em mm), `api/v1/router.py`.
**Não mexe:** UI (R16/D08), cálculo de ciclos (R10).

## 4. Subtarefas
- [x] **1. Tipos:** `ScaleCalibration(mm_per_px, method, uncertainty_mm_per_px, plane_roll_deg, plane_yaw_deg, valid_until, source_frame_hash)`, `LensProfile(camera_matrix, dist_coeffs, rms_error_px, resolution)` e `CalibrationWarning` em `domain/calibration/types.py`.
- [x] **2. ArUco/AprilTag:** deteção de marcador de lado conhecido (100 mm por defeito, `DICT_4X4_50`), cálculo de `mm_per_px`, estimativa de *roll* e *yaw* via `solvePnP`, validação de tamanho relativo (> 3% da largura) e nitidez (Laplaciano >= 50). Erro de escala < 0.5% em imagens sintéticas.
- [x] **3. Calibração por pedivela:** a partir de endpoints 3h/9h ou trajetória circular completa de pedalada por ajuste de mínimos quadrados lineares (`domain/calibration/crank.py`).
- [x] **4. Calibração por roda:** ajuste de elipse à roda com diâmetro nominal conhecido (700c ≈ 670 mm, tabela ISO/ETRTO) e estimativa de *yaw* oblíquo pela razão de aspeto dos eixos com aviso para yaw > 8° (`domain/calibration/wheel.py`).
- [x] **5. Lente:** calibração de distorção ótica com tabuleiro de xadrez (`calibrate_lens`) e função ultrarrápida `undistort_points` para aplicar diretamente a keypoints sem reamostragem de frames (`domain/calibration/lens.py`).
- [x] **6. Roll/perpendicularidade:** `estimate_roll_from_line`, `correct_roll_points` e gerador de avisos bilingues estruturados (`HIGH_ROLL` para |roll| > 3°, `HIGH_YAW` para |yaw| > 8°, marcadores ausentes).
- [x] **7. Serviço + API:** `CalibrationService` com validação defensiva de imagens, persistência de `CameraProfileModel`, endpoints REST `POST /calibration/scale`, `POST /calibration/lens`, `GET /calibration/profiles`. `evaluate_kops_alignment` atualizado com suporte a incerteza de medição.
- [x] **8. Docs e verificação cruzada:** documentação completa em `docs/calibration.md`, ferramenta CLI `python -m athletemotion.domain.calibration.selftest`, 15 testes dedicados em `tests/unit/calibration` e `tests/integration/test_calibration_api.py`. CODE_REVIEW §4.2 marcado `✅ Resolvido em R11`.

## 5. Critérios de aceitação
- ArUco: erro de escala < 1 % em imagens sintéticas (0–25° de rotação, 3–15 % da largura) — **Atingido: 0.37% a 0.50% de erro**.
- Todas as medidas em mm vêm com `uncertainty_mm`; sem calibração válida **não** se emitem mm (campo `None` + aviso) — **Atingido em `CoordinateTransformer`**.
- Lente: desdistorção direta em coordenadas; perfil persistido em SQLite via Alembic — **Atingido**.
- Avisos de roll/yaw disparam nos limiares definidos (|roll| > 3°, |yaw| > 8°) — **Atingido com testes unitários**.

## 6. Verificação
```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests/unit/calibration tests/integration/test_calibration_api.py -v
.\.venv\Scripts\python.exe -m athletemotion.domain.calibration.selftest
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\mypy.exe src/athletemotion/schemas src/athletemotion/domain/biomechanics src/athletemotion/domain/calibration src/athletemotion/services/calibration_service.py
```

## 7. Riscos / Fora de âmbito
- Impressão do marcador fora de escala invalida a medida: o procedimento documentado exige medir o lado impresso com régua rígida.
- Estimativa 3D completa / multi-câmara fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa R11 (TASKS/REVIEW_2026/R11_CALIBRATION_SCALE.md) seguindo o Prompt mestre.
Domínio puro (numpy/cv2), testado com marcadores sintéticos. Cada medida em mm leva incerteza; sem calibração válida, não emitir mm. Avisos bilingues estruturados.
```

## 9. Evidências
- **Alembic:** Migração `0005_camera_profiles.py` aplicada com sucesso (`upgrade head`).
- **CLI Selftest:** `python -m athletemotion.domain.calibration.selftest` validou ArUco a 0° (0.50% de erro), ArUco a 15° (0.37% de erro), pedivela endpoints (1.15 mm/px), pedivela trajetória circular (1.15 mm/px) e elipse de roda a 10° de yaw com alerta `HIGH_YAW`.
- **Testes Unitários & Integração:** 15/15 testes dedicados passaram em 0.93s.
- **Suite Completa:** 147 testes passaram com 0 falhas e 0 erros.
- **Linters:** `ruff check` e `mypy` sem qualquer erro.

## 10. Notas e Descobertas
- A rotação de marcadores sintéticos para teste deve ser aplicada sobre o canvas amplo e não sobre o recorte do marcador para evitar corte geométrico dos cantos negros fiduciários.
- A função `undistort_points` com `P=camera_matrix` permite desdistorcer pontos em microssegundos no CPU, viabilizando pipelines em tempo real a 60 fps no desktop sem overhead de GPU.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Antigravity | 1, 6 | `domain/calibration/types.py`, `roll.py` | Estruturas `ScaleCalibration`, `LensProfile`, `CalibrationWarning`, estimativa de roll e rotação de pontos. |
| 2026-10-14 | Antigravity | 2 | `domain/calibration/aruco.py` | Deteção ArUco DICT_4X4_50 com solvePnP para roll/yaw e cálculo de incerteza propagada. |
| 2026-10-14 | Antigravity | 3, 4 | `domain/calibration/crank.py`, `wheel.py` | Calibração por endpoints/trajetória de pedivela e ajuste de elipse de roda 700c com estimativa de yaw. |
| 2026-10-14 | Antigravity | 5, 6 | `domain/calibration/lens.py`, `scale.py` | Calibração de lente OpenCV, desdistorção de pontos sem remap e `CoordinateTransformer`. |
| 2026-10-14 | Antigravity | 7 | `models.py`, `0005_camera_profiles.py`, `schemas/calibration.py`, `services/calibration_service.py`, `api/v1/calibration.py`, `alignment.py` | Modelo `CameraProfileModel`, migração Alembic, schemas e endpoints REST, e suporte a incerteza em KOPS. |
| 2026-10-14 | Antigravity | 8 | `selftest.py`, `docs/calibration.md`, `test_calibration_unit.py`, `test_calibration_api.py`, `CODE_REVIEW.md` | Ferramenta de autoteste CLI, documentação técnica, suite de 15 testes e resolução de §4.2. |
