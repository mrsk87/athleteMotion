"""Subsistema de execução em tempo real (sem dependências de PyQt6).

Este pacote é intencionalmente **vazio**: importar `athletemotion_desktop.runtime`
não deve carregar backends de inferência, `numpy` nem `onnxruntime`. Ferramentas de
diagnóstico (como a sonda de hardware da D02) e código de linha de comandos
importam apenas o submódulo de que precisam, o que mantém o arranque leve e evita
efeitos laterais de importação (protocolo do desktop, §3).
"""
