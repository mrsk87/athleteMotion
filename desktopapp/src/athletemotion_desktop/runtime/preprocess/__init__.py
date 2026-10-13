"""Pré-processamento de frames para os modelos de inferência (sem Qt).

Peças:

- ``roi``: recortes seguros e o mapeamento de coordenadas modelo ↔ frame.
- ``letterbox``: composição para a entrada fixa do modelo, em canvas pré-alocada.
- ``blob``: conversão para tensor NCHW float32, escrevendo no buffer de destino.
- ``pipeline``: composição das três, com buffers reutilizados (sem alocação por frame).

**Sem re-exportações**, pela mesma razão do resto do `runtime/`: importar o pacote não
deve carregar `cv2`/`numpy` nem ter efeitos laterais. Cada consumidor importa o módulo
concreto de que precisa.
"""
