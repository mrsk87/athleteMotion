# Política de Privacidade, Proteção de Dados e RGPD (Athlete Motion)

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`
> **Módulo:** `athletemotion.services.privacy_service` · **Referência:** R06

---

## 1. Visão Geral e Compromisso de Arquitetura

O **Athlete Motion** foi desenhado sob o princípio de **Privacy by Design e Privacy by Default** (Art. 25.º do RGPD). Todos os dados processados servem exclusivamente o propósito de conduzir análises de postura e otimização ergonómica de BikeFit para o ciclista.

### Princípios Técnicos Fundamentais:
1. **Minimização Estrita de Dados (Art. 5.º, n.º 1, al. c):** Por defeito, as coordenadas de keypoints biométricos brutos (`raw_landmarks_json`) **não são persistidas** em repouso. Apenas os ângulos articulares calculados necessários ao diagnóstico são gravados.
2. **Cifra a Nível de Campo (Field-Level Encryption - Art. 32.º):** Campos sensíveis (email do titular e keypoints brutos de pose quando autorizados) são cifrados simetricamente com o algoritmo Fernet (AES-128-CBC + HMAC-SHA256) antes da gravação no disco (`enc:v1:<token>`).
3. **Direito ao Apagamento e Purga Física Real (Art. 17.º):** A eliminação definitiva (hard delete) não deixa vestígios em páginas livres da base de dados nem no ficheiro de log Write-Ahead Logging (`.db-wal`), forçando truncatura atómica (`PRAGMA wal_checkpoint(TRUNCATE)`) e compactação (`VACUUM`).

---

## 2. Inventário de Dados Pessoais e Biométricos

| Categoria de Dados | Campos Específicos | Finalidade | Base Legal (RGPD) | Retenção Padrão | Cifra em Repouso |
|---|---|---|---|---|---|
| **Identificação & Contacto** | `name`, `email` | Identificação do ciclista e envio de relatórios em PDF. | Art. 6.º, n.º 1, al. a (Consentimento) | 24 meses ou até pedido de apagamento | Sim (`email` cifrado com Fernet) |
| **Dados Antropométricos** | `height_cm`, `inseam_cm`, `torso_length_cm`, `arm_length_cm`, `shoulder_width_cm`, `flexibility` | Cálculo de geometria ergonómica teórica (altura de selim, avanço, guiador). | Art. 6.º, n.º 1, al. b / a (Execução do serviço / Consentimento) | Associada ao perfil do ciclista | Não (necessário para agregação matemática rápida) |
| **Equipamento** | Modelo de bicicleta, medidas do quadro, pedivela, guiador | Ajuste biomecânico do equipamento ao corpo do ciclista. | Art. 6.º, n.º 1, al. b | Associada ao perfil do ciclista | Não |
| **Métricas Angulares Biomecânicas** | Ângulos de joelho, tronco, braço, tornozelo por frame | Avaliação da postura dinâmica de pedalagem. | Art. 9.º, n.º 2, al. a (Consentimento explícito para dados biométricos) | 24 meses (ou extensão consentida) | Não |
| **Keypoints Biométricos Brutos (Art. 9.º)** | Coordenadas espaciais $(x, y, z)$ dos pontos corporais | Reanálise ou depuração avançada de visão computacional. | Art. 9.º, n.º 2, al. a (Consentimento explícito 'store_landmarks') | Opcional; descartado por defeito | Sim (`raw_landmarks_json` cifrado) |

---

## 3. Direitos do Titular dos Dados

Em conformidade com o Capítulo III do RGPD, a API do Athlete Motion expõe mecanismos automatizados para o exercício de direitos:

### 3.1. Direito de Acesso e Portabilidade (Art. 15.º e 20.º)
- **Endpoint:** `GET /api/v1/athletes/{id}/export`
- **Formato:** JSON estruturado e autocontido com identificador de versão (`schema_version: "1.0"`), contendo todos os dados do perfil, bicicletas, histórico de sessões, diagnósticos e snapshots.
- **Descriptografia:** Os dados cifrados em repouso são decifrados transparentemente para o titular na exportação.

### 3.2. Retirada de Consentimento (Art. 7.º, n.º 3)
- **Endpoint:** `PATCH /api/v1/athletes/{id}/consent`
- **Comportamento Imediato:** Se o ciclista remover o âmbito `"store_landmarks"`, a aplicação:
  1. Define `fit_sessions.store_landmarks = False` em todas as sessões do atleta.
  2. Executa a purga imediata de todos os `raw_landmarks_json = NULL` existentes nos registos de snapshots.

### 3.3. Direito ao Apagamento / "Direito a Ser Esquecido" (Art. 17.º)
- **Endpoint:** `DELETE /api/v1/athletes/{id}?hard=false` (Soft-delete padrão)
  - Marca `deleted_at = now()` e agenda janela de retenção de 30 dias para eliminação definitiva (`retention_until`).
  - O ciclista deixa imediatamente de surgir em pesquisas (`GET /athletes`) e bloqueia novas sessões.
- **Endpoint:** `DELETE /api/v1/athletes/{id}?hard=true` (Hard-delete imediato)
  - Remove fisicamente em cascata todas as bicicletas, sessões e snapshots associados.
  - Executa `PRAGMA secure_delete = ON;`, `PRAGMA wal_checkpoint(TRUNCATE);` e `VACUUM;`.
  - Garante que nenhum vestígio do nome ou email permaneça gravado nos ficheiros `.db` ou `.db-wal`.

### 3.4. Política e Limitação da Conservação (Art. 5.º, n.º 1, al. e)
- Rotina automatizada em `athletemotion.services.retention` (executada no arranque da API e via CLI `python -m athletemotion.cli purge --retention-months 24`).
- Purga registos com soft-delete expirado e sessões anteriores a 24 meses sem o consentimento `"retention_extended"`.

---

## 4. Textos Oficiais de Consentimento Informado (Versão v1.0)

### 4.1. Português (PT-PT)

```text
TERMO DE CONSENTIMENTO LIVRE, ESCLARECIDO E INFORMADO (Versão v1.0)

1. Finalidade do Tratamento:
Ao utilizar a plataforma Athlete Motion, autorizo o processamento das minhas medidas
antropométricas e a captura em tempo real de vídeo e imagem para efeitos de cálculo de
ângulos articulares, análise ergonómica e recomendações de ajuste de BikeFit.

2. Dados Biométricos (Artigo 9.º do RGPD):
Reconheço que a deteção de pontos articulares corporais constitui tratamento de dados biométricos.
O processamento em tempo real é indispensável para a prestação do serviço. O armazenamento
permanente das coordenadas brutas de visão computacional é opcional e depende da seleção expressa
do âmbito 'store_landmarks'.

3. Direitos e Revogação:
Tenho o direito de aceder aos meus dados, exportá-los em formato legível, solicitar a sua
retificação ou eliminação integral a qualquer momento, bem como revogar o consentimento
previamente concedido através da aplicação, com efeitos imediatos para o futuro.
```

### 4.2. English (EN)

```text
INFORMED CONSENT FORM (Version v1.0)

1. Purpose of Processing:
By using the Athlete Motion platform, I consent to the processing of my anthropometric
measurements and real-time video/image capture for joint angle calculation, ergonomic
posture assessment, and BikeFit optimization recommendations.

2. Biometric Data (Article 9 GDPR):
I acknowledge that body pose keypoint estimation constitutes processing of biometric data.
Real-time estimation is necessary to perform the ergonomic fitting service. Permanent storage
of raw coordinate landmarks is strictly optional and requires explicit selection of the
'store_landmarks' consent scope.

3. Rights and Withdrawal:
I retain the right to access my personal data, export it in a structured portable format,
request complete deletion, or withdraw my consent at any time via the application,
with immediate effect for future processing.
```
