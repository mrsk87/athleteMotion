# Manual de Calibração Espacial, Escala e Correção Ótica (Athlete Motion)

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`
> **Módulo:** `athletemotion.domain.calibration` · **Referência:** R11

---

## 1. Visão Geral

Nas análises biomecânicas de ciclismo e BikeFit, a conversão precisa de distâncias em píxeis para medidas anatómicas reais em milímetros (como o recuo KOPS patela-pedal ou o desfasamento do selim) é crítica. Medir em píxeis ou aplicar fatores fixos sem calibração física conduz a recomendações clínicas erróneas.

O subsistema de calibração do **Athlete Motion** oferece:
1. **Calibração Primária por Marcador ArUco:** Deteção fiduciária de alta precisão com correção de orientação 3D (Roll e Yaw).
2. **Métodos Auxiliares:** Calibração pelo raio de rotação da pedivela (172.5 mm nominais) e geometria elíptica da roda.
3. **Correção Ótica de Distorção:** Desdistorção rápida por modelo de câmara pinhole (`undistort_points` sem reamostragem do fotograma completo).
4. **Propagação Estrita de Incerteza:** Cada medida milimétrica inclui a sua margem de incerteza ($\pm \sigma$). Se não houver calibração válida ativa, o sistema **não emite milímetros** (`None`), prevenindo falsos diagnósticos.

---

## 2. Tabela Comparativa de Métodos e Incertezas

| Método | Referência Física | Precisão / Incerteza Típica | Requisitos de Operação | Casos de Uso Recomendados |
|---|---|---|---|---|
| **Marcador ArUco (Padrão)** | Quadrado fiduciário de 100 mm (DICT_4X4_50) | **$\pm 0.3\%$ a $1.0\%$** ($\pm 0.5$ mm a 1 m) | Marcador visível no plano sagital de pedalada (> 3% da largura). | Calibração de bancada e estúdio profissional de BikeFit. |
| **Pedivela (Crank)** | Comprimento nominal do crenque (ex: 172.5 mm) | **$\pm 5.0\%$ a $8.0\%$** ($\pm 4.0$ mm a 1 m) | Trajetória circular do pedal identificada em 3h e 9h. | Ambientes rápidos sem marcador físico disponível. |
| **Roda (Wheel)** | Diâmetro exterior do pneu (ex: 700c $\approx$ 670 mm) | **$\pm 2.0\%$ a $4.0\%$** ($\pm 2.0$ mm a 1 m) | Contorno do aro/pneu visível sem oclusão excessiva. | Verificação de escala e deteção de ângulo de Yaw. |

---

## 3. Procedimento Operacional Passo a Passo (Marcador ArUco)

### Passo 1: Impressão e Verificação do Marcador
1. Imprima o marcador ArUco ID `0` do dicionário `DICT_4X4_50` (pode ser gerado pelo sistema ou descarregado em escala 100%).
2. **MUITO IMPORTANTE:** Com uma régua rígida milimétrica, meça o lado exterior do quadrado negro impresso. Confirme a medida exata (ex.: 100.0 mm). Não assuma a escala da impressora sem medição física.

### Passo 2: Posicionamento
1. Fixe o marcador numa placa rígida e plana (acrílico, cartão compacto ou no próprio quadro da bicicleta).
2. O marcador deve ficar paralelo ao plano de rotação da bicicleta (plano sagital).

### Passo 3: Enquadramento da Câmara
1. Posicione a câmara em tripé a aproximadamente 2.5 a 3.5 metros da bicicleta.
2. Certifique-se de que a câmara se encontra nivelada:
   - **Roll:** O sistema emite alerta `HIGH_ROLL` se $|\text{roll}| > 3.0^\circ$.
   - **Yaw:** O sistema emite alerta `HIGH_YAW` se $|\text{yaw}| > 8.0^\circ$ (câmara oblíqua).
3. A imagem deve ter iluminação homogénea (variância do Laplaciano $\ge 50$ para evitar jitter subpixel).

### Passo 4: Execução via API ou CLI
Envie o frame de calibração para o endpoint:
```http
POST /api/v1/calibration/scale?marker_length_mm=100.0
Content-Type: multipart/form-data
```
Resposta típica:
```json
{
  "mm_per_px": 0.5018,
  "method": "aruco",
  "uncertainty_mm_per_px": 0.0035,
  "plane_roll_deg": -0.8,
  "plane_yaw_deg": 1.4,
  "is_perpendicular": true,
  "warnings": []
}
```

---

## 4. Calibração de Lente (Chessboard)

Para compensar o efeito de "barril" em lentes de grande angular (webcams comuns ou lentes de 16-24 mm):
1. Capture pelo menos 5 a 10 fotogramas de um tabuleiro de xadrez $9 \times 6$ em diferentes posições e inclinações.
2. Submeta o lote a `POST /api/v1/calibration/lens`.
3. O perfil intrínseco gerado (matriz $K$ e coeficientes $k_1, k_2, p_1, p_2, k_3$) é guardado na base de dados (`camera_profiles`) e reutilizado automaticamente pelo `CoordinateTransformer`.
