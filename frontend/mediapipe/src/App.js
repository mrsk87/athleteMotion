/**
 * Componente Raiz App
 *
 * Responsabilidade:
 * Prover injeção de internacionalização (i18n), estado do idioma selecionado,
 * o seletor dos três temas (claro, escuro e sóbrio) e a versão semântica da aplicação.
 */

import { computed, ref } from 'vue';
import { useI18n } from './i18n';
import { THEMES, themeManager } from './services/themeManager';
import packageInfo from '../package.json';

export default {
  name: 'App',
  setup() {
    const { locale, t, setLocale } = useI18n();
    const version = packageInfo.version || '0.1.0';

    // O tema ativo é mantido em sincronia com o serviço (que persiste a escolha).
    const theme = ref(themeManager.getTheme());
    themeManager.onChange((next) => {
      theme.value = next;
    });

    const themes = computed(() =>
      THEMES.map((option) => ({
        ...option,
        label: t.value(`theme_${option.id}`),
        description: t.value(`theme_${option.id}_desc`),
      })),
    );

    const setTheme = (id) => themeManager.setTheme(id);

    return {
      locale,
      t,
      setLocale,
      version,
      theme,
      themes,
      setTheme,
    };
  },
};
