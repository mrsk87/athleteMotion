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
- `src/athletemotion/infrastructure/`: Base de dados SQLite (WAL + ACID) e gestão de hardware.
- `src/athletemotion/schemas/`: Modelos de validação Pydantic.
- `src/athletemotion/services/`: Serviços de aplicação e relatórios.
- `models/`: Modelos neurais ONNX e pesos.
- `tests/`: Suites de testes unitários e de integração.
