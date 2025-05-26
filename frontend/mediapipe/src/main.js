import { createApp } from 'vue';
import App from './App.vue';
import router from './router';

import Camera from './components/Camera.vue';

createApp(App)
  .component('Camera', Camera)
  .use(router)
  .mount('#app');
