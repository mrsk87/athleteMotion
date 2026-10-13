import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { themeManager } from './services/themeManager';
import './styles/theme.css';

// O tema é decidido antes da montagem para o primeiro desenho já sair correto.
themeManager.init();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');

