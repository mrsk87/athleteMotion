"""Captura de frames (câmara USB e ficheiros de vídeo), sem Qt.

Peças:

- ``frame``: o `Frame` imutável (píxeis só-leitura + instante de captura), contrato único
  entre a captura, o pré-processamento e a inferência.
- ``base``: o protocolo `CaptureSource`, os estados, e a base com thread dedicada que
  implementa *latest-frame-wins*, descarte contado, medição de FPS efetivo e reconexão.
- ``camera``: `CameraSource` (DirectShow/Media Foundation, MJPG, buffer do driver = 1).
- ``file_source``: `FileSource` (PTS, `seek`, `step` exato, velocidade e loop A-B).
- ``controls``: controlos de câmara (exposição, ganho, foco) com verificação de suporte e
  presets gravados atomicamente.
- ``devices``: enumeração de câmaras com nomes legíveis e deteção de *hot-plug*.

**Sem re-exportações**, pela mesma razão do resto do `runtime/`: importar o pacote não deve
carregar `cv2` nem ter efeitos laterais. Cada consumidor importa o módulo concreto.
"""
