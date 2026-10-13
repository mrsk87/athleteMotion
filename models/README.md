# Modelos de análise de pose humana

Os ficheiros nesta pasta **não** são versionados (são grandes). Regeneram-se com os
dois comandos abaixo.

## YOLO11-Pose (ONNX, DirectML) — 640px e 320px

```bash
python scripts/export_yolo_onnx.py --sizes 640 320
```

| Ficheiro | Entrada | Uso |
| --- | --- | --- |
| `yolo11n-pose.onnx` | 640×640 | máxima robustez (motor `yolo11_pose`) |
| `yolo11n-pose-320.onnx` | 320×320 | tempo real (motor `yolo11_pose_fast`) |

O motor lê o tamanho de entrada **do próprio ficheiro ONNX**; não há nenhum
`640` escrito no código. Para experimentar 416px basta exportar com `--sizes 416`.

> Atenção: o Ultralytics tenta instalar `onnxslim` sozinho quando se pede
> `simplify=True`. Essa instalação arrasta o `onnxruntime` normal, que **substitui o
> `onnxruntime-directml` e deixa o DirectML sem funcionar**. O script desliga a
> auto-instalação (`YOLO_AUTOINSTALL=false`) e usa `simplify=False` por omissão.

## MediaPipe Pose Landmarker (Tasks API)

```bash
curl -L -o models/pose_landmarker_lite.task  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
curl -L -o models/pose_landmarker_full.task  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
curl -L -o models/pose_landmarker_heavy.task https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task
```

| Ficheiro | `model_complexity` | Uso |
| --- | --- | --- |
| `pose_landmarker_lite.task` | 0 | mais rápido |
| `pose_landmarker_full.task` | 1 | equilíbrio |
| `pose_landmarker_heavy.task` | 2 | precisão (por omissão) |

Sem ficheiro `.task` o motor `mediapipe` cai para o YOLO e mantém o nome — a lista de
`GET /api/v1/inference/engines` mostra `available: false` quando isso acontece.

## RTMPose (top-down)

`rtmpose-m.onnx` não está incluído. Sem ele o motor `rtmpose` corre o detetor YOLO
por baixo (idem: `available: false` na API).

## Medir

```bash
python scripts/benchmark_inference.py --runs 50 --warmup 5
```
