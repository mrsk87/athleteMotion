<template>
  <div class="home">
    <h1>Análise de Postura para Ciclismo</h1>
    <p class="instructions">Use esta ferramenta para analisar sua postura em uma bicicleta</p>
    <BikeFitAnalyzer />
  </div>
</template>

<script>
// @ is an alias to /src
import BikeFitAnalyzer from '@/components/BikeFitAnalyzer.vue'

export default {
  name: 'HomeView',
  components: {
    BikeFitAnalyzer
  }
}
</script>

<style scoped>
.home {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

h1 {
  color: #2c3e50;
  text-align: center;
  margin-bottom: 10px;
}

.instructions {
  text-align: center;
  color: #34495e;
  margin-bottom: 30px;
  font-size: 1.1rem;
}
</style>
