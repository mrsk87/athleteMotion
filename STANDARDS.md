# Guia de Padrões de Código e Boas Práticas / Coding Standards & Best Practices

> **Público-alvo:** Desenvolvedores Juniores, Plenos e Seniores  
> **Objetivo:** Garantir legibilidade imediata, manutenibilidade sem fricção, conformidade ACID e código limpo.  
> **Língua Mãe:** Português (PT) | **Secondary:** English (EN)  

---

## 1. Princípios Fundamentais de Engenharia

1. **Legibilidade para Juniores:** Se um programador júnior não conseguir compreender o fluxo de uma função em 2 minutos sem consultar o autor, o código deve ser simplificado ou melhor documentado.
2. **Separação de Responsabilidades (Clean Architecture):** Funções matemáticas puras de biomecânica residem em `src/domain/` e nunca importam frameworks web ou bases de dados.
3. **Zero Números Mágicos (No Magic Numbers):** Nenhum valor numérico (como ângulos `145`, comprimentos `172.5` ou códigos de erro) deve existir no código sem uma constante nomeada autoexplicativa.
4. **Português como Língua-Mãe:** Documentação, comentários explicativos e termos da interface são redigidos prioritariamente em Português claro e ergonómico.

---

## 2. Padrões de Backend (Python 3.11+ / FastAPI / Pydantic)

### 2.1. Tipagem e Modelagem com Pydantic v2
- Todos os endpoints devem usar schemas de entrada e definir `response_model` estrito.
- Utilize `model_config = ConfigDict(from_attributes=True)` para serialização ORM.
- Exemplo:
  ```python
  from pydantic import BaseModel, ConfigDict, Field

  class AthleteCreate(BaseModel):
      name: str = Field(..., min_length=2, max_length=100, description="Nome do ciclista")
      height_cm: float = Field(..., ge=100.0, le=240.0, description="Altura total em cm")
      inseam_cm: float = Field(..., ge=40.0, le=120.0, description="Altura do cavalo em cm")

  class AthleteResponse(BaseModel):
      id: str
      name: str
      height_cm: float
      inseam_cm: float
      model_config = ConfigDict(from_attributes=True)
  ```

### 2.2. Funções Matemáticas Puras e Proteção Contra `NaN`
- Funções em `src/domain/` devem ser puras, determinísticas e livres de efeitos colaterais.
- Ao calcular ângulos trigonométricos via produto escalar, aplique sempre clamping estrito no cosseno:
  ```python
  import math

  def calculate_safe_angle(v1, v2):
      mag1 = math.hypot(v1[0], v1[1])
      mag2 = math.hypot(v2[0], v2[1])
      if mag1 == 0.0 or mag2 == 0.0:
          return 0.0  # Proteção contra divisão por zero
      cos_val = (v1[0]*v2[0] + v1[1]*v2[1]) / (mag1 * mag2)
      clamped_cos = max(-1.0, min(1.0, cos_val))  # Proteção contra NaN
      return math.degrees(math.acos(clamped_cos))
  ```

---

## 3. Padrões de Persistência e Conformidade ACID

Toda a persistência de dados no SQLite deve respeitar estritamente as propriedades **ACID**:

1. **Atomicidade (Atomicity):**
   - Use sempre o gerenciador de contexto `with unit_of_work() as session:`.
   - Se ocorrer qualquer exceção durante a execução, o rollback é acionado automaticamente, garantindo que nada é gravado pela metade.
2. **Consistência (Consistency):**
   - Chaves estrangeiras ativas (`PRAGMA foreign_keys = ON;`).
   - Constraints relacionais na base de dados (`CHECK (height_cm > 50)` e `CHECK (inseam_cm < height_cm)`).
3. **Isolamento (Isolation):**
   - SQLite em modo Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) para permitir leituras concorrentes em simultâneo com escritas atómicas.
4. **Durabilidade (Durability):**
   - `PRAGMA synchronous = NORMAL;` assegurando que transações comitadas sobrevivem a encerramentos abruptos do processo.

---

## 4. Padrões de Frontend (Vue 3 / JavaScript)

### 4.1. Gestão Rigorosa de Hardware e Memória da Câmara
- Qualquer componente que aceda a streams de vídeo (`MediaDevices`) **TEM OBRIGATORIAMENTE** de implementar `beforeUnmount()` para parar todas as faixas do stream:
  ```javascript
  beforeUnmount() {
    if (this.cameraInstance) {
      try { this.cameraInstance.stop(); } catch (e) { console.debug(e); }
      this.cameraInstance = null;
    }
    const video = this.$refs.video;
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
    if (this.poseInstance) {
      try { this.poseInstance.close(); } catch (e) { console.debug(e); }
      this.poseInstance = null;
    }
  }
  ```

### 4.2. Internacionalização (i18n)
- Nenhum texto visível ao utilizador deve ser hardcoded no HTML ou JS.
- Utilizar sempre o hook `const { t } = useI18n()` e referenciar a chave: `{{ t('chaveTexto') }}`.
- O Português é a língua padrão. Cada nova chave criada em `messages.pt` deve ter a correspondente em `messages.en`.

### 4.3. Responsividade Multi-Dispositivo (PC / Mobile / Tablet)
- O layout deve ser adaptável a ecrãs tácteis com botões grandes (mínimo 44px de altura para uso desportivo).
- Utilizar `facingMode: { ideal: "environment" }` para priorizar a câmara traseira em telemóveis.

---

## 5. Convenção de Commits e Versionamento SemVer

O repositório utiliza o sistema de incremento automático SemVer (`x.y.z`):

| Padrão de Commit | Tipo de Incremento SemVer | Exemplo de Commit |
| :--- | :---: | :--- |
| `feat:` ou `#minor` | **MINOR** (`0.x.0`) | `feat: adicionar deteção automática de cadência #minor` |
| `fix:`, `refactor:`, `perf:` | **PATCH** (`0.0.x`) | `fix: corrigir drift de ponto flutuante no joelho` |
| `docs:`, `chore:` | **PATCH** (`0.0.x`) | `docs: atualizar STATUS.md para nova versão` |
| `BREAKING CHANGE:`, `feat!:` ou `#major` | **MAJOR** (`x.0.0`) | `feat!: reestruturação dos schemas da API v2 #major` |

Para validar a integridade antes do envio remoto:
```bash
python scripts/bump_version.py --current
python scripts/install_hooks.py
```

---

## 6. A Regra de Ouro do Repositório

> [!IMPORTANT]
> **Qualquer alteração funcional, correção de bug ou refatoração DEVE atualizar o ficheiro [`STATUS.md`](file:///d:/Projects/athleteMotion/STATUS.md).**
> Pull requests sem atualização do status ou com quebra nos testes automatizados (`pytest tests/`) serão sumariamente rejeitados.
