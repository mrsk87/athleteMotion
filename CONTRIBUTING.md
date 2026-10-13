# Guia de Contribuição / Contributing Guide

> **Língua Principal:** Português | **Secondary:** English  
> **Padrão de Versionamento:** Semantic Versioning 2.0.0 (`x.y.z`)

---

## 1. Português (Língua-Mãe)

Obrigado por contribuir para o **Athlete Motion**! Para mantermos a consistência do código, a estabilidade de releases e a facilidade de integração contínua, siga as diretrizes abaixo.

### 1.1. Fluxo de Trabalho (Git Workflow)
1. Crie uma branch descritiva a partir de `main`:
   - `git checkout -b feature/nome-da-feature`
   - `git checkout -b fix/descricao-do-bug`
2. Mantenha os commits pequenos, atómicos e focados num único objetivo.
3. Certifique-se de que não introduz credenciais, variáveis de ambiente `.env` ou ficheiros de ambientes virtuais (`bin/`, `lib64/`, etc.).

### 1.2. Convenção de Commits e Autoincremento de Versão
O projeto utiliza um sistema automático de incremento SemVer (`MAJOR.MINOR.PATCH`):
- **PATCH** (`0.0.x`): Commits do tipo `fix:`, `refactor:`, `perf:`, `docs:` ou qualquer commit sem marcador especial incrementam o patch automaticamente.
- **MINOR** (`0.x.0`): Commits do tipo `feat:` ou que contenham a tag `#minor` incrementam a versão minor.
- **MAJOR** (`x.0.0`): Commits com `BREAKING CHANGE:`, `feat!:` ou que contenham a tag `#major` incrementam a versão major.

### 1.3. Gestão Local de Versões
Pode verificar ou incrementar a versão manualmente a qualquer momento através do utilitário:
```bash
# Ver a versão atual
python backend/scripts/bump_version.py --current

# Simular próximo incremento (dry-run)
python backend/scripts/bump_version.py --dry-run patch

# Incrementar manualmente
python backend/scripts/bump_version.py patch
python backend/scripts/bump_version.py minor
python backend/scripts/bump_version.py major

# Auto-detetar incremento com base no último commit
python backend/scripts/bump_version.py --auto
```

Para instalar os hooks automáticos do Git no seu ambiente de desenvolvimento:
```bash
python backend/scripts/install_hooks.py
```

### 1.4. Regra de Atualização do `STATUS.md`
**Obrigatório:** Qualquer alteração no código (nova feature, refatoração ou correção de bug) **deve** ser refletida no ficheiro [`STATUS.md`](STATUS.md). Pull Requests que alterem o comportamento do sistema sem atualizar o status não serão aceites.

### 1.5. Boas Práticas e Conformidade ACID
Consulte sempre os seguintes documentos antes de submeter código:
- [`ARCHITECTURE.md`](ARCHITECTURE.md): Arquitetura limpa, modelo de concorrência e diagrama de entidades.
- [`STANDARDS.md`](STANDARDS.md): Padrões de código para juniores e seniores, ACID e eliminação de números mágicos.
- [`CODE_REVIEW.md`](CODE_REVIEW.md): Histórico de auditoria técnica e dívidas conhecidas.

---

## 2. English (Secondary)

### 2.1. Git Workflow
1. Create a descriptive branch from `main`:
   - `git checkout -b feature/feature-name`
   - `git checkout -b fix/bug-description`
2. Keep commits atomic, cohesive, and well-documented.
3. Never commit credentials, `.env` files, or virtual environment artifacts.

### 2.2. Commit Conventions & Automated Versioning
The repository follows Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH`) auto-incremented on release:
- **PATCH** (`0.0.x`): Default for `fix:`, `refactor:`, `perf:`, `docs:` or commits without flags.
- **MINOR** (`0.x.0`): Triggered by `feat:` or by including `#minor` in the commit message.
- **MAJOR** (`x.0.0`): Triggered by `BREAKING CHANGE:`, `feat!:`, or `#major` in the commit message.

### 2.3. Local Version Commands
```bash
python scripts/bump_version.py --current
python scripts/bump_version.py patch
python scripts/bump_version.py minor
python scripts/bump_version.py major
python scripts/bump_version.py --auto
```

### 2.4. Mandatory `STATUS.md` Update
Any pull request that introduces functional changes, resolves bugs, or refactors system components must update [`STATUS.md`](STATUS.md) accordingly.
