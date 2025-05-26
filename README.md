# Sistema de Análise de Postura para Ciclistas

Uma solução em tempo real que utiliza MediaPipe e OpenCV no backend (FastAPI) e Vue.js no frontend para detectar pontos-chave do corpo de ciclistas, calcular ângulos de articulações e fornecer feedback visual imediato para otimizar postura.

## Tecnologias

- **Backend**: Python 3.11, FastAPI, MediaPipe, OpenCV, NumPy
- **Frontend**: Vue.js, Axios, HTML5 Canvas, CSS3

## Pré-requisitos

- Python 3.11 ou superior
- Node.js 14 ou superior
- Gerenciador de pacotes npm ou yarn

## Instalação

1. Clone este repositório:

   ```bash
   git clone https://github.com/mrsk87/athleteMotion.git
   cd athleteMotion
   ```

2. Configure ambiente Python e instale dependências:

   ```bash
   python -m venv venv
   source venv/bin/activate   # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Instale dependências do frontend:

   ```bash
   cd frontend/mediapipe
   npm install
   # ou yarn install
   ```

## Executando o sistema

### Backend

Na raiz do projeto (ambiente Python ativado):

```bash
uvicorn server:app --reload --port 8001
```

### Frontend

Em outra aba do terminal:

```bash
cd frontend/mediapipe
npm run serve
# ou yarn serve
```

Aceda no navegador: `http://localhost:8080`

## Como usar

1. Posicione-se de lado em sua bicicleta, garantindo que joelho, quadril e tornozelo fiquem visíveis.
2. Clique em **Iniciar Análise em Tempo Real**.
3. Observe os pontos e ângulos codificados por cores (verde = correto, vermelho = ajuste necessário).
4. Ao finalizar, use **Salvar Análise** para exportar JSON e imagem.

## Licença

Projeto sob licença MIT. Veja `LICENSE.md` para detalhes.
