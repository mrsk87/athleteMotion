# Arquitetura Global do Sistema — Athlete Motion

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`
> **Referência:** R01, R03, R07, R08, R10, R11, R12, R14, R16, R17 · **Protocolo:** [00_PROTOCOLO_LLM.md](../TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md)

---

## 1. Visão Geral e Princípios Arquiteturais

O **Athlete Motion** é uma plataforma profissional de análise biomecânica e BikeFit computacional em tempo real. A sua arquitetura segue os princípios estritos de engenharia estabelecidos em `AGENTS.md`:

1. **Separação Rígida de Responsabilidades (SoC):**
   - **Domínio Puro (`athletemotion.domain`):** Isento de dependências de frameworks (sem FastAPI, sem SQLAlchemy, sem PyQt6). Implementa a física de ângulos, cinemática de ciclos (BDC/TDC), calibração métrica espacial e métricas ergonómicas.
   - **Infraestrutura (`athletemotion.infrastructure`):** Conecta o domínio ao hardware e persistência (backends DirectML/OpenVINO, base de dados SQLite WAL com Alembic, métricas Prometheus e autotune).
   - **Serviços de Aplicação (`athletemotion.services`):** Orquestra sessões transacionais, pipeline de relatórios PDF auditáveis, conformidade RGPD e pareceres determinísticos do AI Coach.
   - **Camada de Apresentação (`athletemotion.api` & `frontend/` & `desktopapp/`):** Clientes Web Vue 3 / Pinia e Desktop PyQt6 atuam exclusivamente como cascas finas de apresentação e recolha de entrada.
2. **Propriedades ACID e Integridade:** Todas as mutações de dados na base de dados SQLite ocorrem sob transações atómicas com Write-Ahead Logging (WAL) e integridade referencial ativa.
3. **Desempenho Bare-Metal e Zero Placebos:** Aproveitamento nativo do hardware do host Windows (aceleração DirectML na AMD Radeon RX 580 e OpenVINO AVX2 no Intel Xeon E5-1660 v3). Nenhum número ou diagnóstico clínico é falsificado ou aproximado quando faltam dados confiáveis.

---

## 2. Diagrama de Arquitetura em Camadas

```mermaid
flowchart TD
    subgraph Presentation["Camada de Apresentação"]
        WebUI["Frontend Web (Vue 3 + Pinia + ECharts)"]
        DesktopUI["Desktop App (PyQt6)"]
    end

    subgraph API["Camada de Interface HTTP & WebSocket"]
        FastAPIApp["FastAPI Server (127.0.0.1:8000)"]
        AuthMiddleware["Security & Auth Middleware (Bearer Token)"]
        WSHandler["WebSocket (/ws/live-inference)"]
        RESTSessions["REST API (/api/v1/sessions)"]
        RESTCalibration["REST API (/api/v1/calibration)"]
        RESTInference["REST API (/api/v1/inference)"]
    end

    subgraph Services["Serviços de Aplicação & Orquestração"]
        SessionSvc["SessionService (Máquina de Estados ACID)"]
        ReportBld["ReportBuilder (Diagnósticos DRY)"]
        PDFReporting["ReportingService (PDF v2 + Charts Agg)"]
        PrivacySvc["PrivacyService (RGPD Art. 17/20 & Cifra)"]
        CoachSvc["AICoachService (Regras Puras & i18n)"]
    end

    subgraph PureDomain["Domínio Puro (Biomecânica & IA)"]
        Biometrics["domain/biomechanics (Ângulos, KOPS, Drop)"]
        Measures["domain/measures (Sagital, Frontal, Fadiga, Kalman)"]
        Cycles["domain/cycle (Detetor BDC/TDC, Cadência)"]
        Calibration["domain/calibration (ArUco, Pedivela, Roda, Lente)"]
        Inference["domain/inference (Pipeline, Filtros One-Euro, SimCC)"]
    end

    subgraph Infra["Infraestrutura & Hardware Bare-Metal"]
        HWManager["HardwareManager & BackendRegistry"]
        DirectMLBackend["OrtDirectMLBackend (AMD Radeon RX 580)"]
        OpenVINOBackend["OpenVinoCPUBackend (Intel Xeon AVX2)"]
        SQLiteDB["SQLite (WAL Mode, Alembic Migrations)"]
        MetricsReg["MetricsRegistry (/metrics Prometheus)"]
    end

    WebUI <-->|HTTP REST / WS| FastAPIApp
    DesktopUI <-->|Local Binding / HTTP| FastAPIApp
    FastAPIApp --> AuthMiddleware
    AuthMiddleware --> WSHandler & RESTSessions & RESTCalibration & RESTInference
    WSHandler --> Inference
    RESTSessions --> SessionSvc
    SessionSvc --> ReportBld & SQLiteDB
    ReportBld --> Measures & Biometrics
    RESTCalibration --> Calibration
    RESTInference --> HWManager
    Inference --> HWManager
    HWManager --> DirectMLBackend & OpenVINOBackend
    SessionSvc --> PrivacySvc & PDFReporting
    PDFReporting --> PureDomain
```

---

## 3. Pipeline de Inferência em Tempo Real e WebSocket

A comunicação de vídeo para inferência biomecânica em tempo real utiliza um protocolo binário otimizado sobre WebSocket com filas atómicas desacopladas (*latest-frame-wins*):

```mermaid
sequenceDiagram
    autonumber
    participant UI as Cliente Web / Desktop
    participant WS as WebSocket Consumer
    participant Queue as Atomic Single-Slot Queue
    participant Worker as Staged Pipeline Worker
    participant Engine as Backend (DirectML / OpenVINO)
    participant Domain as Biomechanical Domain

    UI->>WS: Envia pacote binário [4B Timestamp Big-Endian][JPEG Payload]
    WS->>Queue: Insere fotograma mais recente (descarta anterior se ocupada)
    Worker->>Queue: Extrai fotograma disponível
    Worker->>Worker: Descodificação cv2 e pré-processamento SIMD blobFromImage
    Worker->>Engine: Inferência de Redes Neuronais (YOLO11 / RTMPose)
    Engine-->>Worker: Mapas de calor / Coordenadas contínuas SimCC
    Worker->>Worker: Pós-processamento vetorizado NumPy (Bounding Box + Keypoints)
    Worker->>Domain: Deteção de ciclo BDC/TDC, Filtro de Kalman & Ângulos
    Domain-->>Worker: Ângulos apurados, incerteza e conformidade ergonómica
    Worker->>UI: Envia JSON de telemetria [angles, is_bdc, clock_position, latency_ms]
```

---

## 4. Estratégia de Backends e Aceleração de Hardware

O subsistema de aceleração de hardware desacopla totalmente a rede neuronal do runtime de inferência através do protocolo `InferenceBackend`:

```mermaid
classDiagram
    class InferenceBackend {
        <<Protocol>>
        +load(model_path: Path) void
        +warmup() void
        +infer(input_tensor: ndarray) ndarray
        +close() void
        +info() BackendInfo
    }

    class OrtDirectMLBackend {
        -session: InferenceSession
        -device_id: int
        -use_io_binding: bool
        +infer(input_tensor) ndarray
    }

    class OpenVinoCPUBackend {
        -core: Core
        -compiled_model: CompiledModel
        -infer_request: InferRequest
        +infer(input_tensor) ndarray
    }

    class OrtCPUBackend {
        -session: InferenceSession
        -intra_threads: int
        +infer(input_tensor) ndarray
    }

    class BackendRegistry {
        +create(backend_name: str) InferenceBackend
        +get_preferred_backend() str
        +list_available() list[BackendInfo]
    }

    InferenceBackend <|.. OrtDirectMLBackend
    InferenceBackend <|.. OpenVinoCPUBackend
    InferenceBackend <|.. OrtCPUBackend
    BackendRegistry ..> InferenceBackend : Instancia
```

### Decisões Operacionais de Hardware:
1. **Primary GPU (DirectML):** AMD Radeon RX 580 (Polaris 20, 8 GB VRAM) processa `yolo11n-pose-320` em **4.12 ms** (241 FPS) e `rtmpose-m` em **8.20 ms** (119 FPS).
2. **CPU Fallback (OpenVINO):** Intel Xeon E5-1660 v3 utiliza OpenVINO 2026.4.1 com instruções AVX2 e `PERFORMANCE_HINT=LATENCY`, atingindo **12.04 ms** com `rtmpose-m`.
3. **Rejeição Técnica de Quantização INT8:** Em Haswell-E (sem suporte de hardware para VNNI), o INT8 emulado é 2.2× mais lento que FP32 (`VFMADD213PS`). O sistema opera estritamente em **FP32 nativo**.

---

## 5. Modelo Relacional e Conformidade com Privacidade (RGPD)

```mermaid
erDiagram
    ATHLETES {
        string id PK "UUIDv4"
        string name "Nome completo"
        string email UK "Endereço eletrónico"
        float height_cm "Altura total (cm)"
        float inseam_cm "Comprimento do cavalo (cm)"
        string flexibility "low | medium | high"
        datetime consent_at "Registo temporal de consentimento"
        string consent_version "Versão dos termos RGPD (v1.0)"
        string consent_scope "Escopos autorizados"
        datetime deleted_at "Soft-delete"
        datetime retention_until "Limite legal de retenção"
    }

    BIKES {
        string id PK "UUIDv4"
        string athlete_id FK "Chave estrangeira ATHLETES"
        string bike_type "road | mtb | tt | gravel"
        string brand_model "Marca e modelo"
        float current_saddle_height_cm "Altura do selim (cm)"
        float crank_length_mm "Comprimento da pedivela (mm)"
    }

    FIT_SESSIONS {
        string id PK "UUIDv4"
        string athlete_id FK "Chave estrangeira ATHLETES"
        string bike_id FK "Chave estrangeira BIKES"
        string status "IN_PROGRESS | COMPLETED | CANCELLED"
        boolean store_landmarks "Autorização para gravação bruta"
        float theoretical_saddle_height_cm "Altura teórica LeMond"
        float measured_avg_knee_angle "Ângulo médio apurado"
        text summary_json "Resumo de ciclos e telemetria"
        datetime started_at "Início da sessão"
        datetime completed_at "Conclusão idempotente"
    }

    POSTURE_SNAPSHOTS {
        string id PK "UUIDv4"
        string session_id FK "Chave estrangeira FIT_SESSIONS"
        integer frame_index "Índice do fotograma"
        datetime timestamp "Carimbo temporal UTC"
        float knee_angle "Ângulo do joelho (°)"
        float back_angle "Ângulo do tronco (°)"
        float arm_angle "Ângulo do braço (°)"
        float ankle_angle "Ângulo do tornozelo (°)"
        boolean is_compliant "Conformidade ergonómica"
        text raw_landmarks_json "Cifrado com Fernet AES-128-CBC"
    }

    ATHLETES ||--o{ BIKES : "possui"
    ATHLETES ||--o{ FIT_SESSIONS : "realiza"
    BIKES ||--o{ FIT_SESSIONS : "utilizada em"
    FIT_SESSIONS ||--o{ POSTURE_SNAPSHOTS : "contém"
```

---

## 6. Rastreabilidade Científica e Relatório PDF Auditável

O relatório técnico oficial em PDF (`athletemotion.services.reporting.pdf`) é gerado deterministicamente e contém:
- **Badge de Proveniência:** App version, Git SHA do commit, hash SHA-256 dos pesos do modelo, backend de execução e contagem de ciclos analisados.
- **Incerteza Propagada:** Toda a métrica exibe o valor médio $\pm$ incerteza combinada (ex.: $148.5^\circ \pm 1.2^\circ$) e score percentual de confiança.
- **Portão de Medidas Retidas (*Withheld*):** Quando a confiança do tracking é inferior a $0.60$ ou falta calibração espacial física, a medição é suprimida do diagnóstico com explicação clara do motivo clínico.
- **Visualizações Biomecânicas:** Curvas de revolução normalizadas (0–100%) com intervalo de $\pm 1\text{ DP}$ e distribuição de BDC geradas via Matplotlib sem estado global (`FigureCanvasAgg`).
