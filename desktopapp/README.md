# Athlete Motion Desktop (PyQt6 + Hardware Acceleration)

Aplicação desktop nativa Windows para análise biomecânica e bikefit em tempo real, concebida para extrair o máximo desempenho do computador físico (AMD Radeon RX 580 DirectML + Intel Xeon E5-1660 v3 AVX2 OpenVINO).

---

## 📁 Estrutura do Subprojeto

```text
desktopapp/
├── AGENTS.md                          # Regras obrigatórias de engenharia e ACID
├── README_PLAN.md                     # Plano de implementação e arquitetura detalhada
├── pyproject.toml                     # Configuração de dependências e empacotamento
├── TASKS/                             # Ficheiros de tarefas para LLMs (D01 a D16)
│   ├── 00_PROTOCOLO_LLM.md            # Protocolo de execução rigoroso
│   ├── STATUS_BOARD.md                # Quadro de tarefas e dependências
│   └── CHANGELOG.md                   # Histórico de alterações do desktop
├── src/athletemotion_desktop/         # Código fonte da aplicação
│   ├── __init__.py
│   ├── __main__.py                    # Ponto de entrada: python -m athletemotion_desktop
│   ├── app.py                         # Instância QApplication, ciclo de vida e crash hook
│   ├── config/                        # Caminhos (%APPDATA%) e definições Pydantic
│   │   ├── paths.py
│   │   └── settings.py
│   ├── runtime/                       # MOTOR DE TEMPO REAL (SEM DEPENDÊNCIAS DE QT)
│   │   ├── backends/                  # Drivers de inferência (DirectML, OpenVINO, CPU)
│   │   ├── models/                    # Model zoo e manifest SHA-256
│   │   ├── capture.py                 # Captura de vídeo/câmara DirectShow
│   │   ├── preprocess.py              # Letterbox e preparação de tensores
│   │   ├── inference_worker.py        # Processo desacoplado de inferência
│   │   ├── ring_buffer.py             # Memória partilhada (multiprocessing.shared_memory)
│   │   └── metrics.py                 # Telemetria e latências por estágio
│   ├── domain_bridge/                 # Ponte para o pacote puro athletemotion.domain
│   ├── services/                      # Orquestração de sessões locais e persistência ACID
│   └── ui/                            # Camada de apresentação PyQt6
│       ├── main_window.py             # Janela principal e barra lateral
│       ├── views/                     # Vistas: Live, Vídeo, Relatório, Benchmark, Definições
│       ├── widgets/                   # Widgets: VideoCanvas (OpenGL), HUD, Gráficos
│       ├── viewmodels/                # Estado reativo e sinais da UI
│       └── theme/                     # Folha de estilos Dark QSS e recursos visuais
├── tests/                             # Testes unitários, integração e UI
│   ├── unit/
│   ├── integration/
│   ├── ui/
│   └── perf/
└── scripts/                           # Scripts de automação e benchmark
    └── dev_setup.ps1                  # Configuração do ambiente de desenvolvimento
```

---

## 🚀 Como Executar

### 1. Configurar Ambiente de Desenvolvimento
```powershell
# A partir da raiz do repositório
cd desktopapp
.\scripts\dev_setup.ps1
```

### 2. Iniciar a Aplicação
```powershell
python -m athletemotion_desktop
```

---

## 📌 Regras de Contribuição para LLMs
Antes de iniciar qualquer tarefa em `desktopapp/TASKS/`:
1. Consulta obrigatoriamente [AGENTS.md](AGENTS.md) e [TASKS/00_PROTOCOLO_LLM.md](TASKS/00_PROTOCOLO_LLM.md).
2. O módulo `runtime/` **nunca deve importar PyQt6 / QtCore**.
3. Toda a mutação de base de dados SQLite deve respeitar estritamente as propriedades **ACID**.
4. A thread principal da UI **nunca deve bloquear** (> 8 ms).
