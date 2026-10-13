"""Anel SPSC de frames em memória partilhada (sem Qt).

Peças:

- ``layout``: geometria do segmento (cabeçalho + registos por slot) e o seu protocolo.
- ``shm_ring``: :class:`~athletemotion_desktop.runtime.ring_buffer.shm_ring.ShmRing`,
  o produtor/consumidor de um único escritor e um único leitor.
- ``errors``: exceções de domínio tipadas (layout, posse, estado, frame rasgado).

**Sem re-exportações**, pela mesma razão do resto do `runtime/`: importar o pacote não
deve carregar `numpy` nem ter efeitos laterais. Cada consumidor importa o módulo concreto
de que precisa.
"""
