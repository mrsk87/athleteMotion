<template src="./HelpTip.html"></template>
<script src="./HelpTip.js"></script>

<!-- Estilos da interface do painel (com scoped, para não sair deste componente). -->
<style scoped src="./HelpTip.css"></style>

<!--
  Estilos dos DESENHOS: têm de ser globais, porque o SVG é injetado com
  `v-html` e o conteúdo injetado não recebe o atributo `data-v-…` do scoped.
-->
<style src="./HelpTip.diagram.css"></style>
