# Athlete Motion Backend

Serviço backend FastAPI e biblioteca de domínio biomecânico para análise postural e BikeFit.

## Instalação e Execução

### Ambiente de Desenvolvimento
```bash
uv venv --python 3.11
uv pip install -e ".[dev,directml]"
```

### Executar Servidor
```bash
python -m athletemotion.api
```

### Executar Testes
```bash
pytest -q
```

## Estrutura
- `src/athletemotion/api/`: Aplicação FastAPI, rotas REST e endpoints WebSocket.
- `src/athletemotion/domain/`: Cálculos biomecânicos puros e motores de inferência.
  - `biomechanics/angles.py`: Ângulos calculados no espaço métrico em píxeis (imune a distorções de aspect ratio).
  - `inference/foot_estimation.py`: Síntese de calcâneo e biqueira (Winter 2009) escalada pela tíbia.
  - `inference/stabilizer.py`: Estabilizador funcional imutável de segmentos anatómicos rígidos.
- `src/athletemotion/infrastructure/`: Base de dados SQLite (WAL + ACID) e gestão de hardware.
- `src/athletemotion/schemas/`: Modelos de validação Pydantic.
- `src/athletemotion/services/`: Serviços de aplicação e relatórios.
- `models/`: Modelos neurais ONNX e pesos.
- `tests/`: Suites de testes unitários e de integração.

## Contrato de Inferência Postural (WebSocket / REST)
Os marcos anatómicos (`InferenceOutput.landmarks`) contêm a flag `estimated: bool`:
- `estimated: false` — Marco detetado e medido diretamente pelo modelo de IA.
- `estimated: true` — Marco estimado heuristicamente (ex.: calcâneo/biqueira em modelos COCO-17 sem pés) ou interpolado por oclusão/salto espúrio pelo estabilizador de segmentos rígidos. Permite que a interface gráfica sinalize visualmente a incerteza métrica ao operador.
