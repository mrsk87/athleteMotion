# Validação Científica e Rastreabilidade do Athlete Motion (R17)

Este diretório documenta a metodologia, o protocolo clínico experimental e as ferramentas de validação estatística empregues para homologar a precisão e a fiabilidade do sistema Athlete Motion face a sistemas de referência de verdade-terreno (*ground truth*).

---

## 1. Princípios de Engenharia e Integridade Científica

Em estrito cumprimento das diretrizes de desenvolvimento (`AGENTS.md`), o Athlete Motion adota o princípio de **Honestidade Clínica**:
1. **Sem Valores Falsificados:** Medidas onde a confiança dos *keypoints* seja inferior a $0.60$ ou nas quais a câmara não esteja devidamente calibrada espacialmente são categorizadas como `withheld` (suprimidas). O sistema declara explicitamente a ausência de dados em vez de inferir aproximações infundadas.
2. **Incerteza e Intervalos de Confiança:** Todo o valor reportado em ecrã, no PDF ou nas exportações CSV/JSON acompanha a estimativa de incerteza ($\pm U$) e o nível de confiança estatística.
3. **Auditabilidade de Proveniência:** Cada sessão e relatório regista a versão semântica da aplicação, o hash Git do commit, o hash SHA-256 dos pesos do modelo de inferência (YOLO11, RTMPose), o backend de aceleração de hardware (DirectML, OpenVINO, CPU) e os parâmetros da calibração ótica.

---

## 2. Metodologia Estatística de Validação

A comparação entre as estimativas do modelo de visão artificial ($\hat{y}$) e as medições de referência ($y$) baseia-se nos seguintes testes numéricos:

- **Erro Médio Absoluto (MAE):** $\text{MAE} = \frac{1}{n} \sum_{i=1}^n |\hat{y}_i - y_i|$ (Meta: $\le 3.0^\circ$)
- **Raiz do Erro Quadrático Médio (RMSE):** $\text{RMSE} = \sqrt{\frac{1}{n} \sum_{i=1}^n (\hat{y}_i - y_i)^2}$ (Meta: $\le 4.0^\circ$)
- **Viés Sistemático (Mean Bias):** $\bar{d} = \frac{1}{n} \sum_{i=1}^n (\hat{y}_i - y_i)$ (Meta: $|\bar{d}| \le 1.5^\circ$)
- **Limites de Concordância de 95% (Bland & Altman, 1986):** $[\bar{d} - 1.96 \cdot s_d, \;\; \bar{d} + 1.96 \cdot s_d]$ (Meta: $\le \pm 5.0^\circ$)
- **Coeficiente de Correlação de Pearson ($r$):** Meta: $r \ge 0.95$

---

## 3. Como Reproduzir a Validação

### 3.1 Geração de Dados Sintéticos com Erro Controlado Injetado
Para verificar que as ferramentas estatísticas recuperam o erro injetado com exatidão $\pm 0.1^\circ$:
```powershell
cd backend
.venv\Scripts\python.exe -m athletemotion.validation.runner --generate-synthetic tests/data/synthetic_validation
```

### 3.2 Execução da Bateria de Ensaios
Para processar os ficheiros de dados (`.csv` e `.npz`) e gerar os relatórios de conformidade:
```powershell
cd backend
.venv\Scripts\python.exe -m athletemotion.validation.runner --dataset tests/data/synthetic_validation --engines fake --out reports/validation
```

Os seguintes artefactos são gerados em `reports/validation/`:
- `validation_report.md`: Tabela sinótica de métricas e estado (PASS/FAIL).
- `validation_results.json`: Métricas estruturadas prontas para ingestão em pipelines de CI/CD.
- `bland_altman_{ensaio}.png`: Gráfico formal de concordância com viés e limites LoA de 95%.

---

## 4. Referências Bibliográficas Citadas

1. **Bland, J. M., & Altman, D. G. (1986).** Statistical methods for assessing agreement between two methods of clinical measurement. *The Lancet*, 327(8476), 307-310.
2. **Holmes, J. C., Pruitt, A. L., & Whalen, N. J. (1994).** Lower extremity overuse in bicycling. *Clinics in Sports Medicine*, 13(1), 187-205.
3. **Bini, R. R., & Hume, P. A. (2011).** Biomechanical methods for cycling. *Springer Science & Business Media*.
4. **Burke, E. R. (2003).** *High-Tech Cycling*. Human Kinetics.
5. **Pruitt, A. L. (2006).** *Andy Pruitt's Complete Medical Guide for Cyclists*. VeloPress.
6. **Silberman, M. R., et al. (2005).** Road bicycle fit. *Current Sports Medicine Reports*, 4(5), 271-276.
