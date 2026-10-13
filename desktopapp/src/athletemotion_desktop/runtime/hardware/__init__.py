"""Sondagem de hardware, perfil de autotune e execução do benchmark (sem Qt).

Este pacote é seguro para correr fora da interface gráfica e por CLI:
`python -m athletemotion_desktop.runtime.hardware.probe --json`.

**Porquê sem re-exportações:** importar o pacote não pode ter efeitos laterais
(ex.: adaptadores de inferência ou código pesado) — cada consumidor importa o
módulo concreto de que precisa. Evita-se, assim, que `python -m
athletemotion_desktop.runtime.hardware.probe` dispare avisos do `runpy` por o
módulo já estar carregado pelo `__init__`.
"""
