<template>
  <HelloWorld v-bind="$attrs" />
</template>
<script>
import HelloWorld from './HelloWorld/HelloWorld.vue';
export default {
  components: { HelloWorld }
};
</script>
