# Catálogo e Manifesto de Modelos de IA — AthleteMotion

Este diretório contém os pesos e modelos de visão computacional utilizados pelo backend e aplicação desktop do AthleteMotion.

Todos os modelos suportados estão formalmente catalogados em [`manifest.json`](manifest.json) com somas de verificação SHA-256 criptográficas e metadados estruturados.

---

## 1. Verificação de Integridade e Download Automático

Para verificar se todos os modelos locais estão íntegros e correspondem aos hashes oficiais:

```powershell
python scripts/fetch_models.py --verify
```

Para descarregar e verificar automaticamente os modelos em falta:

```powershell
python scripts/fetch_models.py --all
```

Ou para um modelo específico (ex.: RTMPose Halpe26 com pés reais):

```powershell
python scripts/fetch_models.py --model rtmpose-m-halpe26
```

---

## 2. Modelos Catalogados e Licenciamento

| ID | Ficheiro | Framework | Resolução | Keypoints | Licença | Risco de Licença | Uso Recomendado |
|---|---|---|---|---|---|---|---|
| `rtmpose-m-halpe26` | `rtmpose-m.onnx` | ONNX / DirectML | 192×256 | Halpe26 (26 pts com pés reais) | **Apache-2.0** | Não | **Análise de BikeFit de alta precisão (BDC/TDC, pés reais)** |
| `yolo11n-pose-320` | `yolo11n-pose-320.onnx` | ONNX / DirectML | 320×320 | COCO-17 (17 pts) | AGPL-3.0 | **Sim (Copyleft)** | Tempo real ultrarrápido / detetor de apoio |
| `yolo11n-pose` | `yolo11n-pose.onnx` | ONNX / DirectML | 640×640 | COCO-17 (17 pts) | AGPL-3.0 | **Sim (Copyleft)** | Deteção robusta em fotograma inteiro |
| `mediapipe-pose-heavy` | `pose_landmarker_heavy.task` | MediaPipe Tasks | Adaptativo | MediaPipe 33 | **Apache-2.0** | Não | CPU multi-core quando não há GPU |
| `mediapipe-pose-full` | `pose_landmarker_full.task` | MediaPipe Tasks | Adaptativo | MediaPipe 33 | **Apache-2.0** | Não | CPU equilibrado |
| `mediapipe-pose-lite` | `pose_landmarker_lite.task` | MediaPipe Tasks | Adaptativo | MediaPipe 33 | **Apache-2.0** | Não | CPU de baixo consumo |

> [!IMPORTANT]
> **Decisão D1 de Licenciamento (Ultralytics AGPL-3.0):**
> O YOLO11 possui licença copyleft estrita (AGPL-3.0). Para distribuição comercial ou binários fechados, o **RTMPose Halpe26** (licença Apache-2.0 permissiva da OpenMMLab) é o motor recomendado por omissão. O backend assinala o campo `license_risk: true` para todas as variantes YOLO.

---

## 3. Especificação do RTMPose Halpe26

- **Top-Down:** Requer caixa delimitadora do ciclista.
- **Entrada:** `[1, 3, 256, 192]` (Altura=256, Largura=192), normalização `mean=[123.675, 116.28, 103.53]`, `std=[58.395, 57.12, 57.375]`.
- **Saídas SimCC:**
  - `simcc_x`: `[1, 26, 384]` (384 bins = 192 × 2.0).
  - `simcc_y`: `[1, 26, 512]` (512 bins = 256 × 2.0).
- **Pontos do Pé Reais:**
  - `left_big_toe` (20), `right_big_toe` (21)
  - `left_small_toe` (22), `right_small_toe` (23)
  - `left_heel` (24), `right_heel` (25)
  Todos os marcos anatómicos do pé têm `estimated=False`, garantindo medidas clinicamente válidas de dorsiflexão e recuo de cleat.

---

## 4. Procedimento de Exportação Customizada (MMDeploy)

Para re-exportar uma variante do RTMPose para ONNX estático:

```bash
python tools/deploy.py \
    configs/mmpose/pose-detection_simcc_onnxruntime_dynamic.py \
    configs/body_2d_keypoint/rtmpose/body8/rtmpose-m_8xb512-700e_body8-halpe26-256x192.py \
    checkpoints/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192.pth \
    demo/resources/human-pose.jpg \
    --work-dir work_dirs/rtmpose-m-halpe26-onnx \
    --device cpu \
    --dump-info
```

Após exportar, calcular o SHA-256 e atualizar o [`manifest.json`](manifest.json).
