# ADR 004: Mitigação de Risco de Licença Ultralytics e Adoção do RTMPose Halpe26 (Decisão D1)

> **Status:** Aceite  
> **Data:** 2026-10-14  
> **Decisores:** Senior Core Developer, Board Técnico  
> **Referência:** R13, Decisão D1, CODE_REVIEW §3.1, §3.3  

---

## 1. Contexto e Formulação do Problema
O modelo YOLO11 (Ultralytics) é distribuído sob a licença de código aberto **AGPL-3.0**. Esta licença impõe fortes restrições de copyleft de rede: qualquer serviço ou produto comercial acessível por rede ou distribuído fechado que incorpore o YOLO11 obriga à disponibilização pública de todo o código-fonte proprietário envolvente, criando um risco jurídico severo para estúdios e clientes de BikeFit.
Adicionalmente, a topologia padrão do COCO-17 usada pelo YOLO11 não possui anotações de pontos anatómicos reais no calcanhar nem nos metatarsos dos pés, forçando aproximações heurísticas da posição dos pés.

---

## 2. Decisão Tomada (Decisão D1)
1. **Adoção do RTMPose-m (Halpe26) como Motor de Alta Precisão Primário:**
   - O RTMPose (MMPose / OpenMMLab) é distribuído sob licença permissiva **Apache-2.0**, 100% segura e livre de riscos virais AGPL para uso comercial e redistribuição.
   - O modelo Halpe26 inclui **26 pontos anatómicos nativos**, mapeando com rigor o calcanhar real (pontos 24 e 25) e as pontas dos pés reais (pontos 20 e 21), eliminando a necessidade de aproximações heurísticas (`estimated=False`).
2. **Mitigação do Risco YOLO11:**
   - O motor `yolo11n-pose` é mantido como opção de alta velocidade experimental, mas expressamente sinalizado com o metadado `"license_risk": true` e `"license": "AGPL-3.0"` no catálogo de motores da API (`GET /api/v1/inference/engines`).
   - A documentação e termos informam com total transparência o operador sobre as implicações de licenciamento.
3. **Manifest Criptográfico de Modelos (`manifest.json`):**
   Todos os modelos ONNX possuem verificação criptográfica estrita por SHA-256 no arranque via `ModelZoo`, eliminando o risco de execução de binários corrompidos ou adulterados.

---

## 3. Consequências e Trade-offs

### 3.1. Positivas (+)
- **Segurança Jurídica Total:** Clientes e operadores podem comercializar os seus serviços com o RTMPose sem risco de contaminação AGPL-3.0.
- **Superioridade Biomecânica:** A cinemática do tornozelo e do pedal baseia-se em anotações reais de calcanhar e metatarso.
- **Transparência Ética:** Metadados claros de licenciamento no catálogo REST.

### 3.2. Negativas / Custos (-)
- O modelo RTMPose-m é ligeiramente mais pesado que o YOLO11n (55.6 MB vs 11.8 MB), mas atinge facilmente 119 FPS em DirectML.

---

## 4. Conformidade e Validação
Garantido por testes em `tests/unit/test_model_manifest.py` e `tests/unit/test_rtmpose_engine.py` e exposição transparente em `/api/v1/inference/engines`.
