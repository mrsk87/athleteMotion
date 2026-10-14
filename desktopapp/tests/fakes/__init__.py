"""Dobres de teste determinísticos e reutilizáveis (D14 §2).

Regra deste pacote: um dobre **não substitui** o código real por conveniência — substitui
o *mundo exterior* que o código não pode controlar nos testes. Câmara que mente sobre a
resolução, driver que aceita escritas e devolve zero, backend que demora 30 ms ou rebenta
a meio de uma passagem de inferência: são esses os casos que a suíte precisa de reproduzir
à vontade e sem hardware.

Módulos:

- :mod:`tests.fakes.fake_camera` — dispositivos, fontes de captura e relógio controlado.
- :mod:`tests.fakes.fake_backend` — motor de inferência com latência e falhas injetáveis.
- :mod:`tests.fakes.fake_pipeline` — pipeline de resultados para testes de UI (provisório,
  alinhado com a D05 quando ela definir o contrato real).
- :mod:`tests.fakes.synthetic` — geradores determinísticos (vídeo, poses, séries).
"""
