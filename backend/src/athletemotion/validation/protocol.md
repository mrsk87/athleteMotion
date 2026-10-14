# Protocolo de Validação Científica e Clínica do Athlete Motion

> **Documento:** PROTOCOL-VAL-2026-V1  
> **Versão:** 1.0.0 (Data: Outubro 2026)  
> **Objetivo:** Estabelecer o protocolo experimental e os critérios estatísticos rigorosos para aferição da exatidão e repetibilidade dos motores de visão computacional (YOLO, RTMPose, MediaPipe) face a sistemas de referência de verdade-terreno (goniómetro de precisão e captura de movimento ótica 3D).

---

## 1. Desenho do Estudo

### 1.1 Amostra e Participantes
- **Dimensão da amostra:** Mínimo de $n = 15$ ciclistas (amadores, entusiastas e profissionais).
- **Critérios de inclusão:**
  - Idade entre 18 e 65 anos.
  - Praticantes regulares de ciclismo de estrada, BTT ou triatlo.
  - Ausência de lesões musculoesqueléticas agudas impeditivas nos últimos 3 meses.
- **Ética e Privacidade:**
  - Consentimento informado prévio e explícito assinado em conformidade com o RGPD (Artigo 9.º — tratamento de dados biométricos).
  - Minimização de dados: gravação exclusivamente de landmarks articulares e ângulos; descarte imediato ou ofuscação facial nas imagens brutas.

### 1.2 Sistemas de Referência (Verdade-Terreno)
1. **Padrão Ouro Primário:** Sistema de Captura de Movimento Ótica 3D (Vicon ou Qualisys com $\ge 6$ câmaras a 120–240 FPS) calibrado com erro residual 3D $< 0.5\text{ mm}$, ou marcadores retro-refletores ativos e passivos fixados em pontos anatómicos ósseos de referência (grande trocânter, côndilo femoral lateral, maléolo lateral, cabeça do 5.º metatarso).
2. **Padrão Ouro Secundário (Estático / Campo):** Goniómetro digital clínico calibrado (resolução $0.1^\circ$, exatidão $\pm 0.5^\circ$) e marcadores fiduciais ArUco `DICT_4X4_50` de alta precisão fixados com fita cirúrgica nas proeminências anatómicas.

---

## 2. Condições de Ensaio

### 2.1 Ensaio Estático (Ângulos Fixos Controlados)
- Posicionamento do atleta e rig de calibração em 5 ângulos anatómicos fixos controlados:
  - Flexão/Extensão do Joelho: $30^\circ$, $60^\circ$, $90^\circ$, $120^\circ$, $150^\circ$.
  - Ângulo de Tronco/Dorso: $30^\circ$, $40^\circ$, $50^\circ$, $60^\circ$.
- Duração de captura: 5 segundos por posição a 60 FPS (300 fotogramas por condição).

### 2.2 Ensaio Dinâmico (Pedalada em Cicloergómetro)
- Protocolo de esforço submáximo em turbo-trainer/rolo de treino com bicicleta do atleta:
  - Cadências: 60 RPM, 80 RPM, 100 RPM.
  - Cargas de potência: 100 W, 200 W, 300 W.
- Duração: 2 minutos por patamar (mínimo de 120 ciclos completos de pedalada analisados por condição).
- Iluminação controlada: $\ge 400\text{ lux}$ sem contraluz direta. Distância da câmara de 2.5 a 3.5 m no plano sagital (eixo ótico perpendicular ao plano de pedalada).

---

## 3. Critérios de Aceitação Estatística

Para homologação clínica e biomecânica do software, os motores devem cumprir os seguintes limiares calculados face à verdade-terreno:

| Métrica | Critério de Aceitação | Justificação Clínica |
|---|---|---|
| **MAE (Erro Médio Absoluto)** | $\le 3.0^\circ$ | Limiar estrito de significância biomecânica no ajuste do selim |
| **RMSE (Raiz do Erro Quadrático Médio)** | $\le 4.0^\circ$ | Penaliza desvios pontuais e instabilidades de rastreio |
| **Viés Médio (Bias / Systematic Error)** | $|\text{Viés}| \le 1.5^\circ$ | Inexistência de desvio sistemático do zero anatómico |
| **95% Limites de Concordância (Bland-Altman LoA)** | $\le \pm 5.0^\circ$ | Intervalo de concordância clínica aceitável (Holmes 1994, Bini 2011) |
| **Coeficiente de Correlação de Pearson ($r$)** | $r \ge 0.95$ | Fidelidade e linearidade cinemática ao longo de todo o ciclo |
| **Amostras com Erro $\le 3^\circ$** | $\ge 85\%$ | Confiabilidade na grande maioria dos fotogramas capturados |

---

## 4. Formato de Dados e Reprodutibilidade

Os conjuntos de dados de validação são organizados da seguinte forma:
- Ficheiros comprimidos NumPy `.npz` ou tabelas `.csv` padronizadas contendo as colunas:
  - `frame_index`: índice sequencial do fotograma.
  - `time_sec`: timestamp em segundos.
  - `joint_id`: identificador da articulação (`knee`, `hip`, `ankle`, `elbow`, `shoulder`).
  - `ground_truth_deg`: ângulo de referência medido pelo goniómetro/Vicon.
  - `predicted_deg`: ângulo estimado pelo modelo do Athlete Motion.
  - `confidence`: score de confiança estimado pelo motor (0.0 a 1.0).

---

## 5. Ferramenta de Execução Automática

A avaliação automática é realizada via linha de comandos:
```powershell
python -m athletemotion.validation.runner --dataset tests/data/synthetic_validation --engines yolo11_pose_fast,rtmpose
```
Produzindo matriz de métricas, gráficos de Bland-Altman e relatório detalhado de conformidade.
