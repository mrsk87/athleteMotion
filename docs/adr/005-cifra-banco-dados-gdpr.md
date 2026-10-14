# ADR 005: Cifra de Dados Biométricos Sensíveis e Conformidade RGPD (Decisão D3)

> **Status:** Aceite  
> **Data:** 2026-10-14  
> **Decisores:** Senior Core Developer, Data Protection Officer  
> **Referência:** R06, Decisão D3, CODE_REVIEW §1.8, §4.3  

---

## 1. Contexto e Formulação do Problema
O Regulamento Geral sobre a Proteção de Dados (RGPD — Regulamento (UE) 2016/679) classifica dados biométricos relativos às características físicas, fisiológicas ou comportamentais de uma pessoa singular como **categorias especiais de dados** (Artigo 9.º).
O armazenamento de landmarks corporais brutos (coordenadas x, y, z de articulações em cada fotograma) permite a identificação unívoca de um indivíduo e da sua assinatura de movimento. A gravação destes dados em texto limpo (plain-text) na base de dados SQLite exporia atletas em caso de cópia não autorizada do ficheiro `.db`. Além disso, a gravação de milhões de coordenadas não solicitadas viola o princípio da **Minimização de Dados** (Artigo 5.º, n.º 1, al. c).

---

## 2. Decisão Tomada (Decisão D3)
1. **Minimização de Dados por Padrão (*Privacy by Default*):**
   - O campo `raw_landmarks_json` nos snapshots de postura só é persistido se o atleta tiver fornecido consentimento explícito prévio com o escopo `store_landmarks` (`store_landmarks=True`).
   - Caso contrário, o valor é imediatamente descartado em RAM após o cálculo dos ângulos articulares.
2. **Cifra a Nível de Campo (*Field-Level Encryption*):**
   - Quando autorizado, o texto JSON das landmarks é cifrado em repouso com o padrão **Fernet (AES-128-CBC com HMAC-SHA256)** gerado a partir da chave mestra da aplicação (`ATHLETE_DB_ENCRYPTION_KEY` ou `%APPDATA%/AthleteMotion/.master_key`).
   - Todos os dados cifrados possuem o prefixo canónico `enc:v1:` e utilizam tipos SQLAlchemy customizados (`EncryptedText`), garantindo decifra transparente na leitura autorizada e total ilegibilidade em caso de exfiltração do ficheiro `.db`.
3. **Direito ao Esquecimento e Purga:**
   - Soft-delete com `deleted_at` combinado com opção de purga física imediata e irremediável (`DELETE /athletes/{id}?hard=true` com `PRAGMA secure_delete=ON`, truncamento de WAL e `VACUUM`).
   - A revogação do consentimento (`PATCH /athletes/{id}/consent`) purga retroativamente todas as landmarks previamente gravadas.

---

## 3. Consequências e Trade-offs

### 3.1. Positivas (+)
- **Conformidade Legal Total:** Cumpre rigorosamente os Artigos 5.º, 9.º, 17.º (Apagamento), 20.º (Portabilidade) e 32.º (Segurança do Tratamento) do RGPD.
- **Redução Massiva do Volume da BD:** 90% das sessões normais de BikeFit necessitam apenas dos ângulos calculados, poupando centenas de megabytes em disco.

### 3.2. Negativas / Custos (-)
- Pequeno custo computacional de cifra e decifra simétrica na ingestão de lotes autorizados (inferior a 2 ms por 100 snapshots).

---

## 4. Conformidade e Validação
Garantido por testes de integração dedicados em `tests/integration/test_privacy_gdpr.py` verificando a presença de ciphertext ilegível diretamente nos blocos binários do SQLite.
