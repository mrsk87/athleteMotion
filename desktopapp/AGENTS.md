# Regras de Engenharia do Módulo Desktop (desktopapp/AGENTS.md)

Este documento define as diretrizes obrigatórias para o subprojeto `desktopapp/`. Herda integralmente os padrões de **Senior Core Developer** definidos em [../AGENTS.md](../AGENTS.md).

---

## 1. Postura de Engenharia e Princípios ACID no Desktop

1. **Separação Rígida de Camadas:**
   - `desktopapp/ui/`: Apenas componentes PyQt6, layouts, widgets e QOpenGLWidget. **Zero computação biomecânica.**
   - `desktopapp/runtime/`: Processos de captura, ring buffer (`multiprocessing.shared_memory`), watchdog e execução de modelos. **Proibido importar PyQt6 / QtCore em runtime.**
   - `athletemotion/` (backend importado): Toda a matemática de ângulos, BDC/TDC, validações e relatórios clínicos reside no pacote partilhado.
2. **Atomicidade e Integridade ACID Local:**
   - Base de dados local SQLite gerida com transações atómicas explícitas (`with db_session():`).
   - Gravação de ficheiros de vídeo, capturas ou exportações de relatórios sempre via ficheiros temporários (`.tmp`) seguidos de substituição atómica (`os.replace`).
   - SQLite em modo WAL (`PRAGMA journal_mode = WAL;`) e `PRAGMA foreign_keys = ON;`.
3. **Isolamento de Concorrência:**
   - Comunicação entre processos via semáforos atómicos e padrão *latest-frame-wins* (double-buffering) para garantir que leitores e escritores não colidem.
4. **Durabilidade e Encerramento Seguro:**
   - Interceção obrigatória de eventos de fecho (`QCloseEvent`) para libertar leases de memória partilhada, parar processos filhos e fazer flush de dados não persistidos.

---

## 2. Legibilidade e Código Amigável para Juniores e Mids

1. **Nomes Expressivos:** Funções e sinais PyQt com nomes evidentes (ex.: `on_frame_processed_signal`, `calculate_crank_angle_deg`).
2. **Funções Curtas e Focadas:** Decomposição de métodos de UI e algoritmos numéricos em passos sequenciais e fáceis de inspecionar no debugger.
3. **Tipagem Estrita:** Uso exaustivo de `typing` e `NDArray` para evitar ambiguidades com arrays OpenCV ou tensores.
4. **Sem Exceções Silenciosas:** Qualquer falha na câmara, no modelo ONNX ou no pipeline gráfico deve ser registada no logger estruturado e refletida num estado claro de erro na UI.
5. **Idioma:** Comentários e docstrings explicativos em Português (PT-PT); código em Inglês.

---

## 3. Desempenho Bare-Metal Windows

1. **Thread Principal de UI Sagrada:** A UI corre a 60 FPS e nunca executa I/O de disco, captura de câmara ou inferência ONNX síncrona.
2. **Aceleração Direta:** DirectML nativo na AMD Radeon RX 580 e OpenVINO AVX2 nativo no Intel Xeon E5-1660 v3.
