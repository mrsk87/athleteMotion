# ADR 006: Convenção de Ângulos Articulares, Cinemática em Pixels e Unidades

> **Status:** Aceite  
> **Data:** 2026-10-13  
> **Decisores:** Senior Core Developer, Especialistas em Biomecânica  
> **Referência:** R02, R10, R11, R12, CODE_REVIEW §4.1, §4.4, §4.5  

---

## 1. Contexto e Formulação do Problema
Sistemas de visão computacional estimam posições anatómicas no espaço de imagem ($x, y$ em pixels ou normalizados $[0, 1]$ com aspecto dependente da resolução da câmara).
O código legado continha inconsistências graves:
1. Misturava ângulos internos e suplementares sem convenção explícita (ex.: extensão do joelho a $150^\circ$ vs flexão a $30^\circ$).
2. Calculava ângulos diretamente sobre coordenadas normalizadas com distorção de aspecto (ex.: $1920 \times 1080$), distorcendo os ângulos reais em até $15^\circ$.
3. Fornecia medidas em milímetros ou centímetros (recuo KOPS, saddle drop) inventando uma escala arbitrária quando a câmara não estava calibrada.
4. Faltavam marcadores no pé em modelos COCO-17, gerando ângulos de tornozelo nulos ou espúrios.

---

## 2. Decisão Tomada
1. **Convenção de Ângulos Internos Fisiológicos:**
   - Todo o ângulo de articulação $\theta$ é medido como o **ângulo interno inclusivo** entre o segmento proximal e o segmento distal centrado no vértice articular (ex.: joelho = anca-joelho-tornozelo).
   - O intervalo ergonómico de extensão máxima no BDC (Holmes 1994, Pruitt 2006) é fixado em **$145^\circ$ a $155^\circ$**.
2. **Cálculo Estrito no Espaço Euclídeo Isométrico em Pixels:**
   - As coordenadas são convertidas obrigatoriamente para píxeis reais ($x \cdot W, y \cdot H$) antes de qualquer cálculo de vetores euclidianos ou produto escalar, preservando a métrica espacial 2D.
3. **Estimador Anatómico de Pés (Winter 2009):**
   - Para modelos que não possuem marcadores de pé (MediaPipe, YOLO11), é aplicado o modelo antropométrico de Winter (2009) projetando o calcanhar e metatarsos com base no vetor da tíbia e comprimento da perna, sinalizando explicitamente a flag `"estimated": true`.
   - Quando o RTMPose-m (Halpe26) é utilizado, as anotações reais são adotadas com `"estimated": false`.
4. **Política de Supressão na Falta de Calibração Métrica:**
   - Nenhuma distância métrica real (mm, cm) é calculada sem uma calibração válida (`scale_px_per_mm`). Caso não haja calibração, o sistema reporta `value: null` e a razão clínica `"uncalibrated_spatial_scale"`, nunca números fictícios.

---

## 3. Consequências e Trade-offs

### 3.1. Positivas (+)
- **Honestidade Clínica Absoluta:** O software nunca induz mecânicos ou fisioterapeutas em erro com números inventados.
- **Invariância de Resolução:** Análises gravadas a 720p, 1080p ou 4K fornecem exatamente os mesmos ângulos angulares.
- **Rastreabilidade Científica:** Todos os limiares ergonómicos citam autores formais da literatura (Holmes 1994, Pruitt 2006, Bini 2011, Silberman 2005).

### 3.2. Negativas / Custos (-)
- O operador é obrigado a realizar a calibração ótica (ArUco ou pedivela) se desejar relatórios de recuo de selim em milímetros.

---

## 4. Conformidade e Validação
Garantido por testes unitários em `tests/unit/test_domain_angles.py`, `tests/unit/test_measures_sagittal.py` e `tests/unit/test_calibration.py`.
