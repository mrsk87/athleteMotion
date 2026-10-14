# Relatório de Validação Científica dos Motores de BikeFit

- **Dataset:** `tests\data\synthetic_validation`
- **Total de Ensaios:** 2

| Ensaio / Articulação | N | MAE (°) | RMSE (°) | Viés (°) | 95% LoA (°) | Pearson r | Estado |
|---|---|---|---|---|---|---|:---:|
| **Anca** (`hip_validation.npz`) | 300 | 1.24 | 1.54 | -0.53 | [-3.4, +2.3] | 0.9650 | ✅ PASS |
| **Joelho** (`knee_validation.csv`) | 300 | 1.13 | 1.42 | +0.79 | [-1.5, +3.1] | 0.9965 | ✅ PASS |

### Critérios de Aceitação Homologados
- **MAE:** $\le 3.0°$ (exatidão biomecânica)
- **RMSE:** $\le 4.0°$ (estabilidade sem saltos)
- **Viés Absoluto:** $\le 1.5°$ (ausência de erro sistemático)
- **Correlação Pearson ($r$):** $\ge 0.95$