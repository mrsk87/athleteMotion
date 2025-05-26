<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="analyzer-container">
    <h2>Analisador de Postura Ciclística</h2>
    <div class="tutorial-container">
      <h3>Como usar:</h3>
      <ol>
        <li>Posicione-se de lado em sua bicicleta, visível para a câmera</li>
        <li>Clique em "Iniciar Análise em Tempo Real" para ver sua postura</li>
        <li>Os ângulos em <span class="correct">verde</span> estão corretos, em <span class="incorrect">vermelho</span> precisam de ajuste</li>
        <li>Se necessário, ajuste o selim, guidão ou outra parte da bicicleta e observe os resultados em tempo real</li>
      </ol>
    </div>
    <Camera />
    <div class="recommendations">
      <h3>Recomendações de Ajuste</h3>
      <div class="recommendation-item">
        <h4>Altura do Selim</h4>
        <p>Ajuste se o ângulo do joelho estiver fora do intervalo 70-110°. Quando o pedal está na posição mais baixa, o joelho deve ter uma leve flexão.</p>
      </div>
      <div class="recommendation-item">
        <h4>Posição do Selim</h4>
        <p>Ajuste para frente/trás se o ângulo do tornozelo estiver incorreto. Um selim muito avançado causa hiperfexão do tornozelo.</p>
      </div>
      <div class="recommendation-item">
        <h4>Altura do Guidão</h4>
        <p>Ajuste se o ângulo das costas estiver fora do intervalo ideal (40-60°). Um guidão muito baixo força inclinação excessiva das costas.</p>
      </div>
      <div class="recommendation-item">
        <h4>Alcance do Guidão</h4>
        <p>Ajuste se o ângulo do braço estiver incorreto. Os braços devem estar em uma posição confortável sem esticar demais.</p>
      </div>
    </div>
  </div>
</template>

<script>
import Camera from './Camera.vue'

export default {
  components: {
    Camera
  }
}
</script>

<style scoped>
.analyzer-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

h2 {
  color: #2c3e50;
  text-align: center;
  margin-bottom: 20px;
  font-size: 28px;
}

.tutorial-container {
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 30px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.tutorial-container h3 {
  color: #2c3e50;
  margin-bottom: 15px;
}

.tutorial-container ol {
  padding-left: 20px;
}

.tutorial-container li {
  margin-bottom: 10px;
  line-height: 1.5;
}

.correct {
  color: #27ae60;
  font-weight: bold;
}

.incorrect {
  color: #e74c3c;
  font-weight: bold;
}

.recommendations {
  margin-top: 30px;
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.recommendations h3 {
  color: #2c3e50;
  margin-bottom: 20px;
  text-align: center;
}

.recommendation-item {
  margin-bottom: 20px;
  border-bottom: 1px solid #ddd;
  padding-bottom: 15px;
}

.recommendation-item:last-child {
  border-bottom: none;
}

.recommendation-item h4 {
  color: #2980b9;
  margin-bottom: 10px;
}

.recommendation-item p {
  line-height: 1.5;
  color: #34495e;
}
</style>
