# Medidas Biomecânicas, Qualidade de Captura e Vista Frontal (R12)

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`
> **Módulo:** `athletemotion.domain.measures` · **Referência:** R12

---

## 1. Visão Geral e Princípios Clínicos

O subsistema de medição do **AthleteMotion** opera exclusivamente sobre o domínio puro (`athletemotion.domain.measures`), desacoplado de qualquer framework Web (FastAPI) ou interface gráfica.
Cada medição biomecânica expõe obrigatoriamente:
- **`value`**: Valor numérico medido ou `None` se retido por incerteza.
- **`unit`**: Unidade anatómica ou física (`°`, `mm`, `cm`, `RPM`, `%`).
- **`confidence`**: Grau de fiabilidade composto no intervalo $[0.0, 1.0]$.
- **`uncertainty`**: Incerteza expandida ($\pm \sigma$) quando aplicável.
- **`source`**: Origem da amostra (`cycle_detection`, `manual_snapshot`, `calibration`, `derived`).
- **`withheld`**: Flag booleana estrita (`True` se a medida for suprimida por violar o portão de qualidade).
- **`withhold_reason`**: Justificação contextual transparente em caso de retenção.

---

## 2. Portão de Qualidade (*Quality Gating*)

O sistema implementa a regra inviolável de **tolerância zero para dados falsificados ou espúrios**:
$$\text{Score} = w_v \cdot V + w_c \cdot C + w_p \cdot P + w_{\text{cal}} \cdot \text{Cal} + w_{\text{agr}} \cdot \text{Agr}$$

Onde:
- $V \in [0, 1]$: Visibilidade média dos marcos articulares.
- $C \in [0, 1]$: Rotações de pedalada válidas acumuladas (normalizado face à meta de 5 ciclos).
- $P \in [0, 1]$: Periodicidade espetral da cadência (autocorrelação e FFT).
- $\text{Cal} \in [0, 1]$: Qualidade da calibração métrica espacial (R11).
- $\text{Agr} \in [0, 1]$: Concordância geométrica entre motores de inferência.

### Regra de Gating:
Se $\text{Score} < 0.60$ (60%), a medição é **retida** (`withheld = True`), o valor é omitido das recomendações de ajuste e o AI Coach declara honestamente a insuficiência de dados.

---

## 3. Catálogo de Medidas Biomecânicas

| Medida | Plano | Unidade | Definição Matemática | Convenção de Sinal | Requisitos | Incerteza Típica |
|---|---|---|---|---|---|---|
| **Knee BDC (Ângulo do Joelho)** | Sagital | Graus (°) | Ângulo interno entre anca, joelho e tornozelo no Ponto Morto Inferior (BDC) | $180^\circ$ = perna perfeitamente esticada | $\ge 5$ ciclos válidos | $\pm 0.8^\circ$ |
| **Knee ROM** | Sagital | Graus (°) | $\text{ROM} = \text{Knee}_{\text{BDC}} - \text{Knee}_{\text{TDC}}$ | Sempre positivo ($\ge 35^\circ$) | Ciclo completo BDC/TDC | $\pm 1.2^\circ$ |
| **Hip Angle (Anca)** | Sagital | Graus (°) | Ângulo entre o vetor tronco (ombro-anca) e o fémur (anca-joelho) | Menor no TDC (flexão), maior no BDC | Rastreio de anca e ombro | $\pm 1.5^\circ$ |
| **Torso Inclination** | Sagital | Graus (°) | Ângulo do segmento anca-ombro face à linha horizontal | $0^\circ$ = horizontal, $90^\circ$ = vertical | Referência horizontal | $\pm 1.0^\circ$ |
| **Elbow Flexion** | Sagital | Graus (°) | Ângulo interno no cotovelo entre braço e antebraço | $180^\circ$ = braço bloqueado reto | Marcos de ombro, cotovelo, pulso | $\pm 1.5^\circ$ |
| **Shoulder Angle** | Sagital | Graus (°) | Ângulo entre o tronco e o braço | Ângulo axilar | Ombro, anca e cotovelo | $\pm 1.8^\circ$ |
| **Ankle Dorsiflexion** | Sagital | Graus (°) | Ângulo entre a tíbia e o pé | $90^\circ$ = neutro perpendicular | Marcos de tíbia, calcanhar e metatarso | $\pm 1.5^\circ$ |
| **KOPS Setback** | Sagital | mm | Offset horizontal entre o ponto anterior do joelho e o eixo do pedal às 3h | Positivo (+) = adiantado face ao eixo, Negativo (-) = atrasado | Calibração de escala R11 ativa | $\pm 1.0 \text{ mm}$ |
| **Saddle-to-Bar Drop** | Sagital | mm | Desnível vertical entre a referência do selim e o topo do guiador | Positivo (+) = selim mais alto que guiador | Calibração R11 ativa | $\pm 1.4 \text{ mm}$ |
| **Reach** | Sagital | mm | Distância horizontal entre a ponta do selim e o aperto do guiador | Sempre positivo | Calibração R11 ativa | $\pm 3.0 \text{ mm}$ |
| **Pelvic Hip Drop** | Frontal | Graus (°) | Amplitude pico-a-pico do ângulo da bacia (linha anca-esquerda / anca-direita) face à horizontal | Oscilação dinâmica em graus ($> 2.5^\circ$ indica selim alto / instabilidade) | Vista frontal anterior ou posterior | $\pm 0.4^\circ$ |
| **Lateral Sway** | Frontal | mm | Deslocamento horizontal pico-a-pico do tronco / esterno | Amplitude em mm ($> 30\text{ mm}$ = sobrecarga) | Calibração R11 ativa | $\pm 2.0 \text{ mm}$ |
| **Knee Tracking (Varo/Valgo)** | Frontal | mm | Desvio horizontal do joelho face ao eixo mecânico anca-tornozelo | Varo (+) = joelho projeta para fora, Valgo (-) = joelho colapsa para dentro | Vista frontal e calibração | $\pm 1.5 \text{ mm}$ |
| **Q-Factor Dinâmico** | Frontal | mm | Largura média entre os maléolos/tornozelos durante a descida do pedal | Distância interpedal em mm | Calibração R11 ativa | $\pm 2.5 \text{ mm}$ |
| **Índice de Simetria (SI)** | Bilateral | % | $\text{SI} = \frac{\|L - R\|}{(L + R) / 2} \times 100\%$ | $\le 2\%$ = excelente, $\le 4\%$ = ligeiro, $> 4\%$ = significativo | Dados de ambos os membros | $\pm 0.2\%$ |

---

## 4. Limiares Ergonómicos e Rastreabilidade Científica

Os intervalos ideais de referência baseiam-se na literatura internacional revista por pares. Limiares sem publicação indexada são honestamente marcados como `empirical/unverified`:

| Modalidade | Articulação | Intervalo Recomendado | Fonte Científica Verificável | Nível de Confiança |
|---|---|---|---|---|
| **Road** | Joelho BDC | 145.0° – 155.0° | Holmes et al. (1994); Bini et al. (2011); Peveler et al. (2007) | Alta (*Peer-reviewed*) |
| **Road** | Tronco | 40.0° – 50.0° | Silberman et al. (2005); Pruitt (2006) | Alta (*Clinical consensus*) |
| **Road** | Cotovelo | 150.0° – 165.0° | Pruitt (2006); Burke (2003) | Moderada |
| **Road** | Ombro | 80.0° – 90.0° | Burke (2003) | Moderada |
| **Road** | Tornozelo BDC | 90.0° – 105.0° | Bini et al. (2011); Peveler (2008) | Moderada |
| **TT / Triatlo** | Joelho BDC | 145.0° – 155.0° | Holmes et al. (1994); Bini et al. (2011) | Alta |
| **TT / Triatlo** | Tronco | 20.0° – 35.0° | Pruitt (2006); Silberman et al. (2005) | Alta |
| **TT / Triatlo** | Cotovelo | 85.0° – 105.0° | Burke (2003) [Apoio aero 90°±10°] | Alta |
| **MTB** | Joelho BDC | 140.0° – 150.0° | Peveler et al. (2007); empirical/unverified | Moderada |
| **MTB** | Tronco | 50.0° – 65.0° | Pruitt (2006); empirical/unverified | Moderada |
| **Gravel** | Geral | Variações de Endurance | *empirical/unverified* | Empírica |

### Adaptação por Objetivos e Histórico de Lesões
- **FitGoal.AERO**: Reduz inclinação máxima do tronco em 5° e aumenta flexão de cotovelo em 5°.
- **FitGoal.COMFORT**: Eleva inclinação do tronco em +4° para aliviar tensão cervical e lombar.
- **InjuryFlag.ANTERIOR_KNEE_PAIN / PATELLAR_TENDINOPATHY**: Eleva o joelho mínimo para $\ge 147^\circ$, reduzindo força de reação patelofemoral.
- **InjuryFlag.HAMSTRING_STRAIN**: Limita a extensão máxima a $\le 152^\circ$, prevenindo distensão muscular.
- **InjuryFlag.LOWER_BACK_PAIN**: Eleva o tronco em +4° a +5° para diminuir o momento flexor sobre as vértebras L4-S1.

---

## 5. Deteção Não-Paramétrica de Fadiga (*Fatigue Drift*)

O módulo `athletemotion.domain.measures.fatigue` compara o primeiro terço da sessão com o último terço através do teste estatístico **Mann-Whitney U** (teste de soma de postos não-paramétrico, independente de distribuição normal).
- **Critério de Significância**: $p < 0.05$ E $|\Delta| \ge \text{Limiar Clínico}$ (2.0° para joelho, 2.5° para tronco, 3.0 RPM para cadência).
- **Especificidade Comprovada**: Em testes com 200 execuções sob ruído gaussiano sem deriva, o sistema apresenta taxa de falsos positivos inferior a 5% ($\ge 95\%$ de especificidade).

---

## 6. Filtro de Kalman Cinemático com Restrição Anatómica

O módulo `kalman_skeleton.py` protege as coordenadas 2D contra oclusões e trepidação:
- Estado por articulação: $x = [p_x, p_y, v_x, v_y]^T$.
- Ruído de medição dinâmico: $R = (r_0 / \text{visibilidade})^2 \cdot I$.
- **Restrição de Segmentos**: Garante por projeção vetorial que os comprimentos do fémur ($\|\text{knee} - \text{hip}\|$) e da tíbia ($\|\text{ankle} - \text{knee}\|$) permanecem dentro de $\pm 8\%$ do seu comprimento antropométrico de referência.
- **Eficiência**: Reduz o RMSE do ângulo articular do joelho em mais de 50% face ao sinal bruto sob condições de ruído e oclusão pontual.
