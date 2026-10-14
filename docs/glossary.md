# Glossário Técnico e Biomecânico — Athlete Motion

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`

Este documento define os termos biomecânicos, anatómicos e computacionais utilizados no ecossistema do **Athlete Motion**.

---

## 1. Terminologia Biomecânica e de BikeFit

### BDC (Bottom Dead Center / Ponto Morto Inferior)
Posição do ciclo de pedalada onde a perna atinge a máxima extensão funcional. Nas bicicletas modernas, devido à inclinação do tubo do selim ($73^\circ$–$75^\circ$), o BDC fisiológico ocorre tipicamente às **5:30h** (cerca de $15^\circ$ a $20^\circ$ antes da vertical geométrica absoluta das 6:00h). O ângulo de joelho ideal situa-se entre $145^\circ$ e $155^\circ$ (Holmes 1994, Pruitt 2006).

### TDC (Top Dead Center / Ponto Morto Superior)
Posição mais alta da pedivela ao longo do ciclo (12:00h). Utilizada para avaliar a flexão máxima da anca e do joelho e o risco de impacto fémoro-acetabular.

### KOPS (Knee Over Pedal Spindle)
Regra biomecânica de alinhamento longitudinal do selim. Às 3:00h da rotação (com os crenques na horizontal para a frente), mede-se o desfasamento horizontal entre a face anterior da patela (ou tuberosidade anterior da tíbia) e o centro do eixo do pedal. Alinhamento neutro considerado satisfatório: $0 \pm 5\text{ mm}$.

### Saddle Drop (Desnível Selim-Guiador)
Diferença de altura vertical entre o ponto médio do selim e o topo do guiador (avanço). Valores mais agressivos ($> 8\text{ cm}$) favorecem aerodinâmica, exigindo maior flexibilidade da cadeia posterior.

### Queda Pélvica Lateral (Pelvic / Hip Drop)
Ângulo de báscula da linha dos trocânteres/cristas ilíacas no plano frontal durante a fase descendente da pedalada. Valores $> 2.5^\circ$ indicam instabilidade pélvica, selim excessivamente alto ou fraqueza de estabilizadores glúteos.

### Oscilação Lateral do Tronco (Lateral Trunk Sway)
Desvio horizontal máximo em milímetros da cabeça ou do esterno no plano frontal ao longo do ciclo. Valores elevados revelam compensação por falta de apoio no selim.

### Dynamic Knee Tracking (Trajetória Dinâmica do Joelho)
Desvio médio do joelho relativamente ao plano sagital mecânico que une a anca ao tornozelo. Desvios mediais indicam colapso em valgo (tendência para tendinopatia da pata de ganso); desvios laterais indicam alinhamento em varo.

### SI (Symmetry Index / Índice de Simetria Bilateral)
Equação padronizada: $\text{SI} = \frac{2 \cdot |X_{\text{esq}} - X_{\text{dir}}|}{X_{\text{esq}} + X_{\text{dir}}} \times 100\%$. Valores $\le 10\%$ são considerados dentro da assimetria fisiológica natural.

### Cavalo (Inseam)
Distância do solo à virilha/ísquios medida com o ciclista descalço. Utilizado na fórmula teórica de LeMond ($\text{Altura Selim} = \text{Cavalo} \times 0.883$).

---

## 2. Terminologia Computacional e de Visão Artificial

### DirectML
API de baixo nível da Microsoft baseada em DirectX 12 que permite executar tensores de redes neuronais com aceleração de hardware GPU em qualquer placa gráfica compatível com DX12 (especialmente AMD Radeon e Intel Arc), sem depender de frameworks proprietários como CUDA.

### OpenVINO
Toolkit da Intel concebido para otimização e inferência de redes neuronais em processadores Intel com suporte a extensões de instruções vetoriais (AVX2, AVX-512).

### SimCC (Simple Coordinate Classification)
Abordagem moderna de pose estimation que trata a regressão de coordenadas $x, y$ como uma classificação em eixos contínuos 1D independentes com sub-pixel accuracy, eliminando o custo de mapas de calor 2D pesados e alcançando maior precisão angular.

### Halpe26
Topologia padronizada de anotação corporal com 26 *keypoints*, cobrindo a totalidade dos pontos anatómicos do COCO-17 mais calcanhares bilaterais e múltiplos dedos dos pés, permitindo cálculo cinemático real de tornozelo.

### Limites de Concordância de Bland-Altman (95% LoA)
Metodologia estatística para avaliar a concordância clínica entre dois métodos de medição contínua (ex.: estimativa computacional vs goniómetro clínico). Os limites a 95% são dados por $\bar{d} \pm 1.96 \cdot s_d$.

### Filtro One-Euro
Filtro passa-baixo adaptativo de 1.ª ordem para sinais temporais com frequência de corte dinâmica que minimiza o *jitter* em velocidades baixas e elimina o atraso de fase (*lag*) em movimentos rápidos.

### Filtro de Kalman Cinemático 2D
Filtro recursivo de estimação de estado com modelo físico de velocidade constante e restrições geométricas de rigidez óssea (comprimento anatómico de fémur e tíbia invariantes com tolerância de $\pm 8\%$).

### ACID (Atomicidade, Consistência, Isolamento e Durabilidade)
Conjunto de propriedades transacionais que garantem a fiabilidade das gravações na base de dados SQLite mesmo sob encerramento abrupto do sistema operacional ou falha de alimentação.

### WAL (Write-Ahead Logging)
Modo de registo transacional no SQLite onde as alterações são anexadas a um ficheiro de registo separado (`.db-wal`), permitindo leituras concorrentes em paralelo com gravações sem bloqueios (*zero concurrency contention*).
